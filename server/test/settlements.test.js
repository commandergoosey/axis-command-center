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
const PASS = 'test-stl-x7';
insertUser.run('u-adm', 'admin@stl.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@stl.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@stl.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-h02', 'h02@stl.test',   bcrypt.hashSync(PASS, 1), 'H02',   'hauler_admin', 'haul-02', 'H02',  NOW, NOW);
insertUser.run('u-len', 'len@stl.test',   bcrypt.hashSync(PASS, 1), 'Len',   'lender',       null,      'Fin',  NOW, NOW);

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
app.use('/api/settlements', require('../routes/settlements'));

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
  adminTok  = await login('admin@stl.test');
  opsTok    = await login('ops@stl.test');
  h01Tok    = await login('h01@stl.test');
  h02Tok    = await login('h02@stl.test');
  lenderTok = await login('len@stl.test');
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

// Known IDs from mock/settlements
const H01_PENDING  = 'stmt-haul-01-2026-05'; // haul-01, pending
const H02_PENDING  = 'stmt-haul-02-2026-04'; // haul-02, pending
const H01_PAID     = 'stmt-haul-01-2025-12'; // haul-01, already paid

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/settlements', () => {
  it('returns 401 without auth', async () => {
    const r = await api('GET', '/api/settlements');
    assert.equal(r.status, 401);
  });

  it('returns 200 with statements, counts, and companion fields', async () => {
    const r = await api('GET', '/api/settlements', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.statements),           'statements array');
    assert.ok(typeof r.body.counts === 'object',          'counts object');
    assert.ok(Array.isArray(r.body.periods),              'periods array');
    assert.ok(Array.isArray(r.body.hauler_aging),         'hauler_aging array');
    assert.ok(Array.isArray(r.body.payment_velocity),     'payment_velocity array');
    assert.ok(Array.isArray(r.body.reconciliation),       'reconciliation array');
    assert.ok(Array.isArray(r.body.hauler_breakdown),     'hauler_breakdown array');
    assert.ok(Array.isArray(r.body.payment_days),         'payment_days array');
    assert.ok(Array.isArray(r.body.aging_trend),          'aging_trend array');
    assert.ok(r.body.generated_at,                        'generated_at present');
  });

  it('counts has expected fields', async () => {
    const r = await api('GET', '/api/settlements', null, adminTok);
    const c = r.body.counts;
    assert.ok('total'           in c, 'total');
    assert.ok('pending'         in c, 'pending');
    assert.ok('paid'            in c, 'paid');
    assert.ok('disputed'        in c, 'disputed');
    assert.ok('outstanding_usd' in c, 'outstanding_usd');
    assert.ok(c.total >= 30,           'at least 30 mock statements');
  });

  it('aging_trend has 8 weekly entries', async () => {
    const r = await api('GET', '/api/settlements', null, adminTok);
    assert.equal(r.body.aging_trend.length, 8, '8 weeks');
    const entry = r.body.aging_trend[0];
    assert.ok('week_of'      in entry, 'week_of');
    assert.ok('current_usd'  in entry, 'current_usd');
    assert.ok('d30_usd'      in entry, 'd30_usd');
    assert.ok('d90plus_usd'  in entry, 'd90plus_usd');
  });

  it('hauler_admin only sees their own hauler statements', async () => {
    const r = await api('GET', '/api/settlements', null, h01Tok);
    assert.equal(r.status, 200);
    for (const s of r.body.statements) {
      assert.equal(s.hauler_id, 'haul-01', `statement ${s.id} must be haul-01`);
    }
  });

  it('hauler_id query filter works for axis_admin', async () => {
    const r = await api('GET', '/api/settlements?hauler_id=haul-02', null, adminTok);
    assert.equal(r.status, 200);
    for (const s of r.body.statements) {
      assert.equal(s.hauler_id, 'haul-02', `statement ${s.id} must be haul-02`);
    }
  });

  it('period query filter works', async () => {
    const r = await api('GET', '/api/settlements?period=2025-12', null, adminTok);
    assert.equal(r.status, 200);
    for (const s of r.body.statements) {
      assert.equal(s.period, '2025-12', 'all statements in 2025-12');
    }
  });

  it('lender can list settlements', async () => {
    const r = await api('GET', '/api/settlements', null, lenderTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.statements.length >= 30, 'lender sees all statements');
  });
});

