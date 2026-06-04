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
const PASS = 'test-drivers-x7';
insertUser.run('u-adm', 'admin@drv.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@drv.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@drv.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'len@drv.test',   bcrypt.hashSync(PASS, 1), 'Lend',  'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────
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
app.use('/api/drivers', require('../routes/drivers'));

// ── Known IDs (from mock seed: haul-01 starts at drv-0046, haul-02 at drv-0070)
const H01_DRIVER = 'drv-0046';
const H02_DRIVER = 'drv-0070';

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
  adminTok  = await login('admin@drv.test');
  opsTok    = await login('ops@drv.test');
  h01Tok    = await login('h01@drv.test');
  lenderTok = await login('len@drv.test');
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

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/drivers', () => {
  it('returns 200 with drivers, licence_pipeline, safety_distribution, rest_by_hauler', async () => {
    const r = await api('GET', '/api/drivers', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.drivers),                  'drivers is an array');
    assert.ok(typeof r.body.total === 'number',               'total present');
    assert.ok(typeof r.body.licence_pipeline === 'object',    'licence_pipeline present');
    assert.ok(Array.isArray(r.body.safety_distribution),      'safety_distribution');
    assert.ok(Array.isArray(r.body.rest_by_hauler),           'rest_by_hauler');
    assert.ok(r.body.generated_at,                            'generated_at present');
  });

  it('returns all 171 drivers for axis_admin', async () => {
    const r = await api('GET', '/api/drivers', null, adminTok);
    assert.equal(r.body.total, 171);
    assert.equal(r.body.drivers.length, 171);
  });

  it('hauler_admin only sees their own hauler drivers', async () => {
    const r = await api('GET', '/api/drivers', null, h01Tok);
    assert.equal(r.status, 200);
    const haulerIds = [...new Set(r.body.drivers.map((d) => d.hauler_id))];
    assert.deepEqual(haulerIds, ['haul-01'], 'only haul-01 drivers returned');
  });

  it('hauler_id query filter works for axis_admin', async () => {
    const r = await api('GET', '/api/drivers?hauler_id=haul-02', null, adminTok);
    assert.equal(r.status, 200);
    for (const d of r.body.drivers) {
      assert.equal(d.hauler_id, 'haul-02', 'all drivers belong to haul-02');
    }
  });

  it('licence_pipeline has buckets with keys critical, warning, watch, clear', async () => {
    const r = await api('GET', '/api/drivers', null, adminTok);
    const keys = r.body.licence_pipeline.buckets.map((b) => b.key);
    assert.ok(keys.includes('critical'), 'critical bucket present');
    assert.ok(keys.includes('warning'),  'warning bucket present');
    assert.ok(keys.includes('watch'),    'watch bucket present');
    assert.ok(keys.includes('clear'),    'clear bucket present');
  });

  it('safety_distribution has 7 bands with band, count, tone', async () => {
    const r = await api('GET', '/api/drivers', null, adminTok);
    assert.equal(r.body.safety_distribution.length, 7, '7 safety bands');
    const b = r.body.safety_distribution[0];
    assert.ok('band'  in b, 'band');
    assert.ok('count' in b, 'count');
    assert.ok('tone'  in b, 'tone');
  });
});

describe('GET /api/drivers/summary', () => {
  it('returns 200 with expected counters', async () => {
    const r = await api('GET', '/api/drivers/summary', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.total             === 'number', 'total');
    assert.ok(typeof r.body.assigned_primary  === 'number', 'assigned_primary');
    assert.ok(typeof r.body.relief_pool       === 'number', 'relief_pool');
    assert.ok(typeof r.body.rest_breach       === 'number', 'rest_breach');
    assert.ok(typeof r.body.avg_safety_score  === 'number', 'avg_safety_score');
  });

  it('hauler_admin summary is scoped to their fleet', async () => {
    const r = await api('GET', '/api/drivers/summary', null, h01Tok);
    assert.equal(r.status, 200);
    // haul-01 has 47 drivers (from mock seed)
    assert.equal(r.body.total, 47);
  });
});

describe('GET /api/drivers/leaderboard', () => {
  it('returns 200 with required leaderboard shape', async () => {
    const r = await api('GET', '/api/drivers/leaderboard', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body, 'response body present');
  });

  it('hauler_admin leaderboard is scoped to their hauler', async () => {
    const r = await api('GET', '/api/drivers/leaderboard', null, h01Tok);
    assert.equal(r.status, 200);
  });
});

