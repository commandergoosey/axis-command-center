'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB (must precede any module that touches db) ────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-corridor';
process.env.NODE_ENV   = 'test';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// ── Seed users ────────────────────────────────────────────────────────────────
const NOW  = new Date().toISOString();
const PASS = 'Test1234!';

const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm', 'admin@corr.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@corr.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-hul', 'hauler@corr.test', bcrypt.hashSync(PASS, 1), 'Hauler', 'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-vwr', 'viewer@corr.test', bcrypt.hashSync(PASS, 1), 'Viewer', 'lender',       null,      'AXIS', NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express         = require('express');
const { attachUser }  = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',     require('../routes/auth'));
app.use('/api/corridor', require('../routes/corridor'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, haulerTok, viewerTok;

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
  adminTok  = await login('admin@corr.test');
  opsTok    = await login('ops@corr.test');
  haulerTok = await login('hauler@corr.test');
  viewerTok = await login('viewer@corr.test');
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

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/corridor', () => {
  it('200 — open endpoint, no auth required', async () => {
    const r = await api('GET', '/api/corridor');
    assert.equal(r.status, 200);
  });

  it('returns expected top-level keys', async () => {
    const r = await api('GET', '/api/corridor');
    for (const k of ['corridor', 'waypoints', 'segments', 'conditions', 'active_convoys',
                      'vehicle_positions', 'health_history', 'throughput_forecast',
                      'segment_util', 'waypoint_dwell']) {
      assert.ok(k in r.body, `Missing key: ${k}`);
    }
  });

  it('corridor object has name, length_km, counterparty', async () => {
    const r = await api('GET', '/api/corridor');
    assert.equal(r.body.corridor.name, 'Nyinahin–Takoradi');
    assert.ok(typeof r.body.corridor.length_km === 'number');
    assert.equal(r.body.corridor.counterparty, 'GIBDLC');
  });

  it('waypoints is an array of 8', async () => {
    const r = await api('GET', '/api/corridor');
    assert.ok(Array.isArray(r.body.waypoints));
    assert.equal(r.body.waypoints.length, 8);
  });

  it('segments is an array of 4', async () => {
    const r = await api('GET', '/api/corridor');
    assert.ok(Array.isArray(r.body.segments));
    assert.equal(r.body.segments.length, 4);
  });

  it('active_convoys have hauler_display_name merged in', async () => {
    const r = await api('GET', '/api/corridor');
    assert.ok(Array.isArray(r.body.active_convoys));
    for (const c of r.body.active_convoys) {
      assert.ok('hauler_display_name' in c, `convoy ${c.id} missing hauler_display_name`);
    }
  });

  it('health_history has 30 entries each with date, score, verdict', async () => {
    const r = await api('GET', '/api/corridor');
    const hh = r.body.health_history;
    assert.equal(hh.length, 30);
    for (const entry of hh) {
      assert.ok(typeof entry.date === 'string');
      assert.ok(typeof entry.score === 'number');
      assert.ok(['STRONG', 'WATCH', 'BELOW'].includes(entry.verdict), `Bad verdict: ${entry.verdict}`);
    }
  });

  it('throughput_forecast has 4 entries with base/optimistic/conservative', async () => {
    const r = await api('GET', '/api/corridor');
    const tf = r.body.throughput_forecast;
    assert.equal(tf.length, 4);
    for (const w of tf) {
      assert.ok(typeof w.week === 'string');
      assert.ok(typeof w.base_tonnes === 'number');
      assert.ok(typeof w.optimistic_tonnes === 'number');
      assert.ok(typeof w.conservative_tonnes === 'number');
      assert.equal(w.modelled, true);
    }
  });

  it('segment_util has util_pct and total on each entry', async () => {
    const r = await api('GET', '/api/corridor');
    for (const s of r.body.segment_util) {
      assert.ok('util_pct' in s, `segment ${s.id} missing util_pct`);
      assert.ok('total' in s);
    }
  });

  it('waypoint_dwell excludes depot waypoints', async () => {
    const r = await api('GET', '/api/corridor');
    const wd = r.body.waypoint_dwell;
    assert.ok(Array.isArray(wd));
    for (const w of wd) {
      assert.ok(typeof w.avg_min === 'number');
      assert.notEqual(w.kind, 'depot');
    }
  });

  it('conditions.advisories falls back to mock when no live entries exist', async () => {
    const advisories = (await api('GET', '/api/corridor')).body.conditions.advisories;
    assert.ok(Array.isArray(advisories));
    assert.ok(advisories.length > 0, 'should have mock advisories as fallback');
  });

  it('vehicle_positions is an array', async () => {
    const r = await api('GET', '/api/corridor');
    assert.ok(Array.isArray(r.body.vehicle_positions));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/corridor/advisories', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/corridor/advisories')).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/corridor/advisories', null, haulerTok)).status, 403);
  });

  it('403 for lender role', async () => {
    assert.equal((await api('GET', '/api/corridor/advisories', null, viewerTok)).status, 403);
  });

  it('200 for axis_admin returns advisories array', async () => {
    const r = await api('GET', '/api/corridor/advisories', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.advisories));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/corridor/advisories', null, opsTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/corridor/advisories', () => {
  it('401 without token', async () => {
    const r = await api('POST', '/api/corridor/advisories', { severity: 'info', body: 'Test' });
    assert.equal(r.status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('POST', '/api/corridor/advisories', { severity: 'info', body: 'Test' }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('400 — missing body text', async () => {
    const r = await api('POST', '/api/corridor/advisories', { severity: 'info' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — invalid severity', async () => {
    const r = await api('POST', '/api/corridor/advisories', { severity: 'urgent', body: 'Test' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — body exceeds 500 chars', async () => {
    const r = await api('POST', '/api/corridor/advisories', { severity: 'info', body: 'x'.repeat(501) }, adminTok);
    assert.equal(r.status, 400);
  });

  it('201 — axis_admin creates advisory', async () => {
    const r = await api('POST', '/api/corridor/advisories',
      { severity: 'warn', body: 'Road works at km 200', km_from: 195, km_to: 210 }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.advisory);
    assert.equal(r.body.advisory.severity, 'warn');
    assert.ok(r.body.advisory.id.startsWith('live-'));
    assert.equal(r.body.advisory.is_live, true);
    assert.ok(r.body.advisory._db_id);
  });

  it('201 — axis_ops creates critical advisory', async () => {
    const r = await api('POST', '/api/corridor/advisories',
      { severity: 'critical', body: 'Weighbridge closed at Bekwai' }, opsTok);
    assert.equal(r.status, 201);
    assert.equal(r.body.advisory.severity, 'critical');
  });

  it('after live advisory posted, GET /corridor uses live list (not mock)', async () => {
    const r = await api('GET', '/api/corridor');
    const hasLive = r.body.conditions.advisories.some((a) => a.is_live === true);
    assert.ok(hasLive, 'expected at least one live advisory in corridor snapshot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/corridor/advisories/:id/resolve', () => {
  let targetDbId;

  before(async () => {
    const r = await api('POST', '/api/corridor/advisories',
      { severity: 'info', body: 'Advisory to be resolved' }, adminTok);
    targetDbId = r.body.advisory._db_id;
  });

  it('401 without token', async () => {
    assert.equal((await api('POST', `/api/corridor/advisories/${targetDbId}/resolve`)).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', `/api/corridor/advisories/${targetDbId}/resolve`, null, haulerTok)).status, 403,
    );
  });

  it('400 — non-numeric id', async () => {
    assert.equal((await api('POST', '/api/corridor/advisories/abc/resolve', null, adminTok)).status, 400);
  });

  it('404 — id not found', async () => {
    assert.equal((await api('POST', '/api/corridor/advisories/999999/resolve', null, adminTok)).status, 404);
  });

  it('200 — axis_admin resolves advisory, resolved_at is set', async () => {
    const r = await api('POST', `/api/corridor/advisories/${targetDbId}/resolve`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.advisory.resolved_at, 'resolved_at should be set');
  });

  it('200 — axis_ops can resolve an advisory', async () => {
    const r2 = await api('POST', '/api/corridor/advisories',
      { severity: 'info', body: 'For ops to resolve' }, opsTok);
    const id2 = r2.body.advisory._db_id;
    assert.equal((await api('POST', `/api/corridor/advisories/${id2}/resolve`, null, opsTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/corridor/advisories/:id', () => {
  let deleteId;

  before(async () => {
    const r = await api('POST', '/api/corridor/advisories',
      { severity: 'info', body: 'Advisory to be deleted' }, adminTok);
    deleteId = r.body.advisory._db_id;
  });

  it('401 without token', async () => {
    assert.equal((await api('DELETE', `/api/corridor/advisories/${deleteId}`)).status, 401);
  });

  it('403 for axis_ops', async () => {
    assert.equal((await api('DELETE', `/api/corridor/advisories/${deleteId}`, null, opsTok)).status, 403);
  });

  it('400 — non-numeric id', async () => {
    assert.equal((await api('DELETE', '/api/corridor/advisories/abc', null, adminTok)).status, 400);
  });

  it('404 — id not found', async () => {
    assert.equal((await api('DELETE', '/api/corridor/advisories/999998', null, adminTok)).status, 404);
  });

  it('200 — axis_admin deletes advisory', async () => {
    const r = await api('DELETE', `/api/corridor/advisories/${deleteId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('404 — advisory is gone after deletion', async () => {
    assert.equal((await api('DELETE', `/api/corridor/advisories/${deleteId}`, null, adminTok)).status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/corridor/benchmarks', () => {
  it('200 — open endpoint, no auth needed', async () => {
    assert.equal((await api('GET', '/api/corridor/benchmarks')).status, 200);
  });

  it('returns benchmarks array and count', async () => {
    const r = await api('GET', '/api/corridor/benchmarks');
    assert.ok(Array.isArray(r.body.benchmarks));
    assert.ok(typeof r.body.count === 'number');
  });

  it('default seed provides 5 benchmarks', async () => {
    // Allow setImmediate seed to fire
    await new Promise((resolve) => setImmediate(resolve));
    const r = await api('GET', '/api/corridor/benchmarks');
    assert.ok(r.body.benchmarks.length >= 5, `Expected ≥5 benchmarks, got ${r.body.benchmarks.length}`);
  });

  it('includes cycle_time_max_h and speed_max_kmh', async () => {
    const r = await api('GET', '/api/corridor/benchmarks');
    const keys = r.body.benchmarks.map((b) => b.key);
    assert.ok(keys.includes('cycle_time_max_h'), 'missing cycle_time_max_h');
    assert.ok(keys.includes('speed_max_kmh'), 'missing speed_max_kmh');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/corridor/benchmarks/:key', () => {
  it('401 without token', async () => {
    assert.equal((await api('PUT', '/api/corridor/benchmarks/cycle_time_max_h', { value: 28 })).status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('PUT', '/api/corridor/benchmarks/cycle_time_max_h', { value: 28 }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('400 — missing value', async () => {
    const r = await api('PUT', '/api/corridor/benchmarks/cycle_time_max_h', { label: 'No value' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — non-numeric value', async () => {
    const r = await api('PUT', '/api/corridor/benchmarks/cycle_time_max_h', { value: 'fast' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin updates existing benchmark', async () => {
    const r = await api('PUT', '/api/corridor/benchmarks/cycle_time_max_h',
      { value: 28, unit: 'h', label: 'Max cycle time updated' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.benchmark.key, 'cycle_time_max_h');
    assert.equal(r.body.benchmark.value, 28);
  });

  it('200 — axis_ops updates benchmark', async () => {
    const r = await api('PUT', '/api/corridor/benchmarks/idle_max_min', { value: 45, unit: 'min' }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.benchmark.value, 45);
  });

  it('200 — creates a new custom benchmark key', async () => {
    const r = await api('PUT', '/api/corridor/benchmarks/fuel_per_100km_max',
      { value: 42, unit: 'L', label: 'Max fuel per 100 km' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.benchmark.key, 'fuel_per_100km_max');
  });

  it('GET /benchmarks reflects updated value', async () => {
    const r = await api('GET', '/api/corridor/benchmarks');
    const bm = r.body.benchmarks.find((b) => b.key === 'cycle_time_max_h');
    assert.ok(bm, 'cycle_time_max_h should be in list');
    assert.equal(bm.value, 28);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/corridor/benchmarks/:key', () => {
  before(async () => {
    await api('PUT', '/api/corridor/benchmarks/to-delete-bm', { value: 99 }, adminTok);
  });

  it('401 without token', async () => {
    assert.equal((await api('DELETE', '/api/corridor/benchmarks/to-delete-bm')).status, 401);
  });

  it('403 for axis_ops', async () => {
    assert.equal((await api('DELETE', '/api/corridor/benchmarks/to-delete-bm', null, opsTok)).status, 403);
  });

  it('404 — key not found', async () => {
    assert.equal((await api('DELETE', '/api/corridor/benchmarks/nonexistent-key-xyz', null, adminTok)).status, 404);
  });

  it('200 — axis_admin deletes benchmark', async () => {
    const r = await api('DELETE', '/api/corridor/benchmarks/to-delete-bm', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('404 — key gone after deletion', async () => {
    assert.equal((await api('DELETE', '/api/corridor/benchmarks/to-delete-bm', null, adminTok)).status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/corridor/utilization', () => {
  it('200 — open endpoint', async () => {
    assert.equal((await api('GET', '/api/corridor/utilization')).status, 200);
  });

  it('returns generated_at, total_active, segments', async () => {
    const r = await api('GET', '/api/corridor/utilization');
    assert.ok(typeof r.body.generated_at === 'string');
    assert.ok(typeof r.body.total_active === 'number');
    assert.ok(Array.isArray(r.body.segments));
  });

  it('each segment has utilization_pct, vehicle_count, vehicles', async () => {
    const r = await api('GET', '/api/corridor/utilization');
    for (const s of r.body.segments) {
      assert.ok('utilization_pct' in s, `segment ${s.id} missing utilization_pct`);
      assert.ok(typeof s.vehicle_count === 'number');
      assert.ok(Array.isArray(s.vehicles));
    }
  });

  it('total_active is 0 on a fresh in-memory DB (no positions)', async () => {
    const r = await api('GET', '/api/corridor/utilization');
    assert.equal(r.body.total_active, 0);
  });
});
