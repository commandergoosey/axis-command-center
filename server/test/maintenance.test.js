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
const PASS = 'test-maint-x7';
insertUser.run('u-adm', 'admin@maint.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@maint.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@maint.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'len@maint.test',   bcrypt.hashSync(PASS, 1), 'Len',   'lender',       null,      'Fin',  NOW, NOW);

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
app.use('/api/auth',        require('../routes/auth'));
app.use('/api/maintenance', require('../routes/maintenance'));

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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASS }),
    });
    return (await r.json()).token;
  };
  adminTok  = await login('admin@maint.test');
  opsTok    = await login('ops@maint.test');
  h01Tok    = await login('h01@maint.test');
  lenderTok = await login('len@maint.test');
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

// Known rig IDs from mock fleet (no auth needed for GET / and /:rigId)
const H01_ACTIVE    = 'rig-0001'; // haul-01, active, no flag
const H01_CRITICAL  = 'rig-0030'; // haul-01, critical, garage
const H01_SVC_DUE   = 'rig-0011'; // haul-01, service_due
const H02_SVC_DUE   = 'rig-0032'; // haul-02, service_due

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/maintenance', () => {
  it('returns 200 without auth (open endpoint)', async () => {
    const r = await api('GET', '/api/maintenance');
    assert.equal(r.status, 200);
  });

  it('returns expected top-level fields', async () => {
    const r = await api('GET', '/api/maintenance');
    assert.ok(r.body.generated_at,                          'generated_at present');
    assert.ok(typeof r.body.counters === 'object',          'counters present');
    assert.ok(Array.isArray(r.body.in_workshop),            'in_workshop array');
    assert.ok(Array.isArray(r.body.service_due),            'service_due array');
    assert.ok(Array.isArray(r.body.road_worthy_expiring_30d), 'road_worthy_expiring_30d array');
    assert.ok(Array.isArray(r.body.critical),               'critical array');
    assert.ok(Array.isArray(r.body.recent_completions),     'recent_completions array');
    assert.ok(Array.isArray(r.body.cost_trend),             'cost_trend array');
  });

  it('counters object has expected keys', async () => {
    const r = await api('GET', '/api/maintenance');
    const c = r.body.counters;
    assert.ok('in_workshop'              in c, 'in_workshop');
    assert.ok('service_due'              in c, 'service_due');
    assert.ok('road_worthy_expiring_30d' in c, 'road_worthy_expiring_30d');
    assert.ok('critical'                 in c, 'critical');
    assert.ok('critical_remediating'     in c, 'critical_remediating');
    assert.ok('critical_unremediated'    in c, 'critical_unremediated');
    assert.ok(c.service_due >= 24,             'at least 24 service_due rigs');
  });

  it('cost_trend has 8 weekly entries with required fields', async () => {
    const r = await api('GET', '/api/maintenance');
    assert.equal(r.body.cost_trend.length, 8, '8 weeks of cost trend');
    const entry = r.body.cost_trend[0];
    assert.ok('week'         in entry, 'week');
    assert.ok('workshop_usd' in entry, 'workshop_usd');
    assert.ok('parts_usd'    in entry, 'parts_usd');
    assert.ok('total_usd'    in entry, 'total_usd');
    assert.ok('rigs_in_shop' in entry, 'rigs_in_shop');
    assert.ok(entry.modelled === true,  'modelled flag');
  });

  it('road_worthy_pipeline present with buckets and by_hauler', async () => {
    const r = await api('GET', '/api/maintenance');
    assert.ok(typeof r.body.road_worthy_pipeline === 'object', 'road_worthy_pipeline present');
    assert.ok(Array.isArray(r.body.road_worthy_pipeline.buckets),   'buckets array');
    assert.ok(Array.isArray(r.body.road_worthy_pipeline.by_hauler), 'by_hauler array');
    const bucket = r.body.road_worthy_pipeline.buckets[0];
    assert.ok('key'   in bucket, 'bucket.key');
    assert.ok('label' in bucket, 'bucket.label');
    assert.ok('count' in bucket, 'bucket.count');
  });

  it('hauler_admin only sees their own hauler rigs', async () => {
    const r = await api('GET', '/api/maintenance', null, h01Tok);
    assert.equal(r.status, 200);
    const allRigs = [
      ...r.body.in_workshop,
      ...r.body.service_due,
      ...r.body.road_worthy_expiring_30d,
      ...r.body.critical,
    ];
    for (const rig of allRigs) {
      assert.equal(rig.hauler_id, 'haul-01', `rig ${rig.id} must be haul-01`);
    }
  });
});