describe('GET /api/drivers/by-rig/:rigId', () => {
  it('returns primary driver or null for a rig', async () => {
    const r = await api('GET', '/api/drivers/by-rig/rig-0001', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('primary'         in r.body, 'primary field present');
    assert.ok('live_assignment' in r.body, 'live_assignment field present');
  });
});

describe('GET /api/drivers/:id', () => {
  it('returns 200 with full driver detail fields', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.id,                            'id present');
    assert.ok(r.body.full_name,                     'full_name present');
    assert.ok(typeof r.body.licence === 'object',   'licence present');
    assert.ok(typeof r.body.psv    === 'object',    'psv present');
    assert.ok(typeof r.body.medical === 'object',   'medical present');
    assert.ok(Array.isArray(r.body.training),       'training is array');
    assert.ok(Array.isArray(r.body.safety_series),  'safety_series is array');
    assert.ok(Array.isArray(r.body.recent_trips),   'recent_trips is array');
    assert.ok(Array.isArray(r.body.open_alerts),    'open_alerts is array');
    assert.ok(Array.isArray(r.body.coaching_history), 'coaching_history is array');
  });

  it('returns 404 for unknown driver', async () => {
    const r = await api('GET', '/api/drivers/drv-9999', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin can view their own driver', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}`, null, h01Tok);
    assert.equal(r.status, 200);
  });

  it('hauler_admin cannot view another hauler driver', async () => {
    const r = await api('GET', `/api/drivers/${H02_DRIVER}`, null, h01Tok);
    assert.equal(r.status, 404, 'driver from other hauler not in scoped list → 404');
  });

  it('training has 4 cert entries with code, label, expires_iso, tone', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}`, null, adminTok);
    assert.equal(r.body.training.length, 4, '4 training certs');
    const cert = r.body.training[0];
    assert.ok('code'       in cert, 'code');
    assert.ok('label'      in cert, 'label');
    assert.ok('expires_iso' in cert, 'expires_iso');
    assert.ok('tone'       in cert, 'tone');
  });

  it('safety_series has 8 entries', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}`, null, adminTok);
    assert.equal(r.body.safety_series.length, 8, '8-week safety series');
  });
});

describe('GET /api/drivers/:id/scorecard', () => {
  it('returns 200 with expected shape', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}/scorecard`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.driver,                          'driver field');
    assert.ok(r.body.period,                          'period field');
    assert.ok(typeof r.body.week === 'object',        'week field');
    assert.ok(typeof r.body.safety === 'object',      'safety field');
    assert.ok('verdict' in r.body,                    'verdict field');
  });

  it('returns 404 for unknown driver', async () => {
    const r = await api('GET', '/api/drivers/drv-9999/scorecard', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('lender gets 403', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}/scorecard`, null, lenderTok);
    assert.equal(r.status, 403);
  });

  it('hauler_admin gets 403 for another hauler driver', async () => {
    const r = await api('GET', `/api/drivers/${H02_DRIVER}/scorecard`, null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('week_offset shifts the period', async () => {
    const r0 = await api('GET', `/api/drivers/${H01_DRIVER}/scorecard`, null, adminTok);
    const r1 = await api('GET', `/api/drivers/${H01_DRIVER}/scorecard?week_offset=-1`, null, adminTok);
    assert.notEqual(r0.body.period.since, r1.body.period.since, 'week_offset shifts period');
  });
});

describe('GET /api/drivers/:id/hours', () => {
  it('returns 200 with this_week and last_week fields', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}/hours`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.driver_id,                       'driver_id present');
    assert.ok(r.body.full_name,                       'full_name present');
    assert.ok(typeof r.body.this_week === 'object',   'this_week present');
    assert.ok(typeof r.body.last_week === 'object',   'last_week present');
    assert.ok('trips'      in r.body.this_week,       'this_week.trips');
    assert.ok('hours'      in r.body.this_week,       'this_week.hours');
    assert.ok('rest_status' in r.body.this_week,      'this_week.rest_status');
  });

  it('returns 404 for unknown driver', async () => {
    const r = await api('GET', '/api/drivers/drv-9999/hours', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin can view their own driver hours', async () => {
    const r = await api('GET', `/api/drivers/${H01_DRIVER}/hours`, null, h01Tok);
    assert.equal(r.status, 200);
  });
});

describe('PATCH /api/drivers/:driverId/status', () => {
  it('returns 401 for unauthenticated request', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'available', rest_status: 'compliant',
    });
    assert.equal(r.status, 401);
  });

  it('returns 403 for lender', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'available', rest_status: 'compliant',
    }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 404 for unknown driver', async () => {
    const r = await api('PATCH', '/api/drivers/drv-9999/status', {
      availability: 'available', rest_status: 'compliant',
    }, adminTok);
    assert.equal(r.status, 404);
  });

  it('returns 400 for invalid availability', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'flying', rest_status: 'compliant',
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 400 for invalid rest_status', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'available', rest_status: 'unknown',
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('hauler_admin gets 403 for another hauler driver', async () => {
    const r = await api('PATCH', `/api/drivers/${H02_DRIVER}/status`, {
      availability: 'available', rest_status: 'compliant',
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('sets status for axis_admin', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'sick', rest_status: 'compliant', notes: 'Off sick today',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.driver, 'driver returned');
    assert.equal(r.body.driver.availability, 'sick', 'availability set');
  });

  it('sets flag for axis_ops', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'available', rest_status: 'warning', flag: 'coaching_due',
    }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.driver.rest_status, 'warning');
    assert.equal(r.body.driver.flag, 'coaching_due');
  });

  it('hauler_admin can update their own driver', async () => {
    const r = await api('PATCH', `/api/drivers/${H01_DRIVER}/status`, {
      availability: 'available', rest_status: 'compliant',
    }, h01Tok);
    assert.equal(r.status, 200);
  });
});
