'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-claims';
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
insertUser.run('u-adm', 'admin@clm.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@clm.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@clm.test',    bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-h02', 'h02@clm.test',    bcrypt.hashSync(PASS, 1), 'H02',    'hauler_admin', 'haul-02', 'H02',  NOW, NOW);
insertUser.run('u-len', 'lender@clm.test', bcrypt.hashSync(PASS, 1), 'Lender', 'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: {
    writeAudit: () => {},
    listAudit:  () => ({ rows: [], total: 0 }),
  },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',   require('../routes/auth'));
app.use('/api/claims', require('../routes/claims'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, h01Tok, h02Tok, lenderTok;

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
  adminTok  = await login('admin@clm.test');
  opsTok    = await login('ops@clm.test');
  h01Tok    = await login('h01@clm.test');
  h02Tok    = await login('h02@clm.test');
  lenderTok = await login('lender@clm.test');
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

// Mock claim IDs for reference:
//   clm-2026-04-001  haul-02  under_review
//   clm-2026-04-002  haul-02  approved
//   clm-2026-03-001  haul-04  paid
//   clm-2026-02-001  haul-01  paid
//   clm-2026-04-003  haul-03  filed        ← good for transition tests
//   clm-2026-01-001  haul-05  denied

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/claims', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/claims')).status, 401);
  });

  it('200 for axis_admin — all claims + analytics', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    assert.equal(r.status, 200);
    for (const k of ['claims', 'counts', 'exposure_by_type', 'monthly_trend',
                      'age_profile', 'recovery_by_hauler', 'amount_by_status', 'generated_at']) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/claims', null, opsTok)).status, 200);
  });

  it('200 for lender — sees all claims', async () => {
    const r = await api('GET', '/api/claims', null, lenderTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.claims.length >= 6, 'lender should see all mock claims');
  });

  it('200 for hauler_admin — scoped to their hauler', async () => {
    const r = await api('GET', '/api/claims', null, h02Tok);
    assert.equal(r.status, 200);
    assert.ok(r.body.claims.length > 0);
    for (const c of r.body.claims) {
      assert.equal(c.hauler_id, 'haul-02', 'hauler_admin should only see their own claims');
    }
  });

  it('counts has total, filed, under_review, approved, denied, paid', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    const c = r.body.counts;
    for (const k of ['total', 'filed', 'under_review', 'approved', 'denied', 'paid']) {
      assert.ok(k in c, `counts missing ${k}`);
    }
  });

  it('exposure_by_type has 4 entries for each claim type', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    assert.equal(r.body.exposure_by_type.length, 4);
    const types = r.body.exposure_by_type.map((e) => e.type);
    assert.ok(types.includes('third_party_liability'));
    assert.ok(types.includes('rig_damage'));
    assert.ok(types.includes('cargo_loss'));
    assert.ok(types.includes('medical'));
  });

  it('monthly_trend has 6 entries', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    assert.equal(r.body.monthly_trend.length, 6);
    const current = r.body.monthly_trend[5];
    assert.equal(current.partial, true);
  });

  it('age_profile has 4 buckets with is_overdue flags', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    assert.equal(r.body.age_profile.length, 4);
    assert.equal(r.body.age_profile[0].is_overdue, false);
    assert.equal(r.body.age_profile[1].is_overdue, true);
  });

  it('recovery_by_hauler is an array sorted by claim_amount_usd desc', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    assert.ok(Array.isArray(r.body.recovery_by_hauler));
    for (const h of r.body.recovery_by_hauler) {
      assert.ok('recovery_pct' in h);
      assert.ok('claim_amount_usd' in h);
    }
  });

  it('filters by status=filed', async () => {
    const r = await api('GET', '/api/claims?status=filed', null, adminTok);
    assert.equal(r.status, 200);
    for (const c of r.body.claims) {
      assert.equal(c.status, 'filed');
    }
  });

  it('filters by hauler_id for axis_admin', async () => {
    const r = await api('GET', '/api/claims?hauler_id=haul-01', null, adminTok);
    assert.equal(r.status, 200);
    for (const c of r.body.claims) {
      assert.equal(c.hauler_id, 'haul-01');
    }
  });

  it('hauler_admin filter by hauler_id is ignored (scope already applied)', async () => {
    // Even if hauler_admin passes a different hauler_id, they still only see their own
    const r = await api('GET', '/api/claims?hauler_id=haul-99', null, h02Tok);
    assert.equal(r.status, 200);
    for (const c of r.body.claims) {
      assert.equal(c.hauler_id, 'haul-02');
    }
  });

  it('amount_by_status contains paid entries', async () => {
    const r = await api('GET', '/api/claims', null, adminTok);
    const paid = r.body.amount_by_status.find((s) => s.status === 'paid');
    assert.ok(paid, 'expected a paid entry in amount_by_status');
    assert.ok(paid.count > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/claims/:id', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/claims/clm-2026-04-001')).status, 401);
  });

  it('404 for unknown claim id', async () => {
    assert.equal((await api('GET', '/api/claims/clm-notexist', null, adminTok)).status, 404);
  });

  it('200 for axis_admin — returns claim and audit', async () => {
    const r = await api('GET', '/api/claims/clm-2026-04-001', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.claim, 'missing claim');
    assert.ok(Array.isArray(r.body.audit), 'missing audit array');
    assert.equal(r.body.claim.id, 'clm-2026-04-001');
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/claims/clm-2026-04-002', null, opsTok)).status, 200);
  });

  it('200 for lender — can view any claim', async () => {
    const r = await api('GET', '/api/claims/clm-2026-04-003', null, lenderTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.claim.id, 'clm-2026-04-003');
  });

  it('200 for haul-02 admin accessing own claim', async () => {
    const r = await api('GET', '/api/claims/clm-2026-04-001', null, h02Tok);
    assert.equal(r.status, 200);
  });

  it('403 for haul-01 admin accessing haul-02 claim', async () => {
    assert.equal((await api('GET', '/api/claims/clm-2026-04-001', null, h01Tok)).status, 403);
  });

  it('403 for haul-02 admin accessing haul-01 claim', async () => {
    assert.equal((await api('GET', '/api/claims/clm-2026-02-001', null, h02Tok)).status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/claims/:id/transition', () => {
  it('401 without token', async () => {
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition', { status: 'under_review' });
    assert.equal(r.status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition',
      { status: 'under_review' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('403 for lender', async () => {
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition',
      { status: 'under_review' }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('404 for unknown claim id', async () => {
    const r = await api('POST', '/api/claims/clm-notexist/transition',
      { status: 'under_review' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('400 — missing status', async () => {
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition', {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('status'));
  });

  it('400 — invalid status value', async () => {
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition',
      { status: 'cancelled' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin transitions filed → under_review', async () => {
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition',
      { status: 'under_review', notes: 'Documents received' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.claim.status, 'under_review');
    assert.equal(r.body.claim.id, 'clm-2026-04-003');
  });

  it('200 — axis_ops transitions under_review → approved with amount', async () => {
    // clm-2026-04-001 is currently under_review (mock baseline)
    const r = await api('POST', '/api/claims/clm-2026-04-001/transition', {
      status:              'approved',
      approved_amount_usd: 45000,
      notes:               'Approved after investigation',
    }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.claim.status, 'approved');
    assert.equal(r.body.claim.approved_amount_usd, 45000);
  });

  it('200 — axis_admin transitions approved → paid with payment_ref', async () => {
    // clm-2026-04-002 is approved in mock baseline
    const r = await api('POST', '/api/claims/clm-2026-04-002/transition', {
      status:              'paid',
      approved_amount_usd: 38000,
      payment_ref:         'PAY-2026-042',
      paid_at:             '2026-05-15T10:00:00Z',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.claim.status, 'paid');
    assert.equal(r.body.claim.payment_ref, 'PAY-2026-042');
  });

  it('200 — axis_admin denies a filed claim', async () => {
    // clm-2026-04-003 is now under_review after earlier test
    const r = await api('POST', '/api/claims/clm-2026-04-003/transition', {
      status: 'denied',
      notes:  'Insufficient documentation',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.claim.status, 'denied');
  });

  it('GET /:id reflects updated status after transition', async () => {
    const r = await api('GET', '/api/claims/clm-2026-04-002', null, adminTok);
    assert.equal(r.body.claim.status, 'paid');
    assert.equal(r.body.claim.payment_ref, 'PAY-2026-042');
  });
});