describe('GET /api/maintenance/:rigId', () => {
  it('returns 200 with rig detail for known rig (no auth)', async () => {
    const r = await api('GET', `/api/maintenance/${H01_ACTIVE}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, H01_ACTIVE);
    assert.ok('plate' in r.body, 'plate present');
    assert.ok('hauler_id' in r.body, 'hauler_id present');
  });

  it('includes history, open_defects, workorders, related_alerts', async () => {
    const r = await api('GET', `/api/maintenance/${H01_SVC_DUE}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.history),        'history array');
    assert.ok(Array.isArray(r.body.open_defects),   'open_defects array');
    assert.ok(Array.isArray(r.body.workorders),     'workorders array');
    assert.ok(Array.isArray(r.body.related_alerts), 'related_alerts array');
    assert.ok(r.body.open_defects.length >= 1, 'service_due rig has at least one defect');
  });

  it('critical rig has a CRITICAL defect', async () => {
    const r = await api('GET', `/api/maintenance/${H01_CRITICAL}`);
    assert.equal(r.status, 200);
    const crit = r.body.open_defects.find((d) => d.severity === 'CRITICAL');
    assert.ok(crit, 'at least one CRITICAL defect on critical rig');
  });

  it('returns 404 for unknown rig', async () => {
    const r = await api('GET', '/api/maintenance/rig-9999');
    assert.equal(r.status, 404);
  });

  it('hauler_admin gets 403 for a rig from another hauler', async () => {
    const r = await api('GET', `/api/maintenance/${H02_SVC_DUE}`, null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('hauler_admin can see their own rig', async () => {
    const r = await api('GET', `/api/maintenance/${H01_ACTIVE}`, null, h01Tok);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, H01_ACTIVE);
  });
});

describe('GET /api/maintenance/workorders/list', () => {
  it('returns 200 with workorders array (no auth needed)', async () => {
    const r = await api('GET', '/api/maintenance/workorders/list');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.workorders), 'workorders is array');
    assert.ok(r.body.generated_at,              'generated_at present');
  });
});

