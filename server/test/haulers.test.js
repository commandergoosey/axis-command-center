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

// Insert test users (cost=1 to keep tests fast).
const NOW = new Date().toISOString();
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
const PASS = 'test-pass-x7';
insertUser.run('u-adm', 'admin@h.test', bcrypt.hashSync(PASS, 1), 'Axis Admin', 'axis_admin',   null,      'AXIS',    NOW, NOW);
insertUser.run('u-ops', 'ops@h.test',   bcrypt.hashSync(PASS, 1), 'Axis Ops',   'axis_ops',     null,      'AXIS',    NOW, NOW);
insertUser.run('u-h01', 'h01@h.test',   bcrypt.hashSync(PASS, 1), 'Haul-01',    'hauler_admin', 'haul-01', 'H01 Co',  NOW, NOW);
insertUser.run('u-h02', 'h02@h.test',   bcrypt.hashSync(PASS, 1), 'Haul-02',    'hauler_admin', 'haul-02', 'H02 Co',  NOW, NOW);
insertUser.run('u-len', 'len@h.test',   bcrypt.hashSync(PASS, 1), 'Lender',     'lender',       null,      'Finance', NOW, NOW);

// ── Stubs (must precede requiring routes) ─────────────────────────────

// registry.probe() calls real async adapters — stub to a fast success.
const registryKey = require.resolve('../adapters/registry');
require.cache[registryKey] = {
  id: registryKey, filename: registryKey, loaded: true,
  exports: {
    probe: async () => ({ ok: true, probed_at: new Date().toISOString(), latency_ms: 120 }),
    syncFleet: async () => ({}),
    adapterFor: () => null,
    ADAPTERS: {},
  },
};

// Stub audit to avoid any DB coupling in lifecycle/compare audit queries.
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: {
    writeAudit: () => {},
    listAudit:  () => ({ rows: [], total: 0 }),
  },
};

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',    require('../routes/auth'));
app.use('/api/haulers', require('../routes/haulers'));

// ── Lifecycle ─────────────────────────────────────────────────────────
let base;
let adminTok, opsTok, h01Tok, h02Tok, lenderTok;
const server = http.createServer(app);

