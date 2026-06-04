'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// Insert test users before requiring users.js (bypasses cost-12 seed).
const NOW = new Date().toISOString();
const ADMIN_PASS = 'admin-pass-tr9';
const OPS_PASS   = 'ops-pass-tr9';
const HAUL_PASS  = 'haul-pass-tr9';
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm', 'admin@trips.gh', bcrypt.hashSync(ADMIN_PASS, 1), 'Admin',   'axis_admin', null,      'AXIS',  NOW, NOW);
insertUser.run('u-ops', 'ops@trips.gh',   bcrypt.hashSync(OPS_PASS,   1), 'Ops',     'axis_ops',   null,      'AXIS',  NOW, NOW);
insertUser.run('u-hau', 'haul@trips.gh',  bcrypt.hashSync(HAUL_PASS,  1), 'Hauler',  'hauler_admin','haul-01','TruckCo', NOW, NOW);

// ── Stubs (must precede requiring routes/trips) ───────────────────────

const rosterKey = require.resolve('../state/roster');
require.cache[rosterKey] = {
  id: rosterKey, filename: rosterKey, loaded: true,
  exports: {
    list: () => [
      { id: 'haul-01', display_name: 'TruckCo' },
      { id: 'haul-02', display_name: 'RoadRunner' },
    ],
  },
};

const convoyStateKey = require.resolve('../state/convoyState');
require.cache[convoyStateKey] = {
  id: convoyStateKey, filename: convoyStateKey, loaded: true,
  exports: { liveCompletedTrips: () => [] },
};

const mockTripsKey = require.resolve('../mock/trips');
require.cache[mockTripsKey] = {
  id: mockTripsKey, filename: mockTripsKey, loaded: true,
  exports: { TRIPS: [], delayHeatmap: () => [] },
};

const mockCorridorKey = require.resolve('../mock/corridor');
require.cache[mockCorridorKey] = {
  id: mockCorridorKey, filename: mockCorridorKey, loaded: true,
  exports: { WAYPOINTS: [] },
};

const mockFleetKey = require.resolve('../mock/fleet');
require.cache[mockFleetKey] = {
  id: mockFleetKey, filename: mockFleetKey, loaded: true,
  exports: { FLEET: [] },
};

const mockDriversKey = require.resolve('../mock/drivers');
require.cache[mockDriversKey] = {
  id: mockDriversKey, filename: mockDriversKey, loaded: true,
  exports: { DRIVERS: [] },
};

const mockAlertsKey = require.resolve('../mock/alerts');
require.cache[mockAlertsKey] = {
  id: mockAlertsKey, filename: mockAlertsKey, loaded: true,
  exports: { ALERTS: [] },
};

const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {} },
};

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',  require('../routes/auth'));
app.use('/api/trips', require('../routes/trips'));

let server, base;

