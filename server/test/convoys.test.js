'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

const NOW = new Date().toISOString();
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
const PASS = 'test-cvy-x7';
insertUser.run('u-adm', 'admin@cvy.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@cvy.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@cvy.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-h02', 'h02@cvy.test',   bcrypt.hashSync(PASS, 1), 'H02',   'hauler_admin', 'haul-02', 'H02',  NOW, NOW);
insertUser.run('u-len', 'len@cvy.test',   bcrypt.hashSync(PASS, 1), 'Len',   'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ───────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',    require('../routes/auth'));
app.use('/api/convoys', require('../routes/convoys'));

// ── Lifecycle ─────────────────────────────────────────────────────────
let base;
let adminTok, opsTok, h01Tok, h02Tok, lenderTok;
const server = http.createServer(app);

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  const login = async (email) => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASS }),
    });
    return (await r.json()).token;
  };
  adminTok  = await login('admin@cvy.test');
  opsTok    = await login('ops@cvy.test');
  h01Tok    = await login('h01@cvy.test');
  h02Tok    = await login('h02@cvy.test');
  lenderTok = await login('len@cvy.test');
});

after(() => new Promise((resolve) => server.close(resolve)));

async function api(method, path, body, token) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/convoys', () => {
  it('returns 401 without auth', async () => {
    const r = await api('GET', '/api/convoys');
    assert.equal(r.status, 401);
  });

  it('returns 200 with summary, convoys, and companion fields', async () => {
    const r = await api('GET', '/api/convoys', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.summary === 'object',              'summary object');
    assert.ok(Array.isArray(r.body.convoys),                   'convoys array');
    assert.ok(Array.isArray(r.body.hauler_cycle_metrics),      'hauler_cycle_metrics array');
    assert.ok(Array.isArray(r.body.departure_cadence),         'departure_cadence array');
    assert.ok(Array.isArray(r.body.phase_by_hauler),           'phase_by_hauler array');
    assert.ok(Array.isArray(r.body.speed_profile),             'speed_profile array');
  });

  it('summary has expected fields', async () => {
    const r = await api('GET', '/api/convoys', null, adminTok);
    const s = r.body.summary;
    assert.ok('active_convoys'  in s, 'active_convoys');
    assert.ok('trucks_moving'   in s, 'trucks_moving');
    assert.ok('on_schedule'     in s, 'on_schedule');
    assert.ok('delayed'         in s, 'delayed');
    assert.ok('live_dispatched' in s, 'live_dispatched');
    assert.ok('phase_counts'    in s, 'phase_counts');
    assert.ok('convoy_by_phase' in s, 'convoy_by_phase');
  });

  it('includes mock baseline convoys (8 in fixture)', async () => {
    const r = await api('GET', '/api/convoys', null, adminTok);
    assert.ok(r.body.convoys.length >= 8, 'at least 8 convoys from mock baseline');
  });

  it('hauler_admin only sees their hauler convoys', async () => {
    const r = await api('GET', '/api/convoys', null, h01Tok);
    assert.equal(r.status, 200);
    for (const c of r.body.convoys) {
      assert.equal(c.hauler_id, 'haul-01', `convoy ${c.id} must be haul-01`);
    }
  });

  it('hauler_id query filter works for axis_admin', async () => {
    const r = await api('GET', '/api/convoys?hauler_id=haul-02', null, adminTok);
    assert.equal(r.status, 200);
    for (const c of r.body.convoys) {
      assert.equal(c.hauler_id, 'haul-02', `convoy ${c.id} must be haul-02`);
    }
  });

  it('lender can see convoys (auth, no role restriction on GET)', async () => {
    const r = await api('GET', '/api/convoys', null, lenderTok);
    assert.equal(r.status, 200);
  });
});