// ── Helpers ───────────────────────────────────────────────────────────
async function login(b, email) {
  const res = await fetch(`${b}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await res.json();
  return j.token;
}

async function api(method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Single before() so server start + login happen sequentially.
before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  adminTok  = await login(base, 'admin@h.test');
  opsTok    = await login(base, 'ops@h.test');
  h01Tok    = await login(base, 'h01@h.test');
  h02Tok    = await login(base, 'h02@h.test');
  lenderTok = await login(base, 'len@h.test');
});

after(() => new Promise((resolve) => server.close(resolve)));

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/haulers', () => {
  it('returns 200 with required top-level fields', async () => {
    const r = await api('GET', '/api/haulers', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.haulers),                     'haulers is an array');
    assert.ok(typeof r.body.totals === 'object',                 'totals is an object');
    assert.ok(Array.isArray(r.body.trip_cadence),                'trip_cadence is an array');
    assert.ok(typeof r.body.turnaround_by_hauler === 'object',   'turnaround_by_hauler is an object');
  });

  it('each hauler entry has integration_state, fleet_uptime, share_pct', async () => {
    const r = await api('GET', '/api/haulers', null, adminTok);
    assert.ok(r.body.haulers.length > 0, 'at least one hauler returned');
    const h = r.body.haulers[0];
    assert.ok(typeof h.integration_state === 'object', 'integration_state present');
    assert.ok(typeof h.fleet_uptime === 'object',      'fleet_uptime present');
    assert.ok('share_pct' in h,                        'share_pct present');
  });

  it('totals has contracted_trucks, active_trucks, live_haulers', async () => {
    const r = await api('GET', '/api/haulers', null, adminTok);
    const t = r.body.totals;
    assert.ok('contracted_trucks' in t, 'contracted_trucks');
    assert.ok('active_trucks'     in t, 'active_trucks');
    assert.ok('live_haulers'      in t, 'live_haulers');
  });

  it('trip_cadence entries have hauler_id and avg_trips_per_week', async () => {
    const r = await api('GET', '/api/haulers', null, adminTok);
    for (const tc of r.body.trip_cadence) {
      assert.ok('hauler_id'          in tc, 'hauler_id in trip_cadence entry');
      assert.ok('avg_trips_per_week' in tc, 'avg_trips_per_week in trip_cadence entry');
    }
  });

  it('accessible without role check (any authenticated user)', async () => {
    const r = await api('GET', '/api/haulers', null, lenderTok);
    assert.equal(r.status, 200);
  });
});

describe('GET /api/haulers/compare', () => {
  it('returns 400 when fewer than 2 ids are passed', async () => {
    const r = await api('GET', '/api/haulers/compare?ids=haul-01', null, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it('returns 400 when more than 4 ids are passed', async () => {
    const r = await api('GET', '/api/haulers/compare?ids=haul-01,haul-02,haul-03,haul-04,haul-05', null, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it('returns 200 with generated_at, horizon, haulers for valid request', async () => {
    const r = await api('GET', '/api/haulers/compare?ids=haul-01,haul-02', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.generated_at, 'generated_at present');
    assert.ok(r.body.horizon,      'horizon present');
    assert.ok(Array.isArray(r.body.haulers), 'haulers is array');
    assert.equal(r.body.haulers.length, 2);
  });

  it('each compared hauler has display_name, contracted_trucks, lifecycle', async () => {
    const r = await api('GET', '/api/haulers/compare?ids=haul-01,haul-02', null, adminTok);
    const h = r.body.haulers.find((x) => x.id === 'haul-01');
    assert.ok(h,                                          'haul-01 in response');
    assert.ok(h.display_name,                             'display_name present');
    assert.ok(typeof h.contracted_trucks === 'number',    'contracted_trucks');
    assert.ok(typeof h.lifecycle === 'object',            'lifecycle present');
  });

  it('hauler_admin gets 403 if comparing a hauler other than their own', async () => {
    const r = await api('GET', '/api/haulers/compare?ids=haul-01,haul-02', null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('unknown hauler id appears with missing:true', async () => {
    const r = await api('GET', '/api/haulers/compare?ids=haul-01,haul-ghost', null, adminTok);
    assert.equal(r.status, 200);
    const ghost = r.body.haulers.find((x) => x.id === 'haul-ghost');
    assert.ok(ghost?.missing === true, 'unknown hauler has missing:true');
  });
});

describe('GET /api/haulers/:id', () => {
  it('returns 200 with all required detail fields', async () => {
    const r = await api('GET', '/api/haulers/haul-01', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.fleet_breakdown === 'object', 'fleet_breakdown');
    assert.ok(typeof r.body.driver_roster   === 'object', 'driver_roster');
    assert.ok(typeof r.body.mtd             === 'object', 'mtd');
    assert.ok(Array.isArray(r.body.sla_series),           'sla_series');
    assert.ok(typeof r.body.settlement      === 'object', 'settlement');
    assert.ok(typeof r.body.lifecycle       === 'object', 'lifecycle');
  });

  it('returns 404 for unknown hauler', async () => {
    const r = await api('GET', '/api/haulers/haul-ghost', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin can view their own hauler', async () => {
    const r = await api('GET', '/api/haulers/haul-01', null, h01Tok);
    assert.equal(r.status, 200);
  });

  it('hauler_admin is blocked from viewing another hauler', async () => {
    const r = await api('GET', '/api/haulers/haul-02', null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('lender gets restricted audit in lifecycle', async () => {
    const r = await api('GET', '/api/haulers/haul-01', null, lenderTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.lifecycle.audit.restricted === true, 'audit.restricted is true for lender');
  });

  it('sla_series has 12 entries with week_offset and value', async () => {
    const r = await api('GET', '/api/haulers/haul-01', null, adminTok);
    assert.equal(r.body.sla_series.length, 12);
    assert.ok('week_offset' in r.body.sla_series[0], 'week_offset in sla_series entry');
    assert.ok('value'       in r.body.sla_series[0], 'value in sla_series entry');
  });

  it('checklist is null for active haulers', async () => {
    const r = await api('GET', '/api/haulers/haul-01', null, adminTok);
    assert.equal(r.body.checklist, null, 'checklist is null for active hauler');
  });
});

describe('GET /api/haulers/:id/scorecard', () => {
  it('returns 200 with expected shape', async () => {
    const r = await api('GET', '/api/haulers/haul-01/scorecard', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.hauler,                         'hauler field present');
    assert.ok(r.body.period,                         'period field present');
    assert.ok(r.body.week,                           'week field present');
    assert.ok(r.body.lifecycle,                      'lifecycle field present');
    assert.ok(Array.isArray(r.body.week.daily),      'week.daily is array');
    assert.equal(r.body.week.daily.length, 7,        'week.daily has 7 days');
  });

  it('returns 404 for unknown hauler', async () => {
    const r = await api('GET', '/api/haulers/haul-ghost/scorecard', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin gets 403 for another hauler scorecard', async () => {
    const r = await api('GET', '/api/haulers/haul-02/scorecard', null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('week_offset query param shifts the period', async () => {
    const r0 = await api('GET', '/api/haulers/haul-01/scorecard', null, adminTok);
    const r1 = await api('GET', '/api/haulers/haul-01/scorecard?week_offset=-1', null, adminTok);
    assert.notEqual(r0.body.period.since, r1.body.period.since, 'week_offset shifts the period');
    assert.equal(r1.body.period.week_offset, -1, 'week_offset reflected in response');
  });

  it('lender gets restricted audit in scorecard', async () => {
    const r = await api('GET', '/api/haulers/haul-01/scorecard', null, lenderTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.audit.restricted === true, 'audit.restricted for lender');
  });
});

describe('POST /api/haulers (onboard)', () => {
  const VALID_BODY = {
    display_name:      'Test Hauler Ltd',
    contracted_trucks: 10,
    integration_type:  'manual',
  };

  it('returns 403 for lender', async () => {
    const r = await api('POST', '/api/haulers', VALID_BODY, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for hauler_admin', async () => {
    const r = await api('POST', '/api/haulers', VALID_BODY, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 400 when display_name missing', async () => {
    const r = await api('POST', '/api/haulers', { contracted_trucks: 10, integration_type: 'manual' }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('display_name'), 'error mentions display_name');
  });

  it('returns 400 when contracted_trucks is not a positive integer', async () => {
    const r = await api('POST', '/api/haulers', { ...VALID_BODY, contracted_trucks: -1 }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 400 for invalid integration_type', async () => {
    const r = await api('POST', '/api/haulers', { ...VALID_BODY, integration_type: 'fax' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 400 for invalid contact_email', async () => {
    const r = await api('POST', '/api/haulers', { ...VALID_BODY, contact_email: 'not-an-email' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 400 for invalid planned_start_date format', async () => {
    const r = await api('POST', '/api/haulers', { ...VALID_BODY, planned_start_date: '01/07/2026' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 201 and creates pending hauler for axis_admin', async () => {
    const r = await api('POST', '/api/haulers', VALID_BODY, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.id,              'id returned');
    assert.equal(r.body.status, 'pending', 'status is pending');
  });

  it('returns 201 for axis_ops', async () => {
    const r = await api('POST', '/api/haulers', { ...VALID_BODY, display_name: 'Ops Hauler' }, opsTok);
    assert.equal(r.status, 201);
  });
});

describe('PATCH /api/haulers/:id', () => {
  it('returns 403 for lender', async () => {
    const r = await api('PATCH', '/api/haulers/haul-01', { display_name: 'X' }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for hauler_admin', async () => {
    const r = await api('PATCH', '/api/haulers/haul-01', { display_name: 'X' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 404 for unknown hauler', async () => {
    const r = await api('PATCH', '/api/haulers/haul-ghost', { display_name: 'X' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('returns 400 for invalid integration_type', async () => {
    const r = await api('PATCH', '/api/haulers/haul-01', { integration_type: 'fax' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 200 and updates display_name', async () => {
    const r = await api('PATCH', '/api/haulers/haul-03', { display_name: 'Updated Co' }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.hauler, 'hauler returned in body');
  });
});

describe('Onboard → checklist → activate flow', () => {
  let pendingId;

  before(async () => {
    const r = await api('POST', '/api/haulers', {
      display_name: 'Pending Flow Co', contracted_trucks: 5, integration_type: 'manual',
    }, adminTok);
    assert.equal(r.status, 201);
    pendingId = r.body.id;
  });

  it('GET /:id returns array checklist for pending hauler', async () => {
    const r = await api('GET', `/api/haulers/${pendingId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.checklist), 'checklist is array for pending hauler');
    assert.ok(r.body.checklist.length > 0,     'checklist has steps');
  });

  it('PATCH /:id/checklist/:step returns 400 for active hauler', async () => {
    const r = await api('PATCH', '/api/haulers/haul-01/checklist/integration_configured', { done: true }, adminTok);
    assert.equal(r.status, 400, 'active hauler checklist is read-only');
  });

  it('PATCH /:id/checklist/:step checks a step', async () => {
    const r = await api('PATCH', `/api/haulers/${pendingId}/checklist/integration_configured`, { done: true }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.checklist), 'checklist returned');
    const step = r.body.checklist.find((s) => s.step === 'integration_configured');
    assert.ok(step?.done === true, 'step is marked done');
  });

  it('POST /:id/activate fails when checklist is incomplete', async () => {
    const r = await api('POST', `/api/haulers/${pendingId}/activate`, null, adminTok);
    assert.equal(r.status, 400);
    assert.ok(Array.isArray(r.body.missing_steps), 'missing_steps returned');
  });

  it('POST /:id/activate succeeds after all steps are checked', async () => {
    for (const step of ['driver_roster', 'fleet_manifest', 'contract_signed']) {
      await api('PATCH', `/api/haulers/${pendingId}/checklist/${step}`, { done: true }, adminTok);
    }
    const r = await api('POST', `/api/haulers/${pendingId}/activate`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'active', 'status is active after activation');
    assert.ok(r.body.activated_at, 'activated_at is set');
  });

  it('POST /:id/activate returns 400 when hauler is already active', async () => {
    const r = await api('POST', `/api/haulers/${pendingId}/activate`, null, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('already active'), 'error mentions already active');
  });

  it('POST /:id/activate returns 403 for axis_ops', async () => {
    const r = await api('POST', '/api/haulers/haul-01/activate', null, opsTok);
    assert.equal(r.status, 403);
  });
});

