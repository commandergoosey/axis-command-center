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
const ADMIN_PASS = 'adm-al-xx9';
const OPS_PASS   = 'ops-al-xx9';
const HAUL1_PASS = 'hau1-al-xx9';
const HAUL2_PASS = 'hau2-al-xx9';
const LEND_PASS  = 'len-al-xx9';
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm',  'admin@alerts.gh',  bcrypt.hashSync(ADMIN_PASS, 1), 'Test Admin',  'axis_admin',   null,      'AXIS',      NOW, NOW);
insertUser.run('u-ops',  'ops@alerts.gh',    bcrypt.hashSync(OPS_PASS,   1), 'Test Ops',    'axis_ops',     null,      'AXIS',      NOW, NOW);
insertUser.run('u-hau1', 'haul1@alerts.gh',  bcrypt.hashSync(HAUL1_PASS, 1), 'Hauler One',  'hauler_admin', 'haul-01', 'TruckCo',   NOW, NOW);
insertUser.run('u-hau2', 'haul2@alerts.gh',  bcrypt.hashSync(HAUL2_PASS, 1), 'Hauler Two',  'hauler_admin', 'haul-02', 'RoadRunner',NOW, NOW);
insertUser.run('u-len',  'lender@alerts.gh', bcrypt.hashSync(LEND_PASS,  1), 'Test Lender', 'lender',       null,      'Finance',   NOW, NOW);

// ── Fixed alert fixtures (stub allAlerts) ─────────────────────────────
const PAST = new Date(Date.now() - 10 * 3_600_000).toISOString(); // 10 h ago

const TEST_ALERTS = [
  { id: 'al-001', severity: 'CRITICAL', type: 'speed',       hauler_id: 'haul-01', status: 'NEEDS_ACTION', opened_at: PAST, title: 'Speed breach',  generated: false },
  { id: 'al-002', severity: 'WARNING',  type: 'idle_engine', hauler_id: 'haul-02', status: 'NEEDS_ACTION', opened_at: PAST, title: 'Idle alert',    generated: true  },
  { id: 'al-003', severity: 'INFO',     type: 'low_fuel',    hauler_id: null,      status: 'MONITORING',  opened_at: PAST, title: 'Low fuel',      generated: true  },
  { id: 'al-004', severity: 'CRITICAL', type: 'hse_event',   hauler_id: 'haul-01', status: 'NEEDS_ACTION', opened_at: PAST, title: 'HSE incident',  generated: false },
];

// ── Stubs (must precede requiring routes/alerts) ──────────────────────

const alertSynthKey = require.resolve('../services/alertSynth');
require.cache[alertSynthKey] = {
  id: alertSynthKey, filename: alertSynthKey, loaded: true,
  exports: {
    allAlerts:        () => TEST_ALERTS,
    autoClearedAlerts: () => [],
  },
};

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

const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {} },
};

// ── App setup ─────────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const alertState     = require('../state/alertState');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',   require('../routes/auth'));
app.use('/api/alerts', require('../routes/alerts'));

let server, base;

