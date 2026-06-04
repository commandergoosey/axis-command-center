'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const crypto = require('node:crypto');

// ── In-memory DB (must happen before any app module) ─────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// ── Stubs ─────────────────────────────────────────────────────────────────
const ndKey = require.resolve('../services/notificationDispatcher');
require.cache[ndKey] = { id: ndKey, filename: ndKey, loaded: true, exports: { dispatch: async () => {} } };

const aeKey = require.resolve('../services/alertEngine');
require.cache[aeKey] = { id: aeKey, filename: aeKey, loaded: true, exports: { evaluate: () => {} } };

// Stub haulerStore — avoids seeding 170 mock rows into the in-memory DB.
const HAULERS = {
  'haul-01':     { id: 'haul-01',     display_name: 'Hauler 01', webhook_secret: null,          api_token: null },
  'haul-secret': { id: 'haul-secret', display_name: 'Hauler S',  webhook_secret: 'test-secret', api_token: null },
};
const hsKey = require.resolve('../state/haulerStore');
require.cache[hsKey] = { id: hsKey, filename: hsKey, loaded: true, exports: { findById: (id) => HAULERS[id] ?? null } };

// ── Fresh modules (after stubs, so they bind to the in-memory DB) ─────────
for (const rel of ['../state/tripStore', '../state/positionStore',
                   '../services/eventProcessor', '../routes/webhooks']) {
  delete require.cache[require.resolve(rel)];
}

const tripStore     = require('../state/tripStore');
const positionStore = require('../state/positionStore');

// ── Minimal Express server ────────────────────────────────────────────────
const express = require('express');
const app = express();
// Replicate the rawBody capture middleware from index.js.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use('/api/webhooks', require('../routes/webhooks'));

let server;
let base;

before(() => new Promise((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

function clearData() {
  db.exec('DELETE FROM webhook_events; DELETE FROM trips; DELETE FROM vehicle_positions');
}

function hmacSig(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('webhooks — Loconav endpoint', () => {
  beforeEach(clearData);

  it('returns 404 for an unknown hauler', async () => {
    const res = await fetch(`${base}/api/webhooks/no-such/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('stores events and returns { ok: true, stored }', async () => {
    const events = [
      { event_type: 'POSITION', vehicle_id: 'GH-1001', latitude: 6.0, longitude: -2.0, speed_kmh: 50 },
      { event_type: 'POSITION', vehicle_id: 'GH-1002', latitude: 6.1, longitude: -2.1, speed_kmh: 60 },
    ];
    const res = await fetch(`${base}/api/webhooks/haul-01/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.stored, 2);

    const rows = db.prepare('SELECT * FROM webhook_events ORDER BY rowid').all();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].event_type, 'position'); // normalised from 'POSITION'
    assert.strictEqual(rows[0].hauler_id, 'haul-01');
    assert.strictEqual(rows[0].source, 'loconav');
  });

  it('processes events via eventProcessor — positions appear in DB', async () => {
    const ts = new Date().toISOString();
    const events = [{
      event_type: 'POSITION', vehicle_id: 'GH-PROC',
      latitude: 6.834, longitude: -2.054, speed_kmh: 42, timestamp: ts,
    }];
    await fetch(`${base}/api/webhooks/haul-01/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    // The route schedules processIds via setImmediate. Yield once to let it run.
    await new Promise((r) => setImmediate(r));

    const pos = positionStore.byVehicle('GH-PROC');
    assert.ok(pos, 'position should be stored after webhook processing');
    assert.strictEqual(pos.latitude, 6.834);
    assert.strictEqual(pos.hauler_id, 'haul-01');

    const row = db.prepare('SELECT processed FROM webhook_events LIMIT 1').get();
    assert.strictEqual(row.processed, 1, 'event should be marked processed=1');
  });

  it('stores a trip_start and creates an in_progress trip', async () => {
    const ts = new Date().toISOString();
    const events = [{
      event_type: 'TRIP_START', vehicle_id: 'GH-TRIP',
      direction: 'laden', origin: 'Nyinahin Mine Gate', timestamp: ts,
    }];
    await fetch(`${base}/api/webhooks/haul-01/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    await new Promise((r) => setImmediate(r));

    const { trips } = tripStore.list({ hauler_id: 'haul-01' });
    assert.strictEqual(trips.length, 1);
    assert.strictEqual(trips[0].status, 'in_progress');
    assert.strictEqual(trips[0].vehicle_id, 'GH-TRIP');
  });

  it('normalises Loconav event_type strings to canonical form', async () => {
    const events = [
      { event_type: 'TRIP_START' },
      { event_type: 'TRIP_END'   },
      { event_type: 'ALERT'      },
      { event_type: 'LOCATION'   },
      { event_type: 'ALARM'      },
    ];
    await fetch(`${base}/api/webhooks/haul-01/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    const types = db.prepare('SELECT event_type FROM webhook_events ORDER BY rowid').all().map((r) => r.event_type);
    assert.deepStrictEqual(types, ['trip_start', 'trip_end', 'alert', 'position', 'alert']);
  });

  it('accepts a single event object (not an array)', async () => {
    const res = await fetch(`${base}/api/webhooks/haul-01/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'POSITION', vehicle_id: 'GH-SINGLE' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.stored, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('webhooks — HMAC signature verification', () => {
  beforeEach(clearData);

  it('rejects with 401 when signature is wrong for a hauler with a secret configured', async () => {
    const body = JSON.stringify([{ event_type: 'POSITION', vehicle_id: 'GH-HMAC' }]);
    const res = await fetch(`${base}/api/webhooks/haul-secret/loconav`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Loconav-Signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
      body,
    });
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.ok(json.error);
  });

  it('accepts a request with a valid HMAC signature', async () => {
    const body = JSON.stringify([{ event_type: 'POSITION', vehicle_id: 'GH-HMAC2', latitude: 5.0 }]);
    const res = await fetch(`${base}/api/webhooks/haul-secret/loconav`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Loconav-Signature': hmacSig(body, 'test-secret'),
      },
      body,
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.stored, 1);
  });

  it('accepts requests with no signature for haulers without a configured secret', async () => {
    const res = await fetch(`${base}/api/webhooks/haul-01/loconav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ event_type: 'POSITION', vehicle_id: 'GH-NOSIG' }]),
    });
    assert.strictEqual(res.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('webhooks — custom adapter endpoint', () => {
  beforeEach(clearData);

  it('stores events with source=custom and triggers processing', async () => {
    const ts = new Date().toISOString();
    const events = [{
      event_type: 'position', vehicle_id: 'GH-CUST',
      latitude: 5.5, longitude: -2.2, speed_kmh: 35, timestamp: ts,
    }];
    const res = await fetch(`${base}/api/webhooks/haul-01/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.stored, 1);

    const row = db.prepare('SELECT * FROM webhook_events LIMIT 1').get();
    assert.strictEqual(row.source, 'custom');
    assert.strictEqual(row.hauler_id, 'haul-01');

    await new Promise((r) => setImmediate(r));
    const pos = positionStore.byVehicle('GH-CUST');
    assert.ok(pos, 'position should be stored after custom webhook processing');
  });

  it('returns 404 for an unknown hauler on the custom endpoint', async () => {
    const res = await fetch(`${base}/api/webhooks/ghost/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.strictEqual(res.status, 404);
  });
});