before(() => new Promise((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

// ── Clean trips between describes ────────────────────────────────────
function clearTrips() { db.exec('DELETE FROM trips'); }

// ── Helpers ───────────────────────────────────────────────────────────
async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).token;
}

async function api(method, path, body, token) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────

describe('trips — role gating', () => {
  it('unauthenticated POST returns 401', async () => {
    const res = await api('POST', '/api/trips', { hauler_id: 'haul-01' });
    assert.strictEqual(res.status, 401);
  });

  it('hauler_admin cannot POST (role restricted to axis_admin / axis_ops)', async () => {
    const token = await login('haul@trips.gh', HAUL_PASS);
    const res = await api('POST', '/api/trips', { hauler_id: 'haul-01' }, token);
    assert.strictEqual(res.status, 403);
  });

  it('axis_ops can POST a trip', async () => {
    const token = await login('ops@trips.gh', OPS_PASS);
    const res = await api('POST', '/api/trips', { hauler_id: 'haul-01' }, token);
    assert.strictEqual(res.status, 201);
    clearTrips();
  });

  it('unauthenticated GET /live returns 401', async () => {
    const res = await api('GET', '/api/trips/live');
    assert.strictEqual(res.status, 401);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — POST /trips create', () => {
  let adminToken;
  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();
  });

  it('returns 400 when hauler_id is missing', async () => {
    const res = await api('POST', '/api/trips', { direction: 'laden' }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('creates an in_progress trip and returns 201', async () => {
    const res = await api('POST', '/api/trips', {
      hauler_id:  'haul-01',
      vehicle_id: 'TRK-001',
      direction:  'laden',
      tonnage_t:  50,
      distance_km: 300,
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.status,    'in_progress');
    assert.strictEqual(body.hauler_id, 'haul-01');
    assert.strictEqual(body.tonnage_t, 50);
    clearTrips();
  });

  it('creates a completed trip when arrived_at is provided', async () => {
    const departed_at = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const arrived_at  = new Date().toISOString();
    const res = await api('POST', '/api/trips', {
      hauler_id:   'haul-01',
      vehicle_id:  'TRK-002',
      direction:   'laden',
      tonnage_t:   45,
      distance_km: 280,
      departed_at,
      arrived_at,
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.status, 'completed');
    assert.ok(body.duration_min > 0, 'duration_min should be computed from timestamps');
    clearTrips();
  });

  it('source defaults to manual for route-created trips', async () => {
    const res = await api('POST', '/api/trips', { hauler_id: 'haul-01' }, adminToken);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    // normaliseDbTrip doesn't expose source directly but we can check _real flag
    assert.strictEqual(body._real, true);
    clearTrips();
  });

  it('hauler_display_name is populated from the roster stub', async () => {
    const res = await api('POST', '/api/trips', { hauler_id: 'haul-01' }, adminToken);
    const body = await res.json();
    assert.strictEqual(body.hauler_display_name, 'TruckCo');
    clearTrips();
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — PATCH /trips/:id', () => {
  let adminToken, tripId;

  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();
    const res = await api('POST', '/api/trips', {
      hauler_id: 'haul-01', direction: 'laden', tonnage_t: 40,
    }, adminToken);
    tripId = (await res.json()).id;
  });

  after(clearTrips);

  it('returns 404 for an unknown trip id', async () => {
    const res = await api('PATCH', '/api/trips/does-not-exist', { tonnage_t: 50 }, adminToken);
    assert.strictEqual(res.status, 404);
    assert.ok((await res.json()).error);
  });

  it('updates tonnage_t on an existing trip', async () => {
    const res = await api('PATCH', `/api/trips/${tripId}`, { tonnage_t: 55 }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.tonnage_t, 55);
  });

  it('updates multiple fields simultaneously', async () => {
    const res = await api('PATCH', `/api/trips/${tripId}`,
      { tonnage_t: 60, distance_km: 290, vehicle_id: 'TRK-999' }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.tonnage_t,  60);
    assert.strictEqual(body.distance_km, 290);
  });

  it('hauler_admin cannot PATCH', async () => {
    const token = await login('haul@trips.gh', HAUL_PASS);
    const res = await api('PATCH', `/api/trips/${tripId}`, { tonnage_t: 1 }, token);
    assert.strictEqual(res.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — GET /trips/stats', () => {
  let adminToken;

  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();

    // Insert 2 completed and 1 in-progress via the route
    const dep1 = new Date(Date.now() - 4 * 3_600_000).toISOString();
    const arr1 = new Date().toISOString();
    await api('POST', '/api/trips', { hauler_id: 'haul-01', tonnage_t: 50, distance_km: 300, departed_at: dep1, arrived_at: arr1 }, adminToken);
    await api('POST', '/api/trips', { hauler_id: 'haul-02', tonnage_t: 60, distance_km: 310, departed_at: dep1, arrived_at: arr1 }, adminToken);
    await api('POST', '/api/trips', { hauler_id: 'haul-01', direction: 'laden' }, adminToken); // in_progress
  });

  after(clearTrips);

  it('returns the expected shape', async () => {
    const res = await api('GET', '/api/trips/stats', null, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok('total_trips'    in body, 'total_trips should be present');
    assert.ok('completed'      in body, 'completed should be present');
    assert.ok('in_progress'    in body, 'in_progress should be present');
    assert.ok('manual_entries' in body, 'manual_entries should be present');
    assert.ok('total_tonnage_t' in body);
  });

  it('counts total_trips and status breakdowns correctly', async () => {
    const res = await api('GET', '/api/trips/stats', null, adminToken);
    const body = await res.json();
    assert.strictEqual(body.total_trips,  3);
    assert.strictEqual(body.completed,    2);
    assert.strictEqual(body.in_progress,  1);
  });

  it('aggregates total_tonnage_t for completed trips', async () => {
    const res = await api('GET', '/api/trips/stats', null, adminToken);
    const body = await res.json();
    assert.strictEqual(body.total_tonnage_t, 110); // 50 + 60
  });

  it('hauler_admin GET /stats returns only their hauler trips', async () => {
    const token = await login('haul@trips.gh', HAUL_PASS);
    const res = await api('GET', '/api/trips/stats', null, token);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    // haul-01 has 2 trips (1 completed + 1 in_progress)
    assert.strictEqual(body.total_trips, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — GET /trips/live', () => {
  let adminToken;

  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();
  });

  after(clearTrips);

  it('returns empty array when no trips are in progress', async () => {
    const res = await api('GET', '/api/trips/live', null, adminToken);
    assert.strictEqual(res.status, 200);
    const { trips, count } = await res.json();
    assert.ok(Array.isArray(trips));
    assert.strictEqual(count, 0);
  });

  it('returns only in_progress trips', async () => {
    // Create one in_progress and one completed
    await api('POST', '/api/trips', { hauler_id: 'haul-01' }, adminToken); // in_progress
    const dep = new Date(Date.now() - 3 * 3_600_000).toISOString();
    await api('POST', '/api/trips', { hauler_id: 'haul-02', departed_at: dep, arrived_at: new Date().toISOString() }, adminToken); // completed

    const res = await api('GET', '/api/trips/live', null, adminToken);
    const { trips, count } = await res.json();
    assert.strictEqual(count, 1);
    assert.strictEqual(trips[0].status, 'in_progress');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — GET /trips/:id', () => {
  let adminToken, tripId;

  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();
    const res = await api('POST', '/api/trips', {
      hauler_id: 'haul-01', vehicle_id: 'TRK-042', tonnage_t: 55,
    }, adminToken);
    tripId = (await res.json()).id;
  });

  after(clearTrips);

  it('returns 404 for an unknown trip id', async () => {
    const res = await api('GET', '/api/trips/no-such-id', null, adminToken);
    assert.strictEqual(res.status, 404);
  });

  it('returns trip details for a real DB trip', async () => {
    const res = await api('GET', `/api/trips/${tripId}`, null, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id,        tripId);
    assert.strictEqual(body.hauler_id, 'haul-01');
    assert.ok(Array.isArray(body.timeline),       'timeline should be an array');
    assert.ok(Array.isArray(body.related_alerts), 'related_alerts should be an array');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — GET /trips (list with analytics)', () => {
  let adminToken;

  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();
    const dep = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const arr = new Date().toISOString();
    await api('POST', '/api/trips', { hauler_id: 'haul-01', tonnage_t: 40, departed_at: dep, arrived_at: arr }, adminToken);
  });

  after(clearTrips);

  it('returns the expected response shape', async () => {
    const res = await api('GET', '/api/trips', null, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.trips),                'trips should be array');
    assert.ok(Array.isArray(body.cost_per_route),       'cost_per_route should be array');
    assert.ok(Array.isArray(body.delay_heatmap),        'delay_heatmap should be array');
    assert.ok(Array.isArray(body.cost_trend),           'cost_trend should be array');
    assert.ok(Array.isArray(body.hauler_summary),       'hauler_summary should be array');
    assert.ok('count' in body,                          'count should be present');
  });

  it('real_data_count reflects DB trips', async () => {
    const res  = await api('GET', '/api/trips', null, adminToken);
    const body = await res.json();
    assert.ok(body.real_data_count >= 1, 'real_data_count must include the DB trip');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('trips — GET /trips/export.csv', () => {
  let adminToken;

  before(async () => {
    adminToken = await login('admin@trips.gh', ADMIN_PASS);
    clearTrips();
    const dep = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const arr = new Date().toISOString();
    await api('POST', '/api/trips', {
      hauler_id: 'haul-01', vehicle_id: 'TRK-CSV', tonnage_t: 44,
      departed_at: dep, arrived_at: arr,
    }, adminToken);
  });

  after(clearTrips);

  it('returns Content-Type: text/csv', async () => {
    const res = await api('GET', '/api/trips/export.csv', null, adminToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/csv'));
  });

  it('CSV contains a header row with expected column names', async () => {
    const res  = await api('GET', '/api/trips/export.csv', null, adminToken);
    const text = await res.text();
    // Strip BOM if present
    const firstLine = text.replace(/^﻿/, '').split('\n')[0];
    assert.ok(firstLine.includes('hauler_id'),  'header must contain hauler_id');
    assert.ok(firstLine.includes('vehicle_id'), 'header must contain vehicle_id');
    assert.ok(firstLine.includes('tonnage_t'),  'header must contain tonnage_t');
    assert.ok(firstLine.includes('status'),     'header must contain status');
  });

  it('CSV contains at least one data row', async () => {
    const res  = await api('GET', '/api/trips/export.csv', null, adminToken);
    const text = await res.text();
    const lines = text.replace(/^﻿/, '').split('\n').filter((l) => l.trim());
    assert.ok(lines.length >= 2, `expected header + 1 data row, got ${lines.length} lines`);
  });

  it('hauler_admin cannot access CSV export', async () => {
    const token = await login('haul@trips.gh', HAUL_PASS);
    const res = await api('GET', '/api/trips/export.csv', null, token);
    assert.strictEqual(res.status, 403);
  });
});