before(() => new Promise((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

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

// Future ISO timestamp for snooze tests.
const FUTURE_ISO = new Date(Date.now() + 3_600_000).toISOString();
const PAST_ISO   = new Date(Date.now() - 3_600_000).toISOString();

// ─────────────────────────────────────────────────────────────────────

describe('alerts — GET /alerts response shape', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });

  it('returns 200 with expected top-level keys', async () => {
    const res = await api('GET', '/api/alerts', null, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok('alerts'              in body, 'alerts missing');
    assert.ok('summary'             in body, 'summary missing');
    assert.ok('severity_trend'      in body, 'severity_trend missing');
    assert.ok('alert_age_profile'   in body, 'alert_age_profile missing');
    assert.ok('resolution_by_type'  in body, 'resolution_by_type missing');
    assert.ok('alert_volume_by_hauler' in body, 'alert_volume_by_hauler missing');
    assert.ok('auto_cleared'        in body, 'auto_cleared missing');
  });

  it('summary.open_total counts NEEDS_ACTION + MONITORING', async () => {
    const res  = await api('GET', '/api/alerts', null, adminToken);
    const { summary } = await res.json();
    // TEST_ALERTS: 3 NEEDS_ACTION + 1 MONITORING = 4 open
    assert.strictEqual(summary.open_total, 4);
  });

  it('summary.unassigned equals open_total when nothing is assigned', async () => {
    alertState.reset();
    const res  = await api('GET', '/api/alerts', null, adminToken);
    const { summary } = await res.json();
    assert.strictEqual(summary.unassigned, summary.open_total);
  });

  it('severity_trend is an array of 8 weeks', async () => {
    const res  = await api('GET', '/api/alerts', null, adminToken);
    const { severity_trend } = await res.json();
    assert.ok(Array.isArray(severity_trend));
    assert.strictEqual(severity_trend.length, 8);
    assert.ok('week' in severity_trend[0]);
    assert.ok('critical' in severity_trend[0]);
  });

  it('alert_age_profile has buckets array and oldest_open_days', async () => {
    const res  = await api('GET', '/api/alerts', null, adminToken);
    const { alert_age_profile } = await res.json();
    assert.ok(Array.isArray(alert_age_profile.buckets));
    assert.ok(typeof alert_age_profile.oldest_open_days === 'number');
  });

  it('each alert has hauler_display_name populated', async () => {
    const res    = await api('GET', '/api/alerts', null, adminToken);
    const { alerts } = await res.json();
    const haul01alerts = alerts.filter((a) => a.hauler_id === 'haul-01');
    assert.ok(haul01alerts.length > 0, 'should have haul-01 alerts');
    assert.ok(haul01alerts.every((a) => a.hauler_display_name === 'TruckCo'));
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — GET /alerts query filters', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });

  it('?severity=CRITICAL returns only critical alerts', async () => {
    const res = await api('GET', '/api/alerts?severity=CRITICAL', null, adminToken);
    const { alerts } = await res.json();
    assert.ok(alerts.length > 0);
    assert.ok(alerts.every((a) => a.severity === 'CRITICAL'), 'non-CRITICAL alert leaked through');
  });

  it('?hauler_id=haul-01 returns only haul-01 alerts', async () => {
    const res = await api('GET', '/api/alerts?hauler_id=haul-01', null, adminToken);
    const { alerts } = await res.json();
    assert.ok(alerts.length > 0);
    assert.ok(alerts.every((a) => a.hauler_id === 'haul-01'));
  });

  it('?status=MONITORING returns only MONITORING alerts', async () => {
    const res = await api('GET', '/api/alerts?status=MONITORING', null, adminToken);
    const { alerts } = await res.json();
    assert.ok(alerts.every((a) => a.status === 'MONITORING'));
  });

  it('?source=generated returns only generated alerts', async () => {
    const res = await api('GET', '/api/alerts?source=generated', null, adminToken);
    const { alerts } = await res.json();
    // al-002 and al-003 are generated
    assert.ok(alerts.every((a) => a.generated === true));
  });

  it('?source=curated returns only non-generated alerts', async () => {
    const res = await api('GET', '/api/alerts?source=curated', null, adminToken);
    const { alerts } = await res.json();
    assert.ok(alerts.every((a) => !a.generated));
  });

  it('?type=speed returns only speed alerts', async () => {
    const res = await api('GET', '/api/alerts?type=speed', null, adminToken);
    const { alerts } = await res.json();
    assert.ok(alerts.every((a) => a.type === 'speed'));
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — hauler scope on GET /alerts', () => {
  before(() => alertState.reset());

  it('hauler_admin sees only own hauler + corridor-wide alerts', async () => {
    const token = await login('haul1@alerts.gh', HAUL1_PASS);
    const res   = await api('GET', '/api/alerts', null, token);
    const { alerts } = await res.json();
    // haul-01 alerts (al-001, al-004) + null-hauler corridor (al-003)
    assert.ok(alerts.every((a) => !a.hauler_id || a.hauler_id === 'haul-01'),
      'hauler admin must not see other hauler alerts');
    const ids = alerts.map((a) => a.id);
    assert.ok(!ids.includes('al-002'), 'haul-02 alert must not be visible to haul-01 admin');
  });

  it('hauler_admin does NOT see alerts from another hauler', async () => {
    const token   = await login('haul2@alerts.gh', HAUL2_PASS);
    const res     = await api('GET', '/api/alerts', null, token);
    const { alerts } = await res.json();
    const ids = alerts.map((a) => a.id);
    assert.ok(!ids.includes('al-001'), 'haul-01 alert must not appear for haul-02 admin');
    assert.ok(!ids.includes('al-004'), 'haul-01 alert must not appear for haul-02 admin');
  });

  it('lender can GET alerts (read-only)', async () => {
    const token = await login('lender@alerts.gh', LEND_PASS);
    const res   = await api('GET', '/api/alerts', null, token);
    assert.strictEqual(res.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — POST /:id/resolve', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });
  beforeEach(() => alertState.reset());

  it('unauthenticated request returns 401', async () => {
    const res = await api('POST', '/api/alerts/al-001/resolve', {});
    assert.strictEqual(res.status, 401);
  });

  it('returns 404 for an unknown alert id', async () => {
    const res = await api('POST', '/api/alerts/no-such-alert/resolve', {}, adminToken);
    assert.strictEqual(res.status, 404);
  });

  it('axis_admin resolves alert — response status is RESOLVED', async () => {
    const res  = await api('POST', '/api/alerts/al-001/resolve', {}, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'RESOLVED');
    assert.ok(body.resolved_at_iso);
  });

  it('axis_ops can also resolve', async () => {
    const token = await login('ops@alerts.gh', OPS_PASS);
    const res   = await api('POST', '/api/alerts/al-001/resolve', {}, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'RESOLVED');
  });

  it('lender cannot resolve — returns 403', async () => {
    const token = await login('lender@alerts.gh', LEND_PASS);
    const res   = await api('POST', '/api/alerts/al-001/resolve', {}, token);
    assert.strictEqual(res.status, 403);
  });

  it('hauler_admin can resolve own hauler alert', async () => {
    const token = await login('haul1@alerts.gh', HAUL1_PASS);
    const res   = await api('POST', '/api/alerts/al-001/resolve', {}, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'RESOLVED');
  });

  it('hauler_admin cannot resolve another hauler\'s alert — returns 403', async () => {
    const token = await login('haul2@alerts.gh', HAUL2_PASS);
    const res   = await api('POST', '/api/alerts/al-001/resolve', {}, token);
    assert.strictEqual(res.status, 403);
  });

  it('resolve with note attaches note to the alert', async () => {
    const res  = await api('POST', '/api/alerts/al-001/resolve', { note: 'Checked with dispatcher' }, adminToken);
    const body = await res.json();
    assert.strictEqual(body.status, 'RESOLVED');
    assert.ok(body.resolution_note === 'Checked with dispatcher' ||
              body.notes?.some((n) => n.body.includes('Checked with dispatcher')),
      'note should appear in resolution_note or notes thread');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — POST /:id/snooze', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });
  beforeEach(() => alertState.reset());

  it('returns 400 when until_iso is missing', async () => {
    const res = await api('POST', '/api/alerts/al-001/snooze', {}, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('returns 400 when until_iso is in the past', async () => {
    const res = await api('POST', '/api/alerts/al-001/snooze', { until_iso: PAST_ISO }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when until_iso is not a valid ISO string', async () => {
    const res = await api('POST', '/api/alerts/al-001/snooze', { until_iso: 'not-a-date' }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('valid snooze sets status to SNOOZED and records snooze_until_iso', async () => {
    const res  = await api('POST', '/api/alerts/al-001/snooze', { until_iso: FUTURE_ISO }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'SNOOZED');
    assert.ok(body.snooze_until_iso, 'snooze_until_iso should be present');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — POST /:id/reopen', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });
  beforeEach(() => alertState.reset());

  it('reopens a previously resolved alert', async () => {
    // Resolve first
    await api('POST', '/api/alerts/al-001/resolve', {}, adminToken);
    // Then reopen
    const res  = await api('POST', '/api/alerts/al-001/reopen', {}, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    // Reopen clears the override, so status falls back to fixture's NEEDS_ACTION
    assert.ok(body.status !== 'RESOLVED', 'status must not remain RESOLVED after reopen');
    assert.strictEqual(body.resolved_at_iso, null);
  });

  it('reopens a snoozed alert', async () => {
    await api('POST', '/api/alerts/al-001/snooze', { until_iso: FUTURE_ISO }, adminToken);
    const res  = await api('POST', '/api/alerts/al-001/reopen', {}, adminToken);
    const body = await res.json();
    assert.ok(body.status !== 'SNOOZED');
    assert.strictEqual(body.snooze_until_iso, null);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — POST /:id/assign', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });
  beforeEach(() => alertState.reset());

  it('returns 400 for an unknown user_id', async () => {
    const res = await api('POST', '/api/alerts/al-001/assign', { user_id: 'does-not-exist' }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('assigns alert to a known user', async () => {
    const res  = await api('POST', '/api/alerts/al-001/assign', { user_id: 'u-ops' }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.assignee?.user_id,      'u-ops');
    assert.strictEqual(body.assignee?.display_name, 'Test Ops');
  });

  it('null user_id unassigns the alert', async () => {
    // First assign
    await api('POST', '/api/alerts/al-001/assign', { user_id: 'u-ops' }, adminToken);
    // Then unassign
    const res  = await api('POST', '/api/alerts/al-001/assign', { user_id: null }, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).assignee, null);
  });

  it('after assign, ?assignee=me filter shows alert for the assignee', async () => {
    const opsToken = await login('ops@alerts.gh', OPS_PASS);
    await api('POST', '/api/alerts/al-001/assign', { user_id: 'u-ops' }, adminToken);
    const res    = await api('GET', '/api/alerts?assignee=me', null, opsToken);
    const { alerts } = await res.json();
    assert.ok(alerts.some((a) => a.id === 'al-001'), 'al-001 should appear in assignee=me filter');
  });

  it('summary.assigned_to_me reflects own assignments', async () => {
    const opsToken = await login('ops@alerts.gh', OPS_PASS);
    await api('POST', '/api/alerts/al-001/assign', { user_id: 'u-ops' }, adminToken);
    const res  = await api('GET', '/api/alerts', null, opsToken);
    const { summary } = await res.json();
    assert.ok(summary.assigned_to_me >= 1, 'assigned_to_me must be at least 1');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — POST /:id/note', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });
  beforeEach(() => alertState.reset());

  it('returns 400 when note body is empty', async () => {
    const res = await api('POST', '/api/alerts/al-001/note', { body: '' }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('returns 400 when body field is missing entirely', async () => {
    const res = await api('POST', '/api/alerts/al-001/note', {}, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('adds a note and returns alert + note', async () => {
    const res  = await api('POST', '/api/alerts/al-001/note', { body: 'Dispatching inspector' }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.note,          'note object should be in response');
    assert.ok(body.note.id,       'note should have an id');
    assert.strictEqual(body.note.body, 'Dispatching inspector');
    assert.ok(Array.isArray(body.alert.notes));
    assert.ok(body.alert.notes.length > 0, 'notes array should be non-empty');
  });

  it('lender cannot add a note — returns 403', async () => {
    const token = await login('lender@alerts.gh', LEND_PASS);
    const res   = await api('POST', '/api/alerts/al-001/note', { body: 'Lender note' }, token);
    assert.strictEqual(res.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alerts — POST /bulk', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@alerts.gh', ADMIN_PASS); });
  beforeEach(() => alertState.reset());

  it('returns 400 when action is missing', async () => {
    const res = await api('POST', '/api/alerts/bulk', { ids: ['al-001'] }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when ids array is empty', async () => {
    const res = await api('POST', '/api/alerts/bulk', { action: 'resolve', ids: [] }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for an unknown action', async () => {
    const res = await api('POST', '/api/alerts/bulk', { action: 'delete_all', ids: ['al-001'] }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when snooze action is missing until_iso', async () => {
    const res = await api('POST', '/api/alerts/bulk', { action: 'snooze', ids: ['al-001'] }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('bulk resolve succeeds for all valid ids', async () => {
    const res  = await api('POST', '/api/alerts/bulk', {
      action: 'resolve',
      ids:    ['al-001', 'al-002'],
    }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.succeeded, 2);
    assert.strictEqual(body.failed,    0);
    assert.ok(body.results.every((r) => r.ok));
  });

  it('bulk resolve returns partial failure for unknown ids', async () => {
    const res  = await api('POST', '/api/alerts/bulk', {
      action: 'resolve',
      ids:    ['al-001', 'no-such-alert'],
    }, adminToken);
    const body = await res.json();
    assert.strictEqual(body.succeeded, 1);
    assert.strictEqual(body.failed,    1);
    const failed = body.results.find((r) => !r.ok);
    assert.strictEqual(failed.reason, 'not found');
  });

  it('hauler_admin bulk gets "forbidden" for other hauler alerts', async () => {
    const token = await login('haul2@alerts.gh', HAUL2_PASS);
    const res   = await api('POST', '/api/alerts/bulk', {
      action: 'resolve',
      ids:    ['al-001'],  // haul-01 alert — haul-02 admin cannot triage
    }, token);
    const body = await res.json();
    assert.strictEqual(body.results[0].ok,     false);
    assert.strictEqual(body.results[0].reason, 'forbidden');
  });

  it('bulk snooze sets all alerts to SNOOZED', async () => {
    const res  = await api('POST', '/api/alerts/bulk', {
      action:    'snooze',
      ids:       ['al-001', 'al-004'],
      until_iso: FUTURE_ISO,
    }, adminToken);
    const body = await res.json();
    assert.strictEqual(body.succeeded, 2);
    assert.ok(body.results.every((r) => r.ok));
    assert.ok(body.results.every((r) => r.alert?.status === 'SNOOZED'));
  });

  it('unauthenticated bulk returns 401', async () => {
    const res = await api('POST', '/api/alerts/bulk', { action: 'resolve', ids: ['al-001'] });
    assert.strictEqual(res.status, 401);
  });
});