describe('GET /api/settlements/ageing', () => {
  it('returns 401 without auth', async () => {
    const r = await api('GET', '/api/settlements/ageing');
    assert.equal(r.status, 401);
  });

  it('returns bands, details, and total_outstanding_usd', async () => {
    const r = await api('GET', '/api/settlements/ageing', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.bands === 'object',                  'bands object');
    assert.ok(typeof r.body.details === 'object',                'details object');
    assert.ok('total_outstanding_usd' in r.body,                 'total_outstanding_usd');
    assert.ok('current'  in r.body.bands, 'bands.current');
    assert.ok('days30'   in r.body.bands, 'bands.days30');
    assert.ok('days60'   in r.body.bands, 'bands.days60');
    assert.ok('days90plus' in r.body.bands, 'bands.days90plus');
  });

  it('hauler_admin ageing scoped to their hauler', async () => {
    const r = await api('GET', '/api/settlements/ageing', null, h01Tok);
    assert.equal(r.status, 200);
    const allDetails = Object.values(r.body.details).flat();
    for (const d of allDetails) {
      assert.equal(d.hauler_id, 'haul-01', `detail ${d.id} must be haul-01`);
    }
  });
});

describe('GET /api/settlements/:id', () => {
  it('returns 404 for unknown id', async () => {
    const r = await api('GET', '/api/settlements/stmt-bogus', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('returns statement for axis_admin', async () => {
    const r = await api('GET', `/api/settlements/${H01_PENDING}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.statement,                    'statement returned');
    assert.equal(r.body.statement.id, H01_PENDING, 'id matches');
  });

  it('hauler_admin can view their own statement', async () => {
    const r = await api('GET', `/api/settlements/${H01_PENDING}`, null, h01Tok);
    assert.equal(r.status, 200);
  });

  it('hauler_admin gets 403 for another hauler statement', async () => {
    const r = await api('GET', `/api/settlements/${H02_PENDING}`, null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('lender can view any statement', async () => {
    const r = await api('GET', `/api/settlements/${H02_PENDING}`, null, lenderTok);
    assert.equal(r.status, 200);
  });
});

describe('POST /api/settlements/:id/mark-paid', () => {
  it('returns 403 for hauler_admin', async () => {
    const r = await api('POST', `/api/settlements/${H01_PENDING}/mark-paid`, {}, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for lender', async () => {
    const r = await api('POST', `/api/settlements/${H01_PENDING}/mark-paid`, {}, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 404 for unknown settlement', async () => {
    const r = await api('POST', '/api/settlements/stmt-bogus/mark-paid', {}, adminTok);
    assert.equal(r.status, 404);
  });

  it('marks a pending statement as paid', async () => {
    const r = await api('POST', `/api/settlements/${H01_PENDING}/mark-paid`, {
      payment_ref: 'SWIFT-20260520-001',
      paid_amount_usd: 185000,
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.statement.status, 'paid', 'status is paid');
    assert.equal(r.body.statement.payment_ref, 'SWIFT-20260520-001', 'payment_ref stored');
  });

  it('axis_ops can mark paid', async () => {
    const r = await api('POST', `/api/settlements/${H02_PENDING}/mark-paid`, {}, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.statement.status, 'paid');
  });
});

describe('POST /api/settlements/:id/dispute', () => {
  // Use a fresh pending statement that hasn't been mutated yet
  const DISPUTE_TARGET = 'stmt-haul-02-2026-05';

  it('returns 403 for lender', async () => {
    const r = await api('POST', `/api/settlements/${DISPUTE_TARGET}/dispute`,
      { dispute_reason: 'Test' }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 400 when dispute_reason is missing', async () => {
    const r = await api('POST', `/api/settlements/${DISPUTE_TARGET}/dispute`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('dispute_reason'), 'error mentions dispute_reason');
  });

  it('returns 404 for unknown settlement', async () => {
    const r = await api('POST', '/api/settlements/stmt-bogus/dispute',
      { dispute_reason: 'Test' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('hauler_admin gets 403 for another hauler statement', async () => {
    // DISPUTE_TARGET belongs to haul-02; h01Tok is haul-01
    const r = await api('POST', `/api/settlements/${DISPUTE_TARGET}/dispute`,
      { dispute_reason: 'Wrong rates applied' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('hauler_admin can dispute their own statement', async () => {
    const r = await api('POST', `/api/settlements/${DISPUTE_TARGET}/dispute`,
      { dispute_reason: 'Fuel surcharge calculation incorrect' }, h02Tok);
    assert.equal(r.status, 200);
    assert.equal(r.body.statement.status, 'disputed', 'status is disputed');
  });

  it('axis_admin can dispute any statement', async () => {
    // Use a different pending statement
    const target = 'stmt-haul-03-2026-05';
    const r = await api('POST', `/api/settlements/${target}/dispute`,
      { dispute_reason: 'Tonne count does not match weighbridge tickets' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.statement.status, 'disputed');
  });
});

describe('POST /api/settlements/:id/resolve-dispute', () => {
  const RESOLVE_TARGET = 'stmt-haul-02-2026-05';

  it('returns 403 for hauler_admin', async () => {
    const r = await api('POST', `/api/settlements/${RESOLVE_TARGET}/resolve-dispute`,
      { resolution_status: 'pending' }, h02Tok);
    assert.equal(r.status, 403);
  });

  it('resolves a disputed statement back to pending', async () => {
    const r = await api('POST', `/api/settlements/${RESOLVE_TARGET}/resolve-dispute`,
      { resolution_status: 'pending' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.statement.status, 'pending', 'status reverted to pending');
  });

  it('returns 404 for unknown settlement', async () => {
    const r = await api('POST', '/api/settlements/stmt-bogus/resolve-dispute',
      { resolution_status: 'pending' }, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('PATCH /api/settlements/:id/notes', () => {
  it('returns 403 for lender', async () => {
    const r = await api('PATCH', `/api/settlements/${H01_PENDING}/notes`,
      { notes: 'Test' }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 404 for unknown settlement', async () => {
    const r = await api('PATCH', '/api/settlements/stmt-bogus/notes',
      { notes: 'Test' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('sets notes on a statement', async () => {
    const r = await api('PATCH', `/api/settlements/${H01_PENDING}/notes`, {
      notes: 'Confirmed with Kwame — payment cleared on 2026-05-19',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.statement.notes,
      'Confirmed with Kwame — payment cleared on 2026-05-19', 'notes stored');
  });

  it('hauler_admin can set notes on their own statement', async () => {
    const target = 'stmt-haul-01-2026-04';
    const r = await api('PATCH', `/api/settlements/${target}/notes`,
      { notes: 'Rate query raised with ops' }, h01Tok);
    assert.equal(r.status, 200);
  });

  it('hauler_admin gets 403 for another hauler statement', async () => {
    const r = await api('PATCH', `/api/settlements/${H02_PENDING}/notes`,
      { notes: 'Trying to set notes on haul-02 as haul-01' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('clears notes when body is null', async () => {
    const r = await api('PATCH', `/api/settlements/${H01_PENDING}/notes`,
      { notes: null }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(!r.body.statement.notes, 'notes cleared');
  });
});

describe('POST /api/settlements/generate-fortnightly', () => {
  it('returns 403 for hauler_admin', async () => {
    const r = await api('POST', '/api/settlements/generate-fortnightly', {}, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for lender', async () => {
    const r = await api('POST', '/api/settlements/generate-fortnightly', {}, lenderTok);
    assert.equal(r.status, 403);
  });

  it('generates fortnightly invoices for axis_admin', async () => {
    const r = await api('POST', '/api/settlements/generate-fortnightly', {}, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.period,                       'period returned');
    assert.ok(r.body.label,                        'label returned');
    assert.ok(typeof r.body.effective_rate === 'number', 'effective_rate is number');
    assert.ok(typeof r.body.created === 'number',  'created count returned');
    assert.ok(typeof r.body.skipped === 'number',  'skipped count returned');
    assert.ok(Array.isArray(r.body.statements),    'statements array returned');
    assert.ok(r.body.created + r.body.skipped >= 5, 'at least 5 active haulers processed');
  });

  it('is idempotent (second call for same period returns created=0)', async () => {
    const r = await api('POST', '/api/settlements/generate-fortnightly', {}, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.created, 0, 'no new statements on second call for same period');
  });

  it('generated statements appear in GET /api/settlements list', async () => {
    const gen = await api('GET', '/api/settlements', null, adminTok);
    const generatedStmts = gen.body.statements.filter((s) => s.id?.startsWith('stl-gen-'));
    assert.ok(generatedStmts.length >= 5, 'generated statements in list');
  });
});