describe('Hauler contacts', () => {
  it('GET /:id/contacts returns 404 for unknown hauler', async () => {
    const r = await api('GET', '/api/haulers/haul-ghost/contacts', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('GET /:id/contacts returns empty contacts array initially', async () => {
    const r = await api('GET', '/api/haulers/haul-04/contacts', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.hauler_id, 'haul-04');
    assert.ok(Array.isArray(r.body.contacts));
  });

  it('hauler_admin cannot view another hauler contacts', async () => {
    const r = await api('GET', '/api/haulers/haul-02/contacts', null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('POST /:id/contacts creates a contact', async () => {
    const r = await api('POST', '/api/haulers/haul-02/contacts', {
      channel: 'phone', direction: 'outbound',
      counterparty_name: 'Kojo Mensah', counterparty_role: 'Fleet Manager',
      summary: 'Discussed delays on Tuesday run', outcome: 'committed',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.contact?.id, 'contact id returned');
    assert.equal(r.body.contact.channel, 'phone');
    assert.equal(r.body.contact.outcome, 'committed');
  });

  it('POST /:id/contacts returns 400 for invalid channel', async () => {
    const r = await api('POST', '/api/haulers/haul-02/contacts', {
      channel: 'fax', summary: 'test', outcome: 'committed',
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('POST /:id/contacts/:contactId/resolve resolves the follow-up', async () => {
    const create = await api('POST', '/api/haulers/haul-02/contacts', {
      channel: 'email', direction: 'outbound',
      counterparty_name: 'Ama Boateng', summary: 'Chasing missing manifest',
      outcome: 'partial', follow_up_at: new Date(Date.now() + 86_400_000).toISOString(),
    }, adminTok);
    const contactId = create.body.contact.id;
    const r = await api('POST', `/api/haulers/haul-02/contacts/${contactId}/resolve`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.resolved === true);
  });

  it('DELETE /:id/contacts/:contactId requires axis_admin', async () => {
    const create = await api('POST', '/api/haulers/haul-02/contacts', {
      channel: 'phone', summary: 'to delete', outcome: 'no_response',
    }, adminTok);
    const contactId = create.body.contact.id;

    const rOps = await api('DELETE', `/api/haulers/haul-02/contacts/${contactId}`, null, opsTok);
    assert.equal(rOps.status, 403, 'axis_ops cannot delete');

    const rAdm = await api('DELETE', `/api/haulers/haul-02/contacts/${contactId}`, null, adminTok);
    assert.equal(rAdm.status, 200);
    assert.ok(rAdm.body.deleted === true);
  });
});

describe('Integration endpoints', () => {
  it('GET /:id/integration returns hauler_id, integration, and state', async () => {
    const r = await api('GET', '/api/haulers/haul-01/integration', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.hauler_id, 'haul-01');
    assert.ok(typeof r.body.integration === 'object', 'integration present');
    assert.ok(typeof r.body.state       === 'object', 'state present');
  });

  it('POST /:id/integration/probe returns probe result and state', async () => {
    const r = await api('POST', '/api/haulers/haul-01/integration/probe', { token: 'test-tok' }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.probe,          'probe in response');
    assert.ok(r.body.probe.ok,       'probe.ok is true');
    assert.ok(typeof r.body.state === 'object', 'state in response');
  });

  it('POST /:id/integration/probe is 403 for hauler_admin of another hauler', async () => {
    const r = await api('POST', '/api/haulers/haul-02/integration/probe', { token: 'x' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('POST /:id/integration/csv returns 400 for non-manual hauler', async () => {
    // haul-01 uses loconav — CSV upload not valid
    const r = await api('POST', '/api/haulers/haul-01/integration/csv', {
      csv_text: 'date,vehicle_id,tonnes\n2026-05-01,TRK-01,40\n',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('manual'), 'error mentions manual');
  });

  it('DELETE /:id/integration/token clears credentials', async () => {
    await api('POST', '/api/haulers/haul-01/integration/probe', { token: 'tok' }, adminTok);
    const r = await api('DELETE', '/api/haulers/haul-01/integration/token', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.cleared === true);
  });

  it('GET /:id/integration-health returns api_status and health', async () => {
    const r = await api('GET', '/api/haulers/haul-01/integration-health', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.hauler_id,  'hauler_id present');
    assert.ok(r.body.api_status, 'api_status present');
    assert.ok(typeof r.body.health === 'object', 'health is object');
  });

  it('GET /:id/integration-health returns 403 for hauler_admin of wrong hauler', async () => {
    const r = await api('GET', '/api/haulers/haul-02/integration-health', null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('POST /:id/integration-retry returns success, latency, and health', async () => {
    const r = await api('POST', '/api/haulers/haul-01/integration-retry', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('success' in r.body,               'success field present');
    assert.ok(typeof r.body.health === 'object', 'health present');
  });

  it('POST /:id/integration-retry is 403 for hauler_admin of wrong hauler', async () => {
    const r = await api('POST', '/api/haulers/haul-02/integration-retry', null, h01Tok);
    assert.equal(r.status, 403);
  });
});
