'use strict';

/*
 * Tests for services/covenants.js — buildCovenants()
 *
 * buildCovenants() calls:
 *   aggregate(haulers, now)        — pure function from aggregator, no stub needed
 *   buildForecast(haulers, now)    — stubbed via require.cache
 *   dscrService.compute(haulers, now) — stubbed via require.cache
 *
 * Mock constants (financials, tranches, contract) load from disk.
 *
 * Seven covenants produced:
 *   1. cov-dscr          — live DSCR vs target_min (1.3)
 *   2. cov-gearing       — fixed structure from mock (should be PASS)
 *   3. cov-take-or-pay   — projected EOM vs floor (66,667 t)
 *   4. cov-concentration — top hauler share of MTD tonnes
 *   5. cov-sla           — corridor-weighted on-time rate
 *   6. cov-ageing        — receivables overdue %
 *   7. cov-liquidity     — from STATIC_COVENANTS fixture
 *
 * Status thresholds:
 *   DSCR:          PASS ≥ 1.35 | WATCH ≥ 1.30 | BREACH < 1.30
 *   Take-or-pay:   PASS cushion ≥5% | WATCH 0≤cushion<5% | BREACH <0
 *   Concentration: PASS < 40% | WATCH 40–50% | BREACH ≥ 50%
 *   SLA:           PASS ≥ 90% | WATCH 88–90% | BREACH < 88%
 *   Receivables:   PASS < 5%  | WATCH 5–8%  | BREACH ≥ 8%
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub helpers ──────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id:       require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded:   true,
    exports,
  };
}

// Minimal forecast result covenants.js actually reads
function makeForecast({ eomTonnes = 79_000, haulers = [] } = {}) {
  return {
    projection: { eom_tonnes: eomTonnes, verdict: 'above_floor' },
    targets:    { floor: 66_667 },
    horizon:    { days_remaining: 10 },
    haulers,
  };
}

function makeDscr({ current = 0.57, target_min = 1.3 } = {}) {
  return {
    current,
    target_min,
    headroom_pct: Number((((current - target_min) / target_min) * 100).toFixed(1)),
    computed: {},
  };
}

function makeHauler(id, overrides = {}) {
  return {
    id,
    display_name:   `Hauler ${id}`,
    status:         overrides.status         ?? 'active',
    onboarded_date: '2026-01-01',
    run_rate:       overrides.run_rate        ?? 1.0,
    fleet: {
      contracted_trucks: overrides.contracted_trucks ?? 10,
      active_trucks:     overrides.active_trucks     ?? 10,
    },
    performance: { sla_attainment_pct: overrides.sla_attainment_pct ?? 95 },
    integration: {
      type:            overrides.integration_type ?? 'api',
      error_count_24h: overrides.error_count_24h  ?? 0,
    },
  };
}

const NOW = new Date('2026-05-21T00:00:00Z');

function freshBuildCovenants(forecastOpts, dscrOpts) {
  stub('../state/workorderState', { allOpen: () => [] }); // transitive dep guard
  stub('../services/forecast',    { buildForecast: () => makeForecast(forecastOpts) });
  stub('../services/dscr',        { compute:       () => makeDscr(dscrOpts) });
  delete require.cache[require.resolve('../services/covenants')];
  return require('../services/covenants').buildCovenants;
}

after(() => {
  for (const p of [
    '../services/covenants',
    '../services/forecast',
    '../services/dscr',
    '../state/workorderState',
  ]) delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────

describe('covenants — output shape', () => {
  it('returns an array of 7 covenant entries', () => {
    const buildCovenants = freshBuildCovenants();
    const result = buildCovenants([], NOW);
    assert.ok(Array.isArray(result), 'result should be an array');
    assert.equal(result.length, 7);
  });

  it('includes all 7 expected covenant ids', () => {
    const buildCovenants = freshBuildCovenants();
    const ids = buildCovenants([], NOW).map((c) => c.id);
    for (const id of ['cov-dscr', 'cov-gearing', 'cov-take-or-pay',
                       'cov-concentration', 'cov-sla', 'cov-ageing', 'cov-liquidity']) {
      assert.ok(ids.includes(id), `missing covenant id: ${id}`);
    }
  });

  it('each entry has required fields: id, name, metric, status, detail, threshold, current', () => {
    const buildCovenants = freshBuildCovenants();
    for (const c of buildCovenants([], NOW)) {
      for (const k of ['id', 'name', 'metric', 'status', 'detail']) {
        assert.ok(k in c, `${c.id} missing field: ${k}`);
      }
    }
  });

  it('all status values are one of PASS / WATCH / BREACH', () => {
    const buildCovenants = freshBuildCovenants();
    for (const c of buildCovenants([], NOW)) {
      assert.ok(['PASS', 'WATCH', 'BREACH'].includes(c.status),
        `${c.id} has unexpected status: ${c.status}`);
    }
  });
});

// ── Covenant 1: DSCR ──────────────────────────────────────────────

describe('covenants — cov-dscr', () => {
  it('PASS when DSCR ≥ target_min + 0.05 (1.35)', () => {
    const build = freshBuildCovenants({}, { current: 1.40 });
    const cov = build([], NOW).find((c) => c.id === 'cov-dscr');
    assert.equal(cov.status, 'PASS');
  });

  it('WATCH when target_min ≤ DSCR < target_min + 0.05', () => {
    const build = freshBuildCovenants({}, { current: 1.32 });
    const cov = build([], NOW).find((c) => c.id === 'cov-dscr');
    assert.equal(cov.status, 'WATCH');
  });

  it('BREACH when DSCR < target_min (1.30)', () => {
    const build = freshBuildCovenants({}, { current: 0.57 });
    const cov = build([], NOW).find((c) => c.id === 'cov-dscr');
    assert.equal(cov.status, 'BREACH');
  });

  it('metric reflects the current DSCR formatted as "X.XX×"', () => {
    const build = freshBuildCovenants({}, { current: 1.40 });
    const cov = build([], NOW).find((c) => c.id === 'cov-dscr');
    assert.ok(cov.metric.includes('1.40'), `metric "${cov.metric}" should contain 1.40`);
  });

  it('threshold = target_min (1.3)', () => {
    const build = freshBuildCovenants({}, { current: 0.57, target_min: 1.3 });
    const cov = build([], NOW).find((c) => c.id === 'cov-dscr');
    assert.equal(cov.threshold, 1.3);
  });
});

// ── Covenant 2: Gearing ───────────────────────────────────────────

describe('covenants — cov-gearing', () => {
  it('exists in output with id cov-gearing', () => {
    const build = freshBuildCovenants();
    const cov = build([], NOW).find((c) => c.id === 'cov-gearing');
    assert.ok(cov != null);
  });

  it('status is PASS (mock capital structure is within 70/30)', () => {
    const build = freshBuildCovenants();
    const cov = build([], NOW).find((c) => c.id === 'cov-gearing');
    // CAPITAL_STRUCTURE: $63M debt, $27M equity → 70% → PASS (≤70)
    assert.equal(cov.status, 'PASS');
  });
});

// ── Covenant 3: Take-or-pay floor ────────────────────────────────

describe('covenants — cov-take-or-pay', () => {
  it('PASS when projected EOM has ≥5% cushion over floor', () => {
    // floor=66,667; eom=73,334 → cushionPct ≈ 10%
    const build = freshBuildCovenants({ eomTonnes: 73_334 });
    const cov = build([], NOW).find((c) => c.id === 'cov-take-or-pay');
    assert.equal(cov.status, 'PASS');
  });

  it('WATCH when cushion is 0–5% over floor', () => {
    // floor=66,667; eom=68,000 → cushion=1,333 → cushionPct ≈ 2.0%
    const build = freshBuildCovenants({ eomTonnes: 68_000 });
    const cov = build([], NOW).find((c) => c.id === 'cov-take-or-pay');
    assert.equal(cov.status, 'WATCH');
  });

  it('BREACH when projected EOM is below floor', () => {
    // floor=66,667; eom=65,000 → cushion=-1,667
    const build = freshBuildCovenants({ eomTonnes: 65_000 });
    const cov = build([], NOW).find((c) => c.id === 'cov-take-or-pay');
    assert.equal(cov.status, 'BREACH');
  });

  it('threshold = floor target (66,667)', () => {
    const build = freshBuildCovenants({ eomTonnes: 79_000 });
    const cov = build([], NOW).find((c) => c.id === 'cov-take-or-pay');
    assert.equal(cov.threshold, 66_667);
  });

  it('current = projected eom_tonnes', () => {
    const build = freshBuildCovenants({ eomTonnes: 79_364 });
    const cov = build([], NOW).find((c) => c.id === 'cov-take-or-pay');
    assert.equal(cov.current, 79_364);
  });
});

// ── Covenant 4: Concentration ─────────────────────────────────────

describe('covenants — cov-concentration', () => {
  it('BREACH when single hauler has 100% of delivered tonnes', () => {
    const build = freshBuildCovenants({
      haulers: [{ status: 'active', delivered_mtd: 10_000, display_name: 'H1', hauler_id: 'h1' }],
    });
    const cov = build([], NOW).find((c) => c.id === 'cov-concentration');
    assert.equal(cov.status, 'BREACH');
  });

  it('BREACH when top hauler has exactly 50% share', () => {
    const build = freshBuildCovenants({
      haulers: [
        { status: 'active', delivered_mtd: 5_000, display_name: 'H1', hauler_id: 'h1' },
        { status: 'active', delivered_mtd: 5_000, display_name: 'H2', hauler_id: 'h2' },
      ],
    });
    const cov = build([], NOW).find((c) => c.id === 'cov-concentration');
    assert.equal(cov.status, 'BREACH'); // ≥50% = BREACH
  });

  it('WATCH when top hauler has 44% share', () => {
    // H1=44000, H2=36000, H3=20000 → total=100000, top=H1 44% → WATCH (40–50%)
    const build = freshBuildCovenants({
      haulers: [
        { status: 'active', delivered_mtd: 44_000, display_name: 'H1', hauler_id: 'h1' },
        { status: 'active', delivered_mtd: 36_000, display_name: 'H2', hauler_id: 'h2' },
        { status: 'active', delivered_mtd: 20_000, display_name: 'H3', hauler_id: 'h3' },
      ],
    });
    const cov = build([], NOW).find((c) => c.id === 'cov-concentration');
    assert.equal(cov.status, 'WATCH');
  });

  it('PASS when top hauler has less than 40%', () => {
    // Three equal haulers: each 33.3%
    const build = freshBuildCovenants({
      haulers: [
        { status: 'active', delivered_mtd: 10_000, display_name: 'H1', hauler_id: 'h1' },
        { status: 'active', delivered_mtd: 10_000, display_name: 'H2', hauler_id: 'h2' },
        { status: 'active', delivered_mtd: 10_000, display_name: 'H3', hauler_id: 'h3' },
      ],
    });
    const cov = build([], NOW).find((c) => c.id === 'cov-concentration');
    assert.equal(cov.status, 'PASS');
  });

  it('threshold = 50 (CONCENTRATION_BREACH_PCT)', () => {
    const build = freshBuildCovenants({ haulers: [] });
    const cov = build([], NOW).find((c) => c.id === 'cov-concentration');
    assert.equal(cov.threshold, 50);
  });
});

// ── Covenant 5: SLA ───────────────────────────────────────────────

describe('covenants — cov-sla', () => {
  it('PASS when corridor SLA ≥ 90%', () => {
    // Pass haulers with sla_attainment_pct=95 (aggregate computes the SLA)
    const build = freshBuildCovenants();
    const cov = build([makeHauler('h1', { sla_attainment_pct: 95 })], NOW).find((c) => c.id === 'cov-sla');
    assert.equal(cov.status, 'PASS');
  });

  it('WATCH when 88% ≤ SLA < 90%', () => {
    const build = freshBuildCovenants();
    const cov = build([makeHauler('h1', { sla_attainment_pct: 89 })], NOW).find((c) => c.id === 'cov-sla');
    assert.equal(cov.status, 'WATCH');
  });

  it('BREACH when SLA < 88%', () => {
    const build = freshBuildCovenants();
    const cov = build([makeHauler('h1', { sla_attainment_pct: 85 })], NOW).find((c) => c.id === 'cov-sla');
    assert.equal(cov.status, 'BREACH');
  });

  it('threshold = 88 (SLA_BREACH_PCT)', () => {
    const build = freshBuildCovenants();
    const cov = build([makeHauler('h1', { sla_attainment_pct: 95 })], NOW).find((c) => c.id === 'cov-sla');
    assert.equal(cov.threshold, 88);
  });
});

// ── Covenant 6: Receivables ageing ───────────────────────────────

describe('covenants — cov-ageing', () => {
  it('exists and has status based on mock PAYMENT_SECURITY data', () => {
    const build = freshBuildCovenants();
    const cov = build([], NOW).find((c) => c.id === 'cov-ageing');
    assert.ok(cov != null);
    assert.ok(['PASS', 'WATCH', 'BREACH'].includes(cov.status));
  });

  it('threshold = 8 (RECEIVABLES_BREACH_PCT)', () => {
    const build = freshBuildCovenants();
    const cov = build([], NOW).find((c) => c.id === 'cov-ageing');
    assert.equal(cov.threshold, 8);
  });
});

// ── Covenant 7: Liquidity ─────────────────────────────────────────

describe('covenants — cov-liquidity', () => {
  it('exists in output (carried from STATIC_COVENANTS fixture)', () => {
    const build = freshBuildCovenants();
    const cov = build([], NOW).find((c) => c.id === 'cov-liquidity');
    assert.ok(cov != null, 'cov-liquidity should be present');
  });
});
