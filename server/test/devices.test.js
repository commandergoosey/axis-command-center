'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');
const { EventEmitter } = require('events');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-devices';
process.env.NODE_ENV   = 'test';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);
// Telematics-core device tables (devices, device_heartbeats, fuel_readings, etc.)
require('@axis/telematics-core/db/migrate').run(db);

// ── Seed users ────────────────────────────────────────────────────────────────
const NOW  = new Date().toISOString();
const PASS = 'Test1234!';

const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm', 'admin@dev.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@dev.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@dev.test',    bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'lender@dev.test', bcrypt.hashSync(PASS, 1), 'Lender', 'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Initialise telematics (device registry wired to DB; no MQTT without host) ─
const telematics   = require('@axis/telematics-core');
const { requireRole } = require('../middleware/auth');
const bus = new EventEmitter();
telematics.init({ db, bus, middleware: { requireRole } });

// ── App ───────────────────────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',    require('../routes/auth'));
app.use('/api/devices', telematics.getDevicesRouter());

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, haulerTok, lenderTok;

// IMEIs used across the suite
const DEV_A = '860000000000001'; // no vehicle_id
const DEV_B = '860000000000002'; // vehicle_id = 'rig-test-01'
const DEV_C = '860000000000005'; // provisioned mid-suite for deactivate test

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
  adminTok  = await login('admin@dev.test');
  opsTok    = await login('ops@dev.test');
  haulerTok = await login('h01@dev.test');
  lenderTok = await login('lender@dev.test');

  // Pre-provision two devices for read/update/calibration tests
  await api('POST', `/api/devices/${DEV_A}/provision`, {
    model: 'FMB920', hauler_id: 'haul-01', notes: 'Device A — no vehicle',
  }, adminTok);
  await api('POST', `/api/devices/${DEV_B}/provision`, {
    model: 'FMB920', hauler_id: 'haul-01', vehicle_id: 'rig-test-01', notes: 'Device B — with vehicle',
  }, adminTok);
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
// GET /api/devices — list
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/devices — list', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/devices')).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/devices', null, haulerTok)).status, 403);
  });

  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/devices', null, lenderTok)).status, 403);
  });

  it('200 for axis_admin', async () => {
    assert.equal((await api('GET', '/api/devices', null, adminTok)).status, 200);
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/devices', null, opsTok)).status, 200);
  });

  it('response has total, limit, offset, devices array', async () => {
    const { body } = await api('GET', '/api/devices', null, adminTok);
    assert.ok(typeof body.total === 'number');
    assert.ok(typeof body.limit === 'number');
    assert.ok(typeof body.offset === 'number');
    assert.ok(Array.isArray(body.devices));
  });

  it('at least 2 devices in list after provisioning in before()', async () => {
    const { body } = await api('GET', '/api/devices', null, adminTok);
    assert.ok(body.total >= 2);
    assert.ok(body.devices.length >= 2);
  });

  it('each device has correct shape fields', async () => {
    const { body } = await api('GET', '/api/devices', null, adminTok);
    for (const d of body.devices) {
      assert.ok(typeof d.imei === 'string');
      assert.ok(typeof d.active === 'boolean');
      assert.ok('hauler_id'  in d);
      assert.ok('vehicle_id' in d);
      assert.ok('model'      in d);
      assert.ok('health'     in d);           // null when no heartbeat
      assert.ok('last_position' in d);        // null when no position
      assert.ok('current_fuel' in d);         // null in list endpoint
    }
  });

  it('?limit=1 returns exactly one device', async () => {
    const { body } = await api('GET', '/api/devices?limit=1', null, adminTok);
    assert.equal(body.devices.length, 1);
    assert.equal(body.limit, 1);
  });

  it('?offset beyond total returns empty devices array', async () => {
    const { body } = await api('GET', '/api/devices?offset=9999', null, adminTok);
    assert.equal(body.devices.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/devices/:imei/provision
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/devices/:imei/provision', () => {
  const NEW_IMEI = '860000000000003';

  it('401 without token', async () => {
    const r = await api('POST', `/api/devices/${NEW_IMEI}/provision`, { model: 'FMB920' });
    assert.equal(r.status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('POST', `/api/devices/${NEW_IMEI}/provision`, { model: 'FMB920' }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('201 with device + mqtt_credentials', async () => {
    const r = await api('POST', `/api/devices/${NEW_IMEI}/provision`, {
      model: 'FMB920', hauler_id: 'haul-02', serial: 'SER-003', notes: 'Test device',
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.device);
    assert.equal(r.body.device.imei, NEW_IMEI);
    assert.equal(r.body.device.model, 'FMB920');
    assert.equal(r.body.device.hauler_id, 'haul-02');
    assert.ok(r.body.device.active); // raw SQLite row — 1 (truthy), not Boolean
    assert.ok(r.body.mqtt_credentials);
    assert.equal(r.body.mqtt_credentials.username, NEW_IMEI);
    assert.ok(typeof r.body.mqtt_credentials.password === 'string');
    assert.ok(r.body.mqtt_credentials.password.length > 0);
    assert.ok(typeof r.body.mqtt_credentials.note === 'string');
  });

  it('409 on duplicate IMEI', async () => {
    // NEW_IMEI was already provisioned above
    const r = await api('POST', `/api/devices/${NEW_IMEI}/provision`, { model: 'FMB920' }, adminTok);
    assert.equal(r.status, 409);
    assert.ok(r.body.error);
  });

  it('provisioned device appears in the list', async () => {
    const { body } = await api('GET', '/api/devices', null, adminTok);
    const found = body.devices.find((d) => d.imei === NEW_IMEI);
    assert.ok(found, `${NEW_IMEI} not found in device list`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/devices/:imei — single
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/devices/:imei — single', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', `/api/devices/${DEV_A}`)).status, 401);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('GET', '/api/devices/000000000000000', null, adminTok);
    assert.equal(r.status, 404);
    assert.ok(r.body.error);
  });

  it('200 returns device shape for DEV_A (no vehicle)', async () => {
    const { status, body } = await api('GET', `/api/devices/${DEV_A}`, null, adminTok);
    assert.equal(status, 200);
    assert.equal(body.imei, DEV_A);
    assert.equal(body.active, true);
    assert.equal(body.hauler_id, 'haul-01');
    assert.equal(body.vehicle_id, null);
    assert.equal(body.health, null);
    assert.equal(body.last_position, null);
    assert.equal(body.current_fuel, null);
  });

  it('200 returns device shape for DEV_B (with vehicle)', async () => {
    const { status, body } = await api('GET', `/api/devices/${DEV_B}`, null, adminTok);
    assert.equal(status, 200);
    assert.equal(body.imei, DEV_B);
    assert.equal(body.vehicle_id, 'rig-test-01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/devices/:imei — update assignment
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/devices/:imei — update assignment', () => {
  it('401 without token', async () => {
    assert.equal((await api('PATCH', `/api/devices/${DEV_A}`, { notes: 'x' })).status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('PATCH', `/api/devices/${DEV_A}`, { notes: 'x' }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('PATCH', '/api/devices/000000000000000', { notes: 'x' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 updates notes and returns device', async () => {
    const r = await api('PATCH', `/api/devices/${DEV_A}`, { notes: 'Updated notes' }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.device);
    assert.equal(r.body.device.imei, DEV_A);
    assert.equal(r.body.device.notes, 'Updated notes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/devices/:imei/deactivate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/devices/:imei/deactivate', () => {
  before(async () => {
    // Provision a dedicated device so deactivation doesn't interfere with other tests
    await api('POST', `/api/devices/${DEV_C}/provision`, { model: 'FMB920' }, adminTok);
  });

  it('401 without token', async () => {
    assert.equal((await api('POST', `/api/devices/${DEV_C}/deactivate`)).status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('POST', `/api/devices/${DEV_C}/deactivate`, null, haulerTok);
    assert.equal(r.status, 403);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('POST', '/api/devices/000000000000000/deactivate', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 deactivates and returns ok + imei', async () => {
    const r = await api('POST', `/api/devices/${DEV_C}/deactivate`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.imei, DEV_C);
  });

  it('device shows active=false after deactivation', async () => {
    const r = await api('GET', `/api/devices/${DEV_C}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.active, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/devices/:imei/fuel
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/devices/:imei/fuel', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', `/api/devices/${DEV_A}/fuel`)).status, 401);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('GET', '/api/devices/000000000000000/fuel', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 returns { imei, readings: [] } (no readings seeded)', async () => {
    const { status, body } = await api('GET', `/api/devices/${DEV_A}/fuel`, null, adminTok);
    assert.equal(status, 200);
    assert.equal(body.imei, DEV_A);
    assert.ok(Array.isArray(body.readings));
  });

  it('?limit= is respected (defaults to 100, max 1000)', async () => {
    const { body } = await api('GET', `/api/devices/${DEV_A}/fuel?limit=5`, null, adminTok);
    assert.equal(body.imei, DEV_A);
    assert.ok(Array.isArray(body.readings));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/devices/:imei/calibration
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/devices/:imei/calibration', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', `/api/devices/${DEV_B}/calibration`)).status, 401);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('GET', '/api/devices/000000000000000/calibration', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('422 when device has no vehicle_id', async () => {
    const r = await api('GET', `/api/devices/${DEV_A}/calibration`, null, adminTok);
    assert.equal(r.status, 422);
    assert.ok(r.body.error);
  });

  it('200 returns { vehicle_id, points } for device with vehicle', async () => {
    const { status, body } = await api('GET', `/api/devices/${DEV_B}/calibration`, null, adminTok);
    assert.equal(status, 200);
    assert.equal(body.vehicle_id, 'rig-test-01');
    assert.ok(Array.isArray(body.points));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/devices/:imei/calibration
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/devices/:imei/calibration', () => {
  const VALID_POINTS = [
    { mm: 0,   litres: 0   },
    { mm: 100, litres: 50  },
    { mm: 200, litres: 100 },
    { mm: 300, litres: 150 },
  ];

  it('401 without token', async () => {
    assert.equal(
      (await api('PUT', `/api/devices/${DEV_B}/calibration`, { points: VALID_POINTS })).status,
      401,
    );
  });

  it('403 for hauler_admin', async () => {
    const r = await api('PUT', `/api/devices/${DEV_B}/calibration`, { points: VALID_POINTS }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('PUT', '/api/devices/000000000000000/calibration', { points: VALID_POINTS }, adminTok);
    assert.equal(r.status, 404);
  });

  it('422 when device has no vehicle_id', async () => {
    const r = await api('PUT', `/api/devices/${DEV_A}/calibration`, { points: VALID_POINTS }, adminTok);
    assert.equal(r.status, 422);
  });

  it('400 when fewer than 2 points', async () => {
    const r = await api('PUT', `/api/devices/${DEV_B}/calibration`, { points: [{ mm: 0, litres: 0 }] }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it('400 when points is not an array', async () => {
    const r = await api('PUT', `/api/devices/${DEV_B}/calibration`, { points: 'bad' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 for non-numeric mm value', async () => {
    const r = await api('PUT', `/api/devices/${DEV_B}/calibration`, {
      points: [{ mm: 'bad', litres: 0 }, { mm: 100, litres: 50 }],
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 for negative mm value', async () => {
    const r = await api('PUT', `/api/devices/${DEV_B}/calibration`, {
      points: [{ mm: -10, litres: 0 }, { mm: 100, litres: 50 }],
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 for duplicate mm values', async () => {
    const r = await api('PUT', `/api/devices/${DEV_B}/calibration`, {
      points: [{ mm: 100, litres: 50 }, { mm: 100, litres: 60 }],
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it('200 saves calibration and returns sorted points', async () => {
    // Submit out-of-order — expect them back sorted ascending by mm
    const unordered = [
      { mm: 300, litres: 150 },
      { mm: 0,   litres: 0   },
      { mm: 200, litres: 100 },
      { mm: 100, litres: 50  },
    ];
    const { status, body } = await api('PUT', `/api/devices/${DEV_B}/calibration`, { points: unordered }, adminTok);
    assert.equal(status, 200);
    assert.equal(body.vehicle_id, 'rig-test-01');
    assert.ok(Array.isArray(body.points));
    assert.equal(body.points.length, 4);
    // Verify sorted ascending by mm
    for (let i = 1; i < body.points.length; i++) {
      assert.ok(body.points[i].mm >= body.points[i - 1].mm, 'points not sorted by mm');
    }
    assert.equal(body.points[0].mm, 0);
    assert.equal(body.points[3].mm, 300);
  });

  it('subsequent GET calibration returns the saved points', async () => {
    const { status, body } = await api('GET', `/api/devices/${DEV_B}/calibration`, null, adminTok);
    assert.equal(status, 200);
    assert.equal(body.points.length, 4);
  });

  it('PUT replaces previous calibration (idempotent)', async () => {
    const twoPoints = [{ mm: 0, litres: 0 }, { mm: 400, litres: 200 }];
    const { status, body } = await api('PUT', `/api/devices/${DEV_B}/calibration`, { points: twoPoints }, adminTok);
    assert.equal(status, 200);
    assert.equal(body.points.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/devices/:imei/events
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/devices/:imei/events', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', `/api/devices/${DEV_A}/events`)).status, 401);
  });

  it('404 for unknown IMEI', async () => {
    const r = await api('GET', '/api/devices/000000000000000/events', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 returns { imei, events: [] } (no events seeded)', async () => {
    const { status, body } = await api('GET', `/api/devices/${DEV_A}/events`, null, adminTok);
    assert.equal(status, 200);
    assert.equal(body.imei, DEV_A);
    assert.ok(Array.isArray(body.events));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', `/api/devices/${DEV_A}/events`, null, opsTok)).status, 200);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', `/api/devices/${DEV_A}/events`, null, haulerTok)).status, 403);
  });
});
