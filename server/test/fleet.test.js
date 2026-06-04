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

// Insert test users (cost=1).
const NOW = new Date().toISOString();
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
const PASS = 'test-fleet-x7';
insertUser.run('u-adm', 'admin@fleet.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@fleet.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@fleet.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'len@fleet.test',   bcrypt.hashSync(PASS, 1), 'Lend',  'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit to avoid coupling ──────────────────────────────────────
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
app.use('/api/auth',  require('../routes/auth'));
app.use('/api/fleet', require('../routes/fleet'));

// ── Lifecycle ─────────────────────────────────────────────────────────
let base;
let adminTok, opsTok, h01Tok, lenderTok;
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASS }),
    });
    return (await r.json()).token;
  };
  adminTok  = await login('admin@fleet.test');
  opsTok    = await login('ops@fleet.test');
  h01Tok    = await login('h01@fleet.test');
  lenderTok = await login('len@fleet.test');
});

after(() => new Promise((resolve) => server.close(resolve)));

// ── Helpers ───────────────────────────────────────────────────────────
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

// ── Known IDs (from mock seed: haul-01 = rig-0001..0030, haul-02 = rig-0031..)
const H01_RIG  = 'rig-0001'; // haul-01's first truck
const H02_RIG  = 'rig-0031'; // haul-02's first truck

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/fleet', () => {
  it('returns 200 with trucks array and companion fields', async () => {
    const r = await api('GET', '/api/fleet', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.trucks),                     'trucks is an array');
    assert.ok(typeof r.body.total === 'number',                 'total is a number');
    assert.ok(Array.isArray(r.body.availability_by_hauler),     'availability_by_hauler');
    assert.ok(Array.isArray(r.body.maintenance_forecast),       'maintenance_forecast');
    assert.ok(Array.isArray(r.body.payload_efficiency),         'payload_efficiency');
    assert.ok(r.body.generated_at,                              'generated_at present');
  });

  it('returns all 110 trucks for axis_admin', async () => {
    const r = await api('GET', '/api/fleet', null, adminTok);
    assert.equal(r.body.total, 110);
    assert.equal(r.body.trucks.length, 110);
  });

  it('hauler_admin only sees their own hauler trucks', async () => {
    const r = await api('GET', '/api/fleet', null, h01Tok);
    assert.equal(r.status, 200);
    const haulerIds = [...new Set(r.body.trucks.map((t) => t.hauler_id))];
    assert.deepEqual(haulerIds, ['haul-01'], 'only haul-01 trucks returned');
  });

  it('hauler_id query filter works for axis_admin', async () => {
    const r = await api('GET', '/api/fleet?hauler_id=haul-02', null, adminTok);
    assert.equal(r.status, 200);
    for (const t of r.body.trucks) {
      assert.equal(t.hauler_id, 'haul-02', 'all trucks belong to haul-02');
    }
  });

  it('availability_by_hauler entries have the expected fields', async () => {
    const r = await api('GET', '/api/fleet', null, adminTok);
    const entry = r.body.availability_by_hauler[0];
    assert.ok('hauler_id' in entry, 'hauler_id');
    assert.ok('total'     in entry, 'total');
    assert.ok('active'    in entry, 'active');
    assert.ok('garage'    in entry, 'garage');
    assert.ok('flagged'   in entry, 'flagged');
  });
});

describe('GET /api/fleet/summary', () => {
  it('returns 200 with counts and avg efficiency', async () => {
    const r = await api('GET', '/api/fleet/summary', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.total               === 'number', 'total');
    assert.ok(typeof r.body.active_today        === 'number', 'active_today');
    assert.ok(typeof r.body.in_garage           === 'number', 'in_garage');
    assert.ok(typeof r.body.idle_yard           === 'number', 'idle_yard');
    assert.ok(typeof r.body.maintenance_flagged === 'number', 'maintenance_flagged');
    assert.ok('avg_efficiency_l_per_100km' in r.body,        'avg_efficiency');
  });

  it('hauler_admin summary is scoped to their fleet', async () => {
    const r = await api('GET', '/api/fleet/summary', null, h01Tok);
    assert.equal(r.status, 200);
    // haul-01 has 30 contracted trucks (from mock)
    assert.equal(r.body.total, 30);
  });
});

