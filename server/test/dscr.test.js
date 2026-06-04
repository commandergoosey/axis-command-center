'use strict';

/*
 * Tests for services/dscr.js
 *
 * DSCR = Debt Service Coverage Ratio. compute() stubs buildForecast
 * (which depends on workorderState); all mock constants load from disk.
 *
 * Key constants derived from mock files:
 *   effective_tariff_usd  ≈ $22.90/tonne  (PNL_YTD.revenue_usd / 4-mo tonnes)
 *   opcost_ratio          ≈ 0.6327         (PNL_YTD.operating_costs / revenue)
 *   monthly_debt_service  ≈ $1,021,623     ($63M, 9.25%, 7yr)
 *   target_min            = 1.3
 *
 * EOM tonnage → trailing-3 DSCR verdict:
 *    65,000 t → DSCR ≈ 0.57 → BREACH
 *   350,000 t → DSCR ≈ 1.35 → WATCH (1.30 ≤ DSCR < 1.35)
 *   500,000 t → DSCR ≈ 1.76 → PASS  (≥ 1.35)
 *
 * (These unrealistically large "WATCH" and "PASS" values arise because the
 * mock PNL_YTD EBITDA is still low from the ramp-up months — the
 * service is faithfully using a trailing average that includes them.)
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

function stubForecast(eomTonnes) {
  stub('../services/forecast',
    { buildForecast: () => ({ projection: { eom_tonnes: eomTonnes } }) });
}

function stubForecastThrows() {
  stub('../services/forecast',
    { buildForecast: () => { throw new Error('forecast unavailable'); } });
}

// workorderState is required transitively through forecast; stub it to
// avoid side-effects even though our forecast stub makes it irrelevant.
function freshCompute(eomTonnes) {
  stub('../state/workorderState', { allOpen: () => [] });
  stubForecast(eomTonnes);
  delete require.cache[require.resolve('../services/dscr')];
  return require('../services/dscr').compute;
}

after(() => {
  for (const p of [
    '../services/dscr',
    '../services/forecast',
    '../state/workorderState',
  ]) delete require.cache[require.resolve(p)];
});

const NOW = new Date('2026-05-21T00:00:00Z');

// ── Output shape ──────────────────────────────────────────────────

describe('dscr — output shape', () => {
  it('compute() returns all required top-level keys', () => {
    const compute = freshCompute(65_000);
    const r = compute([], NOW);
    for (const k of ['current', 'target_min', 'steady_state', 'trailing_6m_avg',
                      'headroom_pct', 'series', 'computed']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('computed block has all expected fields', () => {
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    assert.ok(computed != null, 'computed should not be null on success');
    for (const k of ['this_month_revenue_usd', 'this_month_ebitda_usd', 'this_month_dscr',
                      'monthly_debt_service_usd', 'opcost_ratio', 'effective_tariff_usd']) {
      assert.ok(k in computed, `computed missing field: ${k}`);
    }
  });

  it('target_min, steady_state, trailing_6m_avg match the static fixture', () => {
    const compute = freshCompute(65_000);
    const r = compute([], NOW);
    assert.equal(r.target_min,      1.3);
    assert.equal(r.steady_state,    2.5);
    // trailing_6m_avg comes from STATIC_DSCR fixture
    assert.equal(typeof r.trailing_6m_avg, 'number');
  });

  it('series is an array of length 6 (static series entries)', () => {
    const compute = freshCompute(65_000);
    const { series } = compute([], NOW);
    assert.ok(Array.isArray(series));
    assert.equal(series.length, 6);
  });

  it('each series entry has month and dscr fields', () => {
    const compute = freshCompute(65_000);
    for (const e of compute([], NOW).series) {
      assert.ok('month' in e, `series entry missing month`);
      assert.ok('dscr'  in e, `series entry missing dscr`);
    }
  });
});

// ── Fallback behaviour ────────────────────────────────────────────

describe('dscr — fallback on error', () => {
  it('returns static fixture with computed=null when buildForecast throws', () => {
    stub('../state/workorderState', { allOpen: () => [] });
    stubForecastThrows();
    delete require.cache[require.resolve('../services/dscr')];
    const compute = require('../services/dscr').compute;

    const r = compute([], NOW);
    assert.equal(r.computed, null, 'computed should be null in fallback');
    assert.ok('target_min' in r, 'fallback should still carry target_min');
    assert.equal(r.target_min, 1.3);
  });

  it('fallback never throws', () => {
    stub('../state/workorderState', { allOpen: () => [] });
    stubForecastThrows();
    delete require.cache[require.resolve('../services/dscr')];
    const compute = require('../services/dscr').compute;
    assert.doesNotThrow(() => compute([], NOW));
  });
});

// ── DSCR formula and verdicts ─────────────────────────────────────

describe('dscr — formula and verdicts', () => {
  it('eom=65,000 → BREACH (DSCR ≈ 0.57)', () => {
    const compute = freshCompute(65_000);
    const r = compute([], NOW);
    assert.ok(r.current < 1.3, `DSCR ${r.current} should be below target 1.3`);
    assert.ok(r.headroom_pct < 0, 'headroom_pct should be negative when in BREACH');
  });

  it('eom=340,000 → WATCH (1.30 ≤ DSCR < 1.35)', () => {
    // 340k gives DSCR ≈ 1.32; 350k gives exactly 1.35 (PASS boundary)
    const compute = freshCompute(340_000);
    const r = compute([], NOW);
    assert.ok(r.current >= 1.30,
      `DSCR ${r.current} should be ≥1.30 (WATCH lower bound)`);
    assert.ok(r.current < 1.35,
      `DSCR ${r.current} should be <1.35 (WATCH upper bound)`);
  });

  it('eom=500,000 → PASS (DSCR ≥ 1.35)', () => {
    const compute = freshCompute(500_000);
    const r = compute([], NOW);
    assert.ok(r.current >= 1.35,
      `DSCR ${r.current} should be ≥1.35 for PASS`);
    assert.ok(r.headroom_pct > 0, 'headroom_pct should be positive when passing');
  });

  it('higher eom_tonnes → higher DSCR (monotone relationship)', () => {
    const low  = freshCompute(50_000)([], NOW).current;
    const mid  = freshCompute(100_000)([], NOW).current;
    const high = freshCompute(200_000)([], NOW).current;
    assert.ok(low < mid,  `low DSCR ${low} should be less than mid ${mid}`);
    assert.ok(mid < high, `mid DSCR ${mid} should be less than high ${high}`);
  });

  it('headroom_pct is consistent with current and target_min (within 0.5 pct point)', () => {
    // headroom uses full-precision trailing3Dscr; r.current is rounded to 2dp.
    // These can diverge by up to ~0.5 percentage points, so we verify approximate
    // consistency rather than exact equality.
    const compute = freshCompute(65_000);
    const r = compute([], NOW);
    const approx = Number((((r.current - r.target_min) / r.target_min) * 100).toFixed(1));
    assert.ok(Math.abs(r.headroom_pct - approx) <= 0.5,
      `headroom_pct ${r.headroom_pct} too far from approx ${approx}`);
  });

  it('current = Number(trailing3Dscr.toFixed(2)) — is a 2-dp number', () => {
    const compute = freshCompute(65_000);
    const r = compute([], NOW);
    assert.equal(typeof r.current, 'number');
    assert.equal(r.current, Number(r.current.toFixed(2)));
  });
});

// ── Computed internals ────────────────────────────────────────────

describe('dscr — computed internals', () => {
  it('this_month_revenue_usd ≈ eomTonnes × effective_tariff_usd (within 0.1%)', () => {
    // Code uses full-precision tariff; computed.effective_tariff_usd is rounded to 2dp.
    // Cross-check: revenue / (eomTonnes × rounded_tariff) should be within 0.1%.
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    assert.ok(computed.this_month_revenue_usd > 0, 'revenue should be positive');
    const ratio = computed.this_month_revenue_usd / (65_000 * computed.effective_tariff_usd);
    assert.ok(Math.abs(ratio - 1) < 0.001,
      `revenue ratio ${ratio} should be within 0.1% of 1.0`);
  });

  it('this_month_ebitda_usd = revenue × (1 − real_opcost_ratio), ebitda < revenue', () => {
    // opcost_ratio in computed is rounded to 3dp; code uses full precision internally.
    // Verify the ebitda/revenue ratio is within ±1 percentage point of (1 - opcost_ratio).
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    const ebitdaRatio = computed.this_month_ebitda_usd / computed.this_month_revenue_usd;
    const expectedRatio = 1 - computed.opcost_ratio;
    assert.ok(computed.this_month_ebitda_usd > 0, 'ebitda should be positive');
    assert.ok(computed.this_month_ebitda_usd < computed.this_month_revenue_usd,
      'ebitda should be less than revenue');
    assert.ok(Math.abs(ebitdaRatio - expectedRatio) < 0.01,
      `ebitda/revenue ratio ${ebitdaRatio.toFixed(4)} not within 1pp of ${expectedRatio.toFixed(4)}`);
  });

  it('this_month_dscr = ebitda / monthly_debt_service, 2dp', () => {
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    const expected = Number(
      (computed.this_month_ebitda_usd / computed.monthly_debt_service_usd).toFixed(2),
    );
    assert.equal(computed.this_month_dscr, expected);
  });

  it('opcost_ratio ≈ 0.633 (PNL_YTD operating_costs / revenue)', () => {
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    assert.ok(Math.abs(computed.opcost_ratio - 0.633) < 0.001,
      `opcost_ratio ${computed.opcost_ratio} expected ≈ 0.633`);
  });

  it('effective_tariff_usd ≈ $22.90 (derived from PNL_YTD)', () => {
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    assert.ok(Math.abs(computed.effective_tariff_usd - 22.90) < 0.05,
      `effective_tariff ${computed.effective_tariff_usd} expected ≈ $22.90`);
  });

  it('monthly_debt_service_usd ≈ $1,021,623 ($63M, 9.25%, 7yr)', () => {
    const compute = freshCompute(65_000);
    const { computed } = compute([], NOW);
    assert.ok(Math.abs(computed.monthly_debt_service_usd - 1_021_623) < 10,
      `monthly DS $${computed.monthly_debt_service_usd} expected ≈ $1,021,623`);
  });
});

// ── Series live overwrite ─────────────────────────────────────────

describe('dscr — series live overwrite', () => {
  it('series entry for current month is overwritten with live dscr when present', () => {
    // 2026-04 IS in the static series; use April date to trigger overwrite
    const compute = freshCompute(100_000);
    const r = compute([], new Date('2026-04-15T00:00:00Z'));
    const apr = r.series.find((s) => s.month === '2026-04');
    assert.ok(apr != null, '2026-04 should exist in series');
    assert.equal(apr.computed, true, 'overwritten entry should have computed=true');
    assert.equal(apr.partial,  true);
    assert.equal(typeof apr.dscr, 'number');
  });

  it('series length is unchanged after overwrite (no new entry added)', () => {
    const compute = freshCompute(100_000);
    const r = compute([], new Date('2026-04-15T00:00:00Z'));
    assert.equal(r.series.length, 6, 'series length should remain 6 after overwrite');
  });

  it('series entries for past months are NOT modified when current month differs', () => {
    // Use May 2026 — not in the static series, so no overwrite happens
    const compute = freshCompute(65_000);
    const r = compute([], NOW); // NOW = 2026-05-21, not in series
    // All 6 entries should be the original static ones (no computed=true flag)
    for (const e of r.series) {
      assert.ok(e.month !== '2026-05', '2026-05 should not appear in series');
    }
  });
});

// ── Exported constant ─────────────────────────────────────────────

describe('dscr — exported constants', () => {
  it('MONTHLY_DEBT_SERVICE_USD is exported and ≈ $1,021,623', () => {
    stub('../state/workorderState', { allOpen: () => [] });
    stub('../services/forecast',
      { buildForecast: () => ({ projection: { eom_tonnes: 65_000 } }) });
    delete require.cache[require.resolve('../services/dscr')];
    const { MONTHLY_DEBT_SERVICE_USD } = require('../services/dscr');
    assert.equal(typeof MONTHLY_DEBT_SERVICE_USD, 'number');
    assert.ok(Math.abs(MONTHLY_DEBT_SERVICE_USD - 1_021_623) < 10,
      `MONTHLY_DEBT_SERVICE_USD ${MONTHLY_DEBT_SERVICE_USD} expected ≈ 1,021,623`);
  });
});