describe('GET /api/convoys/:id (mock convoy detail)', () => {
  it('returns detail for known mock convoy id', async () => {
    const r = await api('GET', '/api/convoys/CVY-0412', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, 'CVY-0412');
    assert.ok(Array.isArray(r.body.assigned_trucks), 'assigned_trucks array');
    assert.ok(Array.isArray(r.body.timeline),        'timeline array');
    assert.ok(Array.isArray(r.body.related_alerts),  'related_alerts array');
    assert.ok(typeof r.body.progress === 'object',   'progress object');
    assert.ok('total_km'     in r.body.progress,     'progress.total_km');
    assert.ok('covered_km'   in r.body.progress,     'progress.covered_km');
    assert.ok('percent'      in r.body.progress,     'progress.percent');
  });

  it('returns 404 for unknown convoy id', async () => {
    const r = await api('GET', '/api/convoys/CVY-9999', null, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('POST /api/convoys (dispatch)', () => {
  it('returns 401 without auth', async () => {
    const r = await api('POST', '/api/convoys', { hauler_id: 'haul-01', truck_count: 5 });
    assert.equal(r.status, 401);
  });

  it('returns 403 for hauler_admin', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-01', truck_count: 5,
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for lender', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-01', truck_count: 5,
    }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 400 for unknown hauler_id', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-99', truck_count: 5,
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('Hauler'), 'error mentions Hauler');
  });

  it('returns 400 when truck_count < 1', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-01', truck_count: 0,
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 400 for invalid direction', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-01', truck_count: 5, direction: 'westbound',
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('dispatches a convoy successfully for axis_admin', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-01',
      truck_count: 8,
      cargo_tonnes: 880,
      direction: 'southbound',
      notes: 'Test convoy dispatch',
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.convoy.id,                           'convoy id returned');
    assert.ok(r.body.convoy.convoy_ref,                   'convoy_ref returned');
    assert.equal(r.body.convoy.hauler_id, 'haul-01',      'hauler_id matches');
    assert.equal(r.body.convoy.trucks, 8,                 'truck count matches');
    assert.equal(r.body.convoy.phase, 'loading',          'initial phase is loading');
    assert.equal(r.body.convoy.direction, 'southbound',   'direction matches');
    assert.ok(r.body.convoy.is_live === true,             'is_live flag set');
  });

  it('dispatches a northbound convoy for axis_ops', async () => {
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-02',
      truck_count: 6,
      direction: 'northbound',
    }, opsTok);
    assert.equal(r.status, 201);
    assert.equal(r.body.convoy.direction, 'northbound');
  });

  it('newly dispatched convoy appears in GET /api/convoys list', async () => {
    const r = await api('GET', '/api/convoys', null, adminTok);
    const liveConvoys = r.body.convoys.filter((c) => c.is_live === true);
    assert.ok(liveConvoys.length >= 2, 'at least 2 live convoys dispatched');
    assert.ok(r.body.summary.live_dispatched >= 2, 'summary.live_dispatched >= 2');
  });
});

describe('Live convoy lifecycle (depart → phase → arrive)', () => {
  let liveId;

  before(async () => {
    // Dispatch a new convoy for haul-01 to use in this suite.
    const r = await api('POST', '/api/convoys', {
      hauler_id: 'haul-01',
      truck_count: 4,
      cargo_tonnes: 400,
      direction: 'southbound',
      planned_departure_iso: new Date(Date.now() - 60_000).toISOString(), // 1 min ago (so depart is late)
    }, adminTok);
    liveId = r.body.convoy.id; // already in 'live-{n}' format
  });

  it('GET /api/convoys/:id returns live convoy detail', async () => {
    const r = await api('GET', `/api/convoys/${liveId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.convoy_ref,                         'convoy_ref present');
    assert.ok(Array.isArray(r.body.timeline),            'timeline array');
    assert.ok(Array.isArray(r.body.assigned_trucks),     'assigned_trucks array');
    assert.ok(typeof r.body.progress === 'object',       'progress object');
  });

  it('depart returns 401 without auth', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/depart`, {});
    assert.equal(r.status, 401);
  });

  it('lender gets 403 trying to depart', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/depart`, {}, lenderTok);
    assert.equal(r.status, 403);
  });

  it('hauler_admin for wrong hauler gets 403', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/depart`, {}, h02Tok);
    assert.equal(r.status, 403);
  });

  it('depart returns 400 for mock convoy id (not live-)', async () => {
    const r = await api('POST', '/api/convoys/CVY-0412/depart', {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('live-'), 'error mentions live- prefix');
  });

  it('records departure successfully', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/depart`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.convoy.actual_departure_iso, 'actual_departure_iso set');
    // depart SQL sets phase = 'laden' immediately
    assert.equal(r.body.convoy.phase, 'laden', 'phase advanced to laden on depart');
  });

  it('hauler_admin for own hauler can update phase', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/phase`, { phase: 'laden' }, h01Tok);
    assert.equal(r.status, 200);
    assert.equal(r.body.convoy.phase, 'laden', 'phase updated to laden');
  });

  it('phase update returns 400 for invalid phase', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/phase`, { phase: 'flying' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('phase update to offload works', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/phase`, { phase: 'offload' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.convoy.phase, 'offload');
  });

  it('arrive returns 400 for non-numeric delivered_tonnes', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/arrive`, { delivered_tonnes: -5 }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('delivered_tonnes'), 'error mentions delivered_tonnes');
  });

  it('records arrival with delivered_tonnes', async () => {
    const r = await api('POST', `/api/convoys/${liveId}/arrive`, { delivered_tonnes: 395 }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.convoy.phase, 'complete',   'phase is complete');
    assert.equal(r.body.convoy.delivered_tonnes, 395, 'delivered_tonnes recorded');
    assert.ok(r.body.convoy.arrived_at_iso,         'arrived_at_iso set');
  });

  it('arrive on already-complete convoy is idempotent (200, phase stays complete)', async () => {
    // convoyState.arrive always returns the convoy if the db row exists; 404 only for missing id
    const r = await api('POST', `/api/convoys/${liveId}/arrive`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.convoy.phase, 'complete', 'phase remains complete');
  });
});
