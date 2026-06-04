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
const PASS = 'test-pos-x7';
insertUser.run('u-adm', 'admin@pos.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@pos.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);

// ── Seed a couple of positions for tests ─────────────────────────────
const positionStore = require('../state/positionStore');
positionStore.upsert({ vehicle_id: 'TRK-H01-A', hauler_id: 'haul-01', latitude: 6.5,  longitude: -2.1, speed_kmh: 60, heading_deg: 180, position_at: NOW });
positionStore.upsert({ vehicle_id: 'TRK-H02-A', hauler_id: 'haul-02', latitude: 5.0,  longitude: -1.8, speed_kmh: 45, heading_deg: 90,  position_at: NOW });

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',      require('../routes/auth'));
app.use('/api/positions', require('../routes/positions'));

// ── Lifecycle ─────────────────────────────────────────────────────────
let base;
let adminTok, h01Tok;
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
  adminTok = await login('admin@pos.test');
  h01Tok   = await login('h01@pos.test');
});

after(() => new Promise((resolve) => server.close(resolve)));

async function api(method, path, token) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/positions', () => {
  it('returns 401 for unauthenticated request', async () => {
    const r = await api('GET', '/api/positions');
    assert.equal(r.status, 401);
  });

  it('returns 200 with count and positions array for axis_admin', async () => {
    const r = await api('GET', '/api/positions', adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.count === 'number',       'count is a number');
    assert.ok(Array.isArray(r.body.positions),        'positions is an array');
    assert.ok(r.body.count >= 2,                      'at least 2 positions');
  });

  it('each position has required fields', async () => {
    const r = await api('GET', '/api/positions', adminTok);
    const p = r.body.positions[0];
    assert.ok('vehicle_id'          in p, 'vehicle_id');
    assert.ok('hauler_id'           in p, 'hauler_id');
    assert.ok('hauler_display_name' in p, 'hauler_display_name');
    assert.ok('latitude'            in p, 'latitude');
    assert.ok('longitude'           in p, 'longitude');
  });

  it('hauler_admin only sees their own hauler positions', async () => {
    const r = await api('GET', '/api/positions', h01Tok);
    assert.equal(r.status, 200);
    for (const p of r.body.positions) {
      assert.equal(p.hauler_id, 'haul-01', 'only haul-01 positions');
    }
  });

  it('hauler_id filter works for axis_admin', async () => {
    const r = await api('GET', '/api/positions?hauler_id=haul-02', adminTok);
    assert.equal(r.status, 200);
    for (const p of r.body.positions) {
      assert.equal(p.hauler_id, 'haul-02', 'only haul-02 positions');
    }
  });
});

describe('GET /api/positions/:vehicle_id', () => {
  it('returns 200 with position for known vehicle', async () => {
    const r = await api('GET', '/api/positions/TRK-H01-A', adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.vehicle_id, 'TRK-H01-A');
    assert.ok(r.body.latitude  != null, 'latitude present');
    assert.ok(r.body.longitude != null, 'longitude present');
  });

  it('returns 404 for unknown vehicle', async () => {
    const r = await api('GET', '/api/positions/TRK-GHOST', adminTok);
    assert.equal(r.status, 404);
  });
});
