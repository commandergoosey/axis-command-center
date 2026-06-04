'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-contract-diesel';
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
insertUser.run('u-adm', 'admin@cd.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@cd.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@cd.test',    bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'lender@cd.test', bcrypt.hashSync(PASS, 1), 'Lender', 'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── App ───────────────────────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',     require('../routes/auth'));
app.use('/api/contract', require('../routes/contract'));
app.use('/api/diesel',   require('../routes/diesel'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, haulerTok, lenderTok;

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
  adminTok  = await login('admin@cd.test');
  opsTok    = await login('ops@cd.test');
  haulerTok = await login('h01@cd.test');
  lenderTok = await login('lender@cd.test');
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
// CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/contract', () => {
  it('200 — open endpoint, no auth required', async () => {
    assert.equal((await api('GET', '/api/contract')).status, 200);
  });

  it('has all required top-level keys', async () => {
    const r = await api('GET', '/api/contract');
    for (const k of [
      'generated_at', 'counterparty', 'terms', 'contract_basis',
      'mtd', 'ytd', 'history', 'sla', 'payment_security',
      'anomalies', 'sla_monthly_trend', 'top_projection',
    ]) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('mtd has operational fields', async () => {
    const { mtd } = (await api('GET', '/api/contract')).body;
    assert.ok(typeof mtd.month === 'string');
    assert.ok(typeof mtd.contracted_tonnes === 'number');
    assert.ok(typeof mtd.delivered_tonnes === 'number');
    assert.ok(typeof mtd.floor_tonnes === 'number');
    assert.ok(typeof mtd.cushion_tonnes === 'number');
    assert.ok(typeof mtd.attainment_pct === 'number');
    assert.ok(typeof mtd.on_track === 'boolean');
    assert.ok(typeof mtd.days_remaining === 'number');
    assert.ok(typeof mtd.required_daily_rate === 'number');
    assert.ok(typeof mtd.current_daily_rate === 'number');
    assert.ok(typeof mtd.projected_total === 'number');
    assert.ok(['AHEAD', 'ON_TRACK', 'AT_RISK'].includes(mtd.pace), `unexpected pace: ${mtd.pace}`);
  });

  it('ytd has contracted, delivered, annual_target, attainment_pct', async () => {
    const { ytd } = (await api('GET', '/api/contract')).body;
    assert.ok(typeof ytd.contracted_tonnes === 'number');
    assert.ok(typeof ytd.delivered_tonnes === 'number');
    assert.ok(typeof ytd.annual_target === 'number');
    assert.ok(typeof ytd.attainment_pct === 'number');
  });

  it('history is an array with at least one partial entry (current month)', async () => {
    const { history } = (await api('GET', '/api/contract')).body;
    assert.ok(Array.isArray(history));
    assert.ok(history.length > 0);
    const partial = history.find((h) => h.partial === true);
    assert.ok(partial, 'expected a partial:true entry for the current month');
  });

  it('sla_monthly_trend has 6 entries with month, attainment_pct, target_pct, modelled', async () => {
    const { sla_monthly_trend } = (await api('GET', '/api/contract')).body;
    assert.equal(sla_monthly_trend.length, 6);
    for (const m of sla_monthly_trend) {
      assert.ok(typeof m.month === 'string');
      assert.ok(typeof m.attainment_pct === 'number');
      assert.ok(typeof m.target_pct === 'number');
      assert.equal(m.modelled, true);
    }
  });

  it('top_projection has 12 monthly entries spanning the calendar year', async () => {
    const { top_projection } = (await api('GET', '/api/contract')).body;
    assert.equal(top_projection.length, 12);
    for (const m of top_projection) {
      assert.ok(typeof m.month === 'string');
      assert.ok(typeof m.cumulative_floor === 'number');
      assert.ok(typeof m.cumulative_target === 'number');
      assert.ok(typeof m.is_current === 'boolean');
      assert.ok(typeof m.is_future === 'boolean');
    }
    const current = top_projection.filter((m) => m.is_current);
    assert.equal(current.length, 1, 'exactly one current month');
  });

  it('top_projection cumulative values are non-decreasing', async () => {
    const { top_projection } = (await api('GET', '/api/contract')).body;
    for (let i = 1; i < top_projection.length; i++) {
      assert.ok(
        top_projection[i].cumulative_floor >= top_projection[i - 1].cumulative_floor,
        'cumulative_floor should be non-decreasing',
      );
    }
  });

  it('payment_security.sblc has days_to_expiry (non-negative number)', async () => {
    const { payment_security } = (await api('GET', '/api/contract')).body;
    assert.ok(typeof payment_security.sblc.days_to_expiry === 'number');
    assert.ok(payment_security.sblc.days_to_expiry >= 0);
  });

  it('payment_security.receivables has overdue_pct', async () => {
    const { payment_security } = (await api('GET', '/api/contract')).body;
    assert.ok(typeof payment_security.receivables.overdue_pct === 'number');
  });

  it('anomalies is an array', async () => {
    const { anomalies } = (await api('GET', '/api/contract')).body;
    assert.ok(Array.isArray(anomalies));
  });

  it('contract_basis has key tariff and take-or-pay fields', async () => {
    const { contract_basis } = (await api('GET', '/api/contract')).body;
    assert.ok(typeof contract_basis.target_mtpa === 'number');
    assert.ok(typeof contract_basis.take_or_pay_floor_pct === 'number');
    assert.ok(typeof contract_basis.monthly_tonnes_contracted === 'number');
    assert.ok(typeof contract_basis.base_tariff_usd_per_tonne === 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DIESEL
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/diesel', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/diesel')).status, 401);
  });

  it('200 for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      assert.equal((await api('GET', '/api/diesel', null, tok)).status, 200);
    }
  });

  it('has all required top-level keys', async () => {
    const r = await api('GET', '/api/diesel', null, adminTok);
    for (const k of [
      'burn_ranking', 'price_history', 'sensitivity_scenarios',
      'fleet_efficiency', 'monthly_cost_trend',
    ]) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('burn_ranking is sorted by fuel_usd_per_tonne descending', async () => {
    const { burn_ranking } = (await api('GET', '/api/diesel', null, adminTok)).body;
    assert.ok(Array.isArray(burn_ranking));
    for (let i = 1; i < burn_ranking.length; i++) {
      assert.ok(
        burn_ranking[i - 1].fuel_usd_per_tonne >= burn_ranking[i].fuel_usd_per_tonne,
        'burn_ranking not sorted descending',
      );
    }
  });

  it('burn_ranking entries have vs_avg_usd and vs_avg_pct', async () => {
    const { burn_ranking } = (await api('GET', '/api/diesel', null, adminTok)).body;
    for (const h of burn_ranking) {
      assert.ok('vs_avg_usd' in h);
      assert.ok('vs_avg_pct' in h);
      assert.ok(typeof h.hauler_id === 'string');
    }
  });

  it('price_history has 12 weekly entries', async () => {
    const { price_history } = (await api('GET', '/api/diesel', null, adminTok)).body;
    assert.equal(price_history.length, 12);
    for (const w of price_history) {
      assert.ok(typeof w.week_of === 'string');
      assert.ok(typeof w.price_ghs_per_litre === 'number');
      assert.ok(typeof w.burn_usd_per_tonne === 'number');
    }
  });

  it('sensitivity_scenarios has 7 entries including base case', async () => {
    const { sensitivity_scenarios } = (await api('GET', '/api/diesel', null, adminTok)).body;
    assert.equal(sensitivity_scenarios.length, 7);
    const base = sensitivity_scenarios.find((s) => s.pct_change === 0);
    assert.ok(base, 'missing base-case scenario (pct_change === 0)');
    assert.equal(base.is_base, true);
    assert.equal(base.modelled, true);
    for (const s of sensitivity_scenarios) {
      assert.ok(typeof s.delta_fuel_usd_per_tonne === 'number');
      assert.ok(typeof s.delta_ebitda_usd === 'number');
    }
  });

  it('sensitivity_scenarios pct_changes span -15 to +15', async () => {
    const { sensitivity_scenarios } = (await api('GET', '/api/diesel', null, adminTok)).body;
    const pcts = sensitivity_scenarios.map((s) => s.pct_change).sort((a, b) => a - b);
    assert.deepEqual(pcts, [-15, -10, -5, 0, 5, 10, 15]);
  });

  it('fleet_efficiency has corridor_avg_l_per_100km and haulers array', async () => {
    const { fleet_efficiency } = (await api('GET', '/api/diesel', null, adminTok)).body;
    assert.ok(typeof fleet_efficiency.corridor_avg_l_per_100km === 'number');
    assert.ok(Array.isArray(fleet_efficiency.haulers));
    for (const h of fleet_efficiency.haulers) {
      assert.ok(typeof h.avg_l_per_100km === 'number');
      assert.ok(typeof h.vs_corridor === 'number');
    }
  });

  it('monthly_cost_trend has 6 entries each marked modelled', async () => {
    const { monthly_cost_trend } = (await api('GET', '/api/diesel', null, adminTok)).body;
    assert.equal(monthly_cost_trend.length, 6);
    for (const m of monthly_cost_trend) {
      assert.ok(typeof m.month === 'string');
      assert.ok(typeof m.cost_usd === 'number');
      assert.equal(m.modelled, true);
    }
  });
});