describe('PATCH /api/fleet/:rigId/status', () => {
  it('returns 401 for unauthenticated request', async () => {
    const r = await api('PATCH', `/api/fleet/${H01_RIG}/status`, { status: 'garage' });
    assert.equal(r.status, 401);
  });

  it('returns 403 for lender', async () => {
    const r = await api('PATCH', `/api/fleet/${H01_RIG}/status`, { status: 'garage' }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 404 for unknown truck', async () => {
    const r = await api('PATCH', '/api/fleet/rig-9999/status', { status: 'active' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('returns 400 for invalid status', async () => {
    const r = await api('PATCH', `/api/fleet/${H01_RIG}/status`, { status: 'flying' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('hauler_admin gets 403 for another hauler truck', async () => {
    const r = await api('PATCH', `/api/fleet/${H02_RIG}/status`, { status: 'garage' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('sets status successfully for axis_admin', async () => {
    const r = await api('PATCH', `/api/fleet/${H01_RIG}/status`, { status: 'garage', notes: 'Scheduled maintenance' }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.truck, 'truck returned');
    assert.equal(r.body.truck.status, 'garage', 'status updated to garage');
  });

  it('sets status with maintenance_flag', async () => {
    const r = await api('PATCH', `/api/fleet/${H01_RIG}/status`, { status: 'garage', maintenance_flag: 'service_due' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.truck.maintenance_flag, 'service_due');
  });

  it('hauler_admin can update their own truck', async () => {
    const r = await api('PATCH', `/api/fleet/${H01_RIG}/status`, { status: 'active' }, h01Tok);
    assert.equal(r.status, 200);
    assert.equal(r.body.truck.status, 'active');
  });

  it('axis_ops can update any truck', async () => {
    const r = await api('PATCH', `/api/fleet/${H02_RIG}/status`, { status: 'idle' }, opsTok);
    assert.equal(r.status, 200);
  });
});

describe('POST /api/fleet/:rigId/fuel', () => {
  it('returns 401 for unauthenticated request', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/fuel`, { litres: 100 });
    assert.equal(r.status, 401);
  });

  it('returns 403 for lender', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/fuel`, { litres: 100 }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 404 for unknown truck', async () => {
    const r = await api('POST', '/api/fleet/rig-9999/fuel', { litres: 100 }, adminTok);
    assert.equal(r.status, 404);
  });

  it('returns 400 when litres is missing', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/fuel`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('litres'));
  });

  it('returns 400 for non-positive litres', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/fuel`, { litres: -5 }, adminTok);
    assert.equal(r.status, 400);
  });

  it('hauler_admin gets 403 for another hauler truck', async () => {
    const r = await api('POST', `/api/fleet/${H02_RIG}/fuel`, { litres: 100 }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('creates a fuel log entry successfully', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/fuel`, {
      litres: 150.5, cost_ghs: 1205.50, odometer_km: 48000, notes: 'Routine fill',
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.entry?.id,              'entry id returned');
    assert.equal(r.body.entry.rig_id, H01_RIG);
    assert.equal(r.body.entry.litres, 150.5);
  });
});

describe('GET /api/fleet/:rigId/fuel', () => {
  before(async () => {
    // Seed a fuel log for H01_RIG
    await api('POST', `/api/fleet/${H01_RIG}/fuel`, { litres: 200, cost_ghs: 1600 }, adminTok);
  });

  it('returns rig_id, plate, logs, and summary', async () => {
    const r = await api('GET', `/api/fleet/${H01_RIG}/fuel`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.rig_id,    H01_RIG);
    assert.ok(r.body.plate,        'plate present');
    assert.ok(Array.isArray(r.body.logs), 'logs is array');
    assert.ok(typeof r.body.summary === 'object', 'summary present');
    assert.ok('fill_count'   in r.body.summary, 'fill_count');
    assert.ok('total_litres' in r.body.summary, 'total_litres');
  });

  it('returns 404 for unknown truck', async () => {
    const r = await api('GET', '/api/fleet/rig-9999/fuel', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin gets 403 for another hauler truck', async () => {
    const r = await api('GET', `/api/fleet/${H02_RIG}/fuel`, null, h01Tok);
    assert.equal(r.status, 403);
  });
});

describe('POST /api/fleet/:rigId/assign', () => {
  let driverId;

  before(async () => {
    // Find a driver belonging to haul-01
    const { driverStore } = (() => {
      const driverStore = require('../state/driverStore');
      return { driverStore };
    })();
    const drivers = driverStore.list({ hauler_id: 'haul-01' });
    driverId = drivers[0].id;
  });

  it('returns 401 for unauthenticated request', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/assign`, { driver_id: driverId });
    assert.equal(r.status, 401);
  });

  it('returns 400 when driver_id is missing', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/assign`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('driver_id'));
  });

  it('returns 404 for unknown driver', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/assign`, { driver_id: 'drv-9999' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin gets 403 for another hauler truck', async () => {
    const r = await api('POST', `/api/fleet/${H02_RIG}/assign`, { driver_id: driverId }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('assigns a driver successfully', async () => {
    const r = await api('POST', `/api/fleet/${H01_RIG}/assign`, { driver_id: driverId }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.assignment, 'assignment returned');
    assert.ok(r.body.driver,     'driver returned');
    assert.equal(r.body.assignment.rig_id,    H01_RIG);
    assert.equal(r.body.assignment.driver_id, driverId);
  });
});

describe('DELETE /api/fleet/:rigId/assign', () => {
  let driverId;

  before(async () => {
    const driverStore = require('../state/driverStore');
    driverId = driverStore.list({ hauler_id: 'haul-01' })[0].id;
    // Ensure there IS an assignment to remove.
    await api('POST', `/api/fleet/${H01_RIG}/assign`, { driver_id: driverId }, adminTok);
  });

  it('returns 404 when there is no live assignment for the truck', async () => {
    // rig-0002 has not been assigned
    const r = await api('DELETE', '/api/fleet/rig-0002/assign', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('removes the assignment successfully', async () => {
    const r = await api('DELETE', `/api/fleet/${H01_RIG}/assign`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.ok === true);
  });
});