describe('Workorder lifecycle — POST + progress + resolve', () => {
  let workorderId;

  it('returns 401 for unauthenticated workorder create', async () => {
    const r = await api('POST', `/api/maintenance/${H01_ACTIVE}/workorders`, { title: 'Test WO' });
    assert.equal(r.status, 401);
  });

  it('returns 400 when title is missing', async () => {
    const r = await api('POST', `/api/maintenance/${H01_ACTIVE}/workorders`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('title'), 'error mentions title');
  });

  it('returns 404 for unknown rig', async () => {
    const r = await api('POST', '/api/maintenance/rig-9999/workorders', { title: 'Test WO' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin gets 403 for another hauler rig', async () => {
    const r = await api('POST', `/api/maintenance/${H02_SVC_DUE}/workorders`, { title: 'Test WO' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('creates workorder successfully for axis_admin', async () => {
    const r = await api('POST', `/api/maintenance/${H01_ACTIVE}/workorders`,
      { title: 'Test workorder — brake check' }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.id,                   'workorder id returned');
    assert.equal(r.body.rig_id, H01_ACTIVE,'rig_id matches');
    assert.equal(r.body.status, 'OPEN',    'status is OPEN');
    workorderId = r.body.id;
  });

  it('returns 409 when rig already has an active workorder', async () => {
    const r = await api('POST', `/api/maintenance/${H01_ACTIVE}/workorders`,
      { title: 'Duplicate WO' }, adminTok);
    assert.equal(r.status, 409);
    assert.ok(r.body.workorder, 'existing workorder returned');
  });

  it('lender gets 403 trying to create workorder', async () => {
    const r = await api('POST', `/api/maintenance/${H01_ACTIVE}/workorders`,
      { title: 'Lender WO' }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('progresses workorder to IN_PROGRESS', async () => {
    const r = await api('POST', `/api/maintenance/workorders/${workorderId}/progress`,
      { note: 'Parts ordered' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'IN_PROGRESS', 'status moved to IN_PROGRESS');
  });

  it('resolves workorder with required resolution_note', async () => {
    const r = await api('POST', `/api/maintenance/workorders/${workorderId}/resolve`,
      { resolution_note: 'Brake pads replaced', cost_usd: 800, hours: 3 }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'RESOLVED', 'status is RESOLVED');
    assert.equal(r.body.cost_usd, 800);
  });

  it('resolve returns 400 when resolution_note is missing', async () => {
    // Open a new workorder on a different rig to test validation
    await api('POST', `/api/maintenance/${H01_SVC_DUE}/workorders`,
      { title: 'Validation test WO' }, adminTok);
    const list = await api('GET', '/api/maintenance/workorders/list', null, adminTok);
    const wo = list.body.workorders.find((w) => w.rig_id === H01_SVC_DUE && w.status !== 'RESOLVED');
    const r = await api('POST', `/api/maintenance/workorders/${wo.id}/resolve`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('resolution_note'), 'error mentions resolution_note');
  });

  it('returns 404 progress/resolve for unknown workorder', async () => {
    const r1 = await api('POST', '/api/maintenance/workorders/wo-bogus/progress', { note: 'x' }, adminTok);
    const r2 = await api('POST', '/api/maintenance/workorders/wo-bogus/resolve',
      { resolution_note: 'x' }, adminTok);
    assert.equal(r1.status, 404);
    assert.equal(r2.status, 404);
  });

  it('returns 400 on double-resolve', async () => {
    const r = await api('POST', `/api/maintenance/workorders/${workorderId}/resolve`,
      { resolution_note: 'Already resolved' }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('already resolved'), 'error mentions already resolved');
  });
});

describe('Maintenance schedule CRUD', () => {
  const tomorrow   = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const dayAfter   = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  let scheduleId;
  let scheduleId2;

  it('GET /schedule returns 401 without auth', async () => {
    const r = await api('GET', '/api/maintenance/schedule');
    assert.equal(r.status, 401);
  });

  it('GET /schedule returns 200 with schedule + counts_by_hauler_today', async () => {
    const r = await api('GET', '/api/maintenance/schedule', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.schedule),                    'schedule array');
    assert.ok(typeof r.body.counts_by_hauler_today === 'object', 'counts_by_hauler_today object');
  });

  it('lender gets 403 for POST /schedule', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H01_ACTIVE, hauler_id: 'haul-01', type: 'inspection', start_at: tomorrow, end_at: dayAfter,
    }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 400 for invalid schedule type', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H01_ACTIVE, hauler_id: 'haul-01', type: 'flying', start_at: tomorrow, end_at: dayAfter,
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 400 when end_at is before start_at', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H01_ACTIVE, hauler_id: 'haul-01', type: 'inspection', start_at: dayAfter, end_at: tomorrow,
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('hauler_admin gets 403 for another hauler rig in schedule', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H02_SVC_DUE, hauler_id: 'haul-02', type: 'inspection', start_at: tomorrow, end_at: dayAfter,
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('creates schedule entry successfully for axis_admin', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H01_ACTIVE, hauler_id: 'haul-01', type: 'inspection',
      start_at: tomorrow, end_at: dayAfter, notes: 'Routine DVLA check',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.scheduled.id,                        'id returned');
    assert.equal(r.body.scheduled.rig_id, H01_ACTIVE,    'rig_id matches');
    assert.equal(r.body.scheduled.type, 'inspection',    'type matches');
    assert.equal(r.body.scheduled.status, 'planned',     'status is planned');
    scheduleId = r.body.scheduled.id;
  });

  it('creates schedule entry for axis_ops', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H01_SVC_DUE, hauler_id: 'haul-01', type: 'service_a',
      start_at: tomorrow, end_at: dayAfter,
    }, opsTok);
    assert.equal(r.status, 200);
    scheduleId2 = r.body.scheduled.id;
  });

  it('hauler_admin can schedule their own rig', async () => {
    const r = await api('POST', '/api/maintenance/schedule', {
      rig_id: H01_ACTIVE, hauler_id: 'haul-01', type: 'tyre',
      start_at: tomorrow, end_at: dayAfter,
    }, h01Tok);
    assert.equal(r.status, 200);
  });

  it('PATCH /schedule/:id updates the entry', async () => {
    const r = await api('PATCH', `/api/maintenance/schedule/${scheduleId}`,
      { notes: 'Updated note — new inspector assigned' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.scheduled.notes, 'Updated note — new inspector assigned');
  });

  it('PATCH returns 404 for unknown schedule id', async () => {
    const r = await api('PATCH', '/api/maintenance/schedule/99999', { notes: 'x' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('completes a schedule entry', async () => {
    const r = await api('POST', `/api/maintenance/schedule/${scheduleId}/complete`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.scheduled.status, 'completed', 'status is completed');
    assert.ok(r.body.scheduled.completed_at, 'completed_at set');
  });

  it('cancels a schedule entry', async () => {
    const r = await api('POST', `/api/maintenance/schedule/${scheduleId2}/cancel`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.scheduled.status, 'cancelled', 'status is cancelled');
  });

  it('complete returns 404 for unknown id', async () => {
    const r = await api('POST', '/api/maintenance/schedule/99999/complete', {}, adminTok);
    assert.equal(r.status, 404);
  });

  it('cancel returns 404 for unknown id', async () => {
    const r = await api('POST', '/api/maintenance/schedule/99999/cancel', {}, adminTok);
    assert.equal(r.status, 404);
  });

  it('GET /schedule shows created entries (hauler_admin scoped to haul-01)', async () => {
    const r = await api('GET', '/api/maintenance/schedule', null, h01Tok);
    assert.equal(r.status, 200);
    for (const entry of r.body.schedule) {
      assert.equal(entry.hauler_id, 'haul-01', `entry ${entry.id} must be haul-01`);
    }
  });
});

describe('POST /api/maintenance/targets daily throughput', () => {
  it('is not handled here — routes/today owns POST /targets', async () => {
    // maintenance.js has no /targets route; verify it correctly returns 404
    const r = await api('POST', '/api/maintenance/targets', { target_tonnes: 100 }, adminTok);
    assert.equal(r.status, 404);
  });
});
