'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-financials';
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
insertUser.run('u-adm',  'admin@fin.test',   bcrypt.hashSync(PASS, 1), 'Admin',   'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops',  'ops@fin.test',     bcrypt.hashSync(PASS, 1), 'Ops',     'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-ops2', 'ops2@fin.test',    bcrypt.hashSync(PASS, 1), 'Ops2',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-hul',  'hauler@fin.test',  bcrypt.hashSync(PASS, 1), 'Hauler',  'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len',  'lender@fin.test',  bcrypt.hashSync(PASS, 1), 'Lender',  'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',       require('../routes/auth'));
app.use('/api/financials', require('../routes/financials'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, ops2Tok, haulerTok, lenderTok;

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
  adminTok  = await login('admin@fin.test');
  opsTok    = await login('ops@fin.test');
  ops2Tok   = await login('ops2@fin.test');
  haulerTok = await login('hauler@fin.test');
  lenderTok = await login('lender@fin.test');
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
describe('GET /api/financials', () => {
  it('200 — open endpoint, no auth required', async () => {
    assert.equal((await api('GET', '/api/financials')).status, 200);
  });

  it('returns all expected top-level keys', async () => {
    const r = await api('GET', '/api/financials');
    for (const k of [
      'generated_at', 'dscr', 'capital', 'pnl', 'covenants',
      'receivables', 'cashflow', 'pnl_trend', 'dso_trend',
      'ebitda_bridge', 'by_hauler', 'cost_component_trend',
      'operating_cost_by_hauler',
    ]) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('capital has debt and equity fields', async () => {
    const { capital } = (await api('GET', '/api/financials')).body;
    assert.ok(typeof capital.debt_committed_usd === 'number');
    assert.ok(typeof capital.debt_drawn_usd === 'number');
    assert.ok(typeof capital.equity_committed_usd === 'number');
    assert.ok(typeof capital.equity_drawn_usd === 'number');
  });

  it('pnl has mtd and ytd', async () => {
    const { pnl } = (await api('GET', '/api/financials')).body;
    assert.ok(pnl.mtd, 'missing pnl.mtd');
    assert.ok(pnl.ytd, 'missing pnl.ytd');
  });

  it('covenants is an array', async () => {
    const { covenants } = (await api('GET', '/api/financials')).body;
    assert.ok(Array.isArray(covenants));
  });

  it('receivables has overdue_pct and followup_counts', async () => {
    const { receivables } = (await api('GET', '/api/financials')).body;
    assert.ok('overdue_pct' in receivables, 'missing overdue_pct');
    assert.ok('followup_counts' in receivables, 'missing followup_counts');
  });

  it('pnl_trend has 6 monthly entries, last one partial=true', async () => {
    const { pnl_trend } = (await api('GET', '/api/financials')).body;
    assert.equal(pnl_trend.length, 6);
    assert.equal(pnl_trend[5].partial, true);
    assert.equal(pnl_trend[5].modelled, false);
  });

  it('dso_trend has 6 entries each with month and dso', async () => {
    const { dso_trend } = (await api('GET', '/api/financials')).body;
    assert.equal(dso_trend.length, 6);
    for (const e of dso_trend) {
      assert.ok(typeof e.month === 'string');
      assert.ok(typeof e.dso === 'number');
    }
  });

  it('ebitda_bridge has prior/current month and deltas', async () => {
    const { ebitda_bridge } = (await api('GET', '/api/financials')).body;
    assert.ok('prior_month' in ebitda_bridge);
    assert.ok('current_month' in ebitda_bridge);
    assert.ok('revenue_delta' in ebitda_bridge);
    assert.ok('cost_delta' in ebitda_bridge);
    assert.ok('net_delta' in ebitda_bridge);
    assert.equal(ebitda_bridge.modelled, true);
  });

  it('by_hauler is an array with revenue and receivable fields', async () => {
    const { by_hauler } = (await api('GET', '/api/financials')).body;
    assert.ok(Array.isArray(by_hauler));
    for (const h of by_hauler) {
      assert.ok('revenue_usd' in h);
      assert.ok('receivable_usd' in h);
      assert.ok('corridor_share_pct' in h);
    }
  });

  it('cost_component_trend has 6 entries with fuel/driver/maint/other breakdown', async () => {
    const { cost_component_trend } = (await api('GET', '/api/financials')).body;
    assert.equal(cost_component_trend.length, 6);
    for (const m of cost_component_trend) {
      assert.ok('fuel_usd' in m);
      assert.ok('driver_usd' in m);
      assert.ok('maint_usd' in m);
      assert.ok('other_usd' in m);
    }
  });

  it('operating_cost_by_hauler is sorted by cost_usd desc', async () => {
    const { operating_cost_by_hauler } = (await api('GET', '/api/financials')).body;
    assert.ok(Array.isArray(operating_cost_by_hauler));
    for (let i = 1; i < operating_cost_by_hauler.length; i++) {
      assert.ok(
        operating_cost_by_hauler[i - 1].cost_usd >= operating_cost_by_hauler[i].cost_usd,
        'operating_cost_by_hauler not sorted desc',
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/financials/receivables/followups', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/financials/receivables/followups')).status, 401);
  });

  it('200 for axis_admin — returns followups array', async () => {
    const r = await api('GET', '/api/financials/receivables/followups', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.followups));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/financials/receivables/followups', null, opsTok)).status, 200);
  });

  it('200 for lender (requireAuth, not requireRole)', async () => {
    assert.equal((await api('GET', '/api/financials/receivables/followups', null, lenderTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/financials/receivables/followups', null, haulerTok)).status, 200);
  });

  it('accepts ?band filter', async () => {
    const r = await api('GET', '/api/financials/receivables/followups?band=band_61_90', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.followups));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/financials/receivables/followups', () => {
  const validBody = {
    band_id: 'band_31_60',
    notes:   'Called GIBDLC AP desk — payment confirmed for next week.',
    outcome: 'committed',
  };

  it('401 without token', async () => {
    assert.equal((await api('POST', '/api/financials/receivables/followups', validBody)).status, 401);
  });

  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/financials/receivables/followups', validBody, lenderTok)).status, 403,
    );
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/financials/receivables/followups', validBody, haulerTok)).status, 403,
    );
  });

  it('400 — invalid band_id', async () => {
    const r = await api('POST', '/api/financials/receivables/followups',
      { ...validBody, band_id: 'band_999' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — invalid outcome', async () => {
    const r = await api('POST', '/api/financials/receivables/followups',
      { ...validBody, outcome: 'maybe' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — missing notes', async () => {
    const r = await api('POST', '/api/financials/receivables/followups',
      { band_id: 'band_0_30', outcome: 'committed' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin creates followup', async () => {
    const r = await api('POST', '/api/financials/receivables/followups', validBody, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.followup);
    assert.ok(typeof r.body.followup.id === 'number');
    assert.equal(r.body.followup.band_id, 'band_31_60');
    assert.equal(r.body.followup.outcome, 'committed');
    assert.ok(r.body.followup.author);
  });

  it('200 — axis_ops creates followup with collected outcome', async () => {
    const r = await api('POST', '/api/financials/receivables/followups', {
      band_id: 'band_61_90',
      notes:   'Payment received — wire confirmed by treasury.',
      outcome: 'collected',
    }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.followup.outcome, 'collected');
  });

  it('GET followups list contains new entries after creation', async () => {
    const r = await api('GET', '/api/financials/receivables/followups', null, adminTok);
    assert.ok(r.body.followups.length >= 2, 'expected at least 2 followups in list');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/financials/receivables/followups/:id', () => {
  let adminCreatedId, opsCreatedId;

  before(async () => {
    // Admin creates one
    const r1 = await api('POST', '/api/financials/receivables/followups', {
      band_id: 'band_90p',
      notes:   'Escalated to legal for recovery.',
      outcome: 'disputed',
    }, adminTok);
    adminCreatedId = r1.body.followup.id;

    // Ops creates one
    const r2 = await api('POST', '/api/financials/receivables/followups', {
      band_id: 'band_0_30',
      notes:   'Sent reminder email — no reply yet.',
      outcome: 'no_response',
    }, opsTok);
    opsCreatedId = r2.body.followup.id;
  });

  it('401 without token', async () => {
    assert.equal(
      (await api('DELETE', `/api/financials/receivables/followups/${adminCreatedId}`)).status, 401,
    );
  });

  it('403 for lender', async () => {
    assert.equal(
      (await api('DELETE', `/api/financials/receivables/followups/${adminCreatedId}`, null, lenderTok)).status, 403,
    );
  });

  it('404 — followup not found', async () => {
    assert.equal(
      (await api('DELETE', '/api/financials/receivables/followups/999999', null, adminTok)).status, 404,
    );
  });

  it('403 — ops2 cannot delete followup created by ops (not the author)', async () => {
    assert.equal(
      (await api('DELETE', `/api/financials/receivables/followups/${opsCreatedId}`, null, ops2Tok)).status, 403,
    );
  });

  it('200 — ops deletes their own followup', async () => {
    const r = await api('DELETE', `/api/financials/receivables/followups/${opsCreatedId}`, null, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('404 — deleted followup is gone', async () => {
    assert.equal(
      (await api('DELETE', `/api/financials/receivables/followups/${opsCreatedId}`, null, opsTok)).status, 404,
    );
  });

  it('200 — axis_admin can delete any followup (not just own)', async () => {
    // Admin deletes the one they created
    const r = await api('DELETE', `/api/financials/receivables/followups/${adminCreatedId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });
});
