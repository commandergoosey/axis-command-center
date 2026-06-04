'use strict';

/*
 * Tests for services/sensitivity.js
 *
 * FX & cost sensitivity calculator. Pure compute — stubs buildForecast
 * (→ fixed eom_tonnes) and roster.list (→ empty array) via require.cache.
 * All mock constants (tariff, financials, tranches) load from disk as-is.
 *
 * Key numeric relationships tested directionally (not exact values) to
 * avoid brittleness against mock constant edits. Shape and structural
 * invariants are tested precisely.
 *
 * Contract constants (from mock files):
 *   base_tariff          = $24.00/tonne
 *   pass_through floor   = 75%, cap = 125%
 *   DSCR target_min      = 1.3
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub helpers ──────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id: require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded: true,
    exports,
  };
}

const FIXED_EOM = 65_000; // controlled eom_tonnes for deterministic math
const NOW = new Date('2026-05-21T00:00:00Z');

function freshCompose(eomTonnes = FIXED_EOM) {
  stub('../services/forecast', { buildForecast: () => ({ projection: { eom_tonnes: eomTonnes } }) });
  stub('../state/roster',      { list: () => [] });
  delete require.cache[require.resolve('../services/sensitivity')];
  const { compose, PRESETS } = require('../services/sensitivity');
  return { compose, PRESETS };
}

after(() => {
  for (const p of [
    '../services/sensitivity',
    '../services/forecast',
    '../state/roster',
  ]) delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────

describe('sensitivity — output shape', () => {
  it('compose() returns all required top-level keys', () => {
    const { compose } = freshCompose();
    const result = compose({}, NOW);
    for (const k of ['generated_at', 'inputs', 'bounds', 'baseline', 'scenario',
                      'deltas', 'waterfall', 'presets']) {
      assert.ok(k in result, `missing top-level key: ${k}`);
    }
  });

  it('inputs echoes the supplied shift parameters', () => {
    const { compose } = freshCompose();
    const result = compose({ cedi_pct: -10, diesel_pct: 5, opex_pct: 3 }, NOW);
    assert.equal(result.inputs.cedi_pct,   -10);
    assert.equal(result.inputs.diesel_pct,   5);
    assert.equal(result.inputs.opex_pct,     3);
  });

  it('bounds has expected min/max for all three axes', () => {
    const { compose } = freshCompose();
    const { bounds } = compose({}, NOW);
    assert.equal(bounds.cedi_pct.min,   -25);
    assert.equal(bounds.cedi_pct.max,    25);
    assert.equal(bounds.diesel_pct.min, -30);
    assert.equal(bounds.diesel_pct.max,  50);
    assert.equal(bounds.opex_pct.min,   -10);
    assert.equal(bounds.opex_pct.max,    30);
  });

  it('baseline has required DSCR/P&L fields', () => {
    const { compose } = freshCompose();
    const { baseline } = compose({}, NOW);
    for (const k of ['current', 'verdict', 'revenue_usd', 'opex_usd',
                      'ebitda_usd', 'debt_service_usd', 'tariff_effective',
                      'opex_ratio_pct', 'projected_tonnes']) {
      assert.ok(k in baseline, `baseline missing field: ${k}`);
    }
  });

  it('scenario has the same field set as baseline', () => {
    const { compose } = freshCompose();
    const { baseline, scenario } = compose({}, NOW);
    for (const k of Object.keys(baseline)) {
      assert.ok(k in scenario, `scenario missing field: ${k}`);
    }
  });

  it('deltas has all expected comparison fields', () => {
    const { compose } = freshCompose();
    const { deltas } = compose({}, NOW);
    for (const k of ['dscr', 'ebitda_usd', 'revenue_usd', 'opex_usd',
                      'tariff_effective', 'headroom_pct', 'verdict_changed', 'crosses_floor']) {
      assert.ok(k in deltas, `deltas missing field: ${k}`);
    }
  });

  it('waterfall has exactly 5 entries', () => {
    const { compose } = freshCompose();
    assert.equal(compose({}, NOW).waterfall.length, 5);
  });

  it('each waterfall entry has label / dscr / step / type', () => {
    const { compose } = freshCompose();
    for (const w of compose({}, NOW).waterfall) {
      for (const k of ['label', 'dscr', 'step', 'type']) {
        assert.ok(k in w, `waterfall entry missing: ${k}`);
      }
    }
  });
});

// ── Zero-shift identity ───────────────────────────────────────────

describe('sensitivity — zero-shift identity', () => {
  it('scenario.current === baseline.current when all shifts are zero', () => {
    const { compose } = freshCompose();
    const { baseline, scenario } = compose({}, NOW);
    assert.equal(scenario.current, baseline.current);
  });

  it('deltas.dscr === 0 at zero shift', () => {
    const { compose } = freshCompose();
    assert.equal(compose({}, NOW).deltas.dscr, 0);
  });

  it('deltas.verdict_changed is false at zero shift', () => {
    const { compose } = freshCompose();
    assert.equal(compose({}, NOW).deltas.verdict_changed, false);
  });

  it('deltas.tariff_effective === 0 at zero shift', () => {
    const { compose } = freshCompose();
    assert.equal(compose({}, NOW).deltas.tariff_effective, 0);
  });

  it('baseline.projected_tonnes matches the stubbed eom_tonnes', () => {
    const { compose } = freshCompose(70_000);
    assert.equal(compose({}, NOW).baseline.projected_tonnes, 70_000);
  });
});

// ── Tariff sensitivity ────────────────────────────────────────────

describe('sensitivity — tariff under shift', () => {
  it('cedi weakening (cedi_pct < 0) raises effective tariff', () => {
    const { compose } = freshCompose();
    const base   = compose({},             NOW).baseline.tariff.effective_usd_per_tonne;
    const stress = compose({ cedi_pct: -10 }, NOW).scenario.tariff.effective_usd_per_tonne;
    assert.ok(stress > base, `cedi stress tariff ${stress} should exceed baseline ${base}`);
  });

  it('cedi strengthening (cedi_pct > 0) lowers effective tariff', () => {
    const { compose } = freshCompose();
    const base     = compose({},            NOW).baseline.tariff.effective_usd_per_tonne;
    const improve  = compose({ cedi_pct: 10 }, NOW).scenario.tariff.effective_usd_per_tonne;
    assert.ok(improve < base, `cedi improve tariff ${improve} should be below baseline ${base}`);
  });

  it('diesel price increase (diesel_pct > 0) raises effective tariff', () => {
    const { compose } = freshCompose();
    const base   = compose({},               NOW).baseline.tariff.effective_usd_per_tonne;
    const stress = compose({ diesel_pct: 20 }, NOW).scenario.tariff.effective_usd_per_tonne;
    assert.ok(stress > base, `diesel stress tariff ${stress} should exceed baseline ${base}`);
  });

  it('extreme cedi weakening (-50%) hits the 125% pass-through cap', () => {
    const { compose } = freshCompose();
    const result = compose({ cedi_pct: -50 }, NOW);
    assert.equal(result.scenario.tariff.clamped_at_cap, true,
      'cedi_pct=-50% should clamp at cap');
  });

  it('capped tariff never exceeds base × 1.25', () => {
    const { compose } = freshCompose();
    const { scenario } = compose({ cedi_pct: -50, diesel_pct: 50 }, NOW);
    const BASE = 24.00;
    assert.ok(scenario.tariff.effective_usd_per_tonne <= BASE * 1.25 + 0.01,
      `tariff ${scenario.tariff.effective_usd_per_tonne} exceeds cap ${BASE * 1.25}`);
  });

  it('max-in-bounds cedi+diesel shift stays above the 75% floor (floor not reachable in normal range)', () => {
    // cedi_pct=+25 + diesel_pct=-30 gives multiplier ≈ 0.84, safely above 0.75 floor
    const { compose } = freshCompose();
    const result = compose({ cedi_pct: 25, diesel_pct: -30 }, NOW);
    assert.equal(result.scenario.tariff.clamped_at_floor, false,
      'max UI-bound combo should not clamp at floor');
    assert.ok(result.scenario.tariff.effective_usd_per_tonne >= 24.00 * 0.75,
      'effective tariff must remain above floor value');
  });
});

// ── DSCR sensitivity ──────────────────────────────────────────────

describe('sensitivity — DSCR under shift', () => {
  it('higher tariff (cedi weakening) improves DSCR', () => {
    const { compose } = freshCompose();
    const base = compose({}, NOW).baseline.current;
    const stressed = compose({ cedi_pct: -10 }, NOW).scenario.current;
    assert.ok(stressed > base,
      `stressed DSCR ${stressed} should exceed baseline ${base}`);
  });

  it('higher opex (opex_pct > 0) reduces DSCR', () => {
    const { compose } = freshCompose();
    const base = compose({}, NOW).baseline.current;
    const stressed = compose({ opex_pct: 20 }, NOW).scenario.current;
    assert.ok(stressed < base,
      `high-opex DSCR ${stressed} should be below baseline ${base}`);
  });

  it('opex reduction (opex_pct < 0) improves DSCR', () => {
    const { compose } = freshCompose();
    const base = compose({}, NOW).baseline.current;
    const improved = compose({ opex_pct: -5 }, NOW).scenario.current;
    assert.ok(improved > base,
      `reduced-opex DSCR ${improved} should exceed baseline ${base}`);
  });

  it('deltas.ebitda_usd is positive when tariff improves (cedi weaken)', () => {
    const { compose } = freshCompose();
    const { deltas } = compose({ cedi_pct: -10 }, NOW);
    assert.ok(deltas.ebitda_usd > 0, `ebitda delta should be positive`);
  });

  it('deltas.revenue_usd is positive when tariff rises', () => {
    const { compose } = freshCompose();
    const { deltas } = compose({ cedi_pct: -10 }, NOW);
    assert.ok(deltas.revenue_usd > 0);
  });

  it('deltas.opex_usd is positive when opex_pct increases (costs go up)', () => {
    const { compose } = freshCompose();
    const { deltas } = compose({ opex_pct: 20 }, NOW);
    assert.ok(deltas.opex_usd > 0);
  });

  it('baseline.verdict is always a string (PASS, WATCH, or BREACH)', () => {
    const { compose } = freshCompose();
    const { baseline } = compose({}, NOW);
    assert.ok(['PASS', 'WATCH', 'BREACH'].includes(baseline.verdict),
      `unexpected verdict: ${baseline.verdict}`);
  });
});

// ── Waterfall structure ───────────────────────────────────────────

describe('sensitivity — waterfall structure', () => {
  it('waterfall[0] type=start, step=null, label=Baseline', () => {
    const { compose } = freshCompose();
    const w = compose({}, NOW).waterfall[0];
    assert.equal(w.type,  'start');
    assert.equal(w.step,  null);
    assert.equal(w.label, 'Baseline');
  });

  it('waterfall[4] type=end, step=null, label=Scenario', () => {
    const { compose } = freshCompose();
    const w = compose({}, NOW).waterfall[4];
    assert.equal(w.type,  'end');
    assert.equal(w.step,  null);
    assert.equal(w.label, 'Scenario');
  });

  it('middle entries (1-3) have type=delta', () => {
    const { compose } = freshCompose();
    const wf = compose({}, NOW).waterfall;
    for (const w of wf.slice(1, 4)) {
      assert.equal(w.type, 'delta', `entry ${w.label} should be type delta`);
    }
  });

  it('waterfall[0].dscr equals baseline.current', () => {
    const { compose } = freshCompose();
    const { baseline, waterfall } = compose({ cedi_pct: -5, opex_pct: 3 }, NOW);
    assert.equal(waterfall[0].dscr, baseline.current);
  });

  it('waterfall[4].dscr equals scenario.current', () => {
    const { compose } = freshCompose();
    const { scenario, waterfall } = compose({ cedi_pct: -5, opex_pct: 3 }, NOW);
    assert.equal(waterfall[4].dscr, scenario.current);
  });

  it('waterfall delta steps sum to total DSCR change (rounding tolerance)', () => {
    const { compose } = freshCompose();
    const { waterfall, deltas } = compose({ cedi_pct: -10, diesel_pct: 5, opex_pct: 3 }, NOW);
    const deltaSum = waterfall.slice(1, 4).reduce((s, w) => s + (w.step ?? 0), 0);
    assert.ok(Math.abs(deltaSum - deltas.dscr) < 0.02,
      `waterfall steps sum ${deltaSum.toFixed(4)} ≠ total delta ${deltas.dscr}`);
  });
});

// ── PRESETS ───────────────────────────────────────────────────────

describe('sensitivity — PRESETS', () => {
  it('PRESETS is exported and is an array of 4', () => {
    const { PRESETS } = freshCompose();
    assert.ok(Array.isArray(PRESETS), 'PRESETS should be an array');
    assert.equal(PRESETS.length, 4);
  });

  it('PRESETS has ids: base, mild, moderate, severe', () => {
    const { PRESETS } = freshCompose();
    const ids = PRESETS.map((p) => p.id);
    assert.deepEqual(ids, ['base', 'mild', 'moderate', 'severe']);
  });

  it('base preset has all shifts = 0', () => {
    const { PRESETS } = freshCompose();
    const base = PRESETS.find((p) => p.id === 'base');
    assert.equal(base.cedi_pct,   0);
    assert.equal(base.diesel_pct, 0);
    assert.equal(base.opex_pct,   0);
  });

  it('each preset has required fields', () => {
    const { PRESETS } = freshCompose();
    for (const p of PRESETS) {
      for (const k of ['id', 'label', 'cedi_pct', 'diesel_pct', 'opex_pct', 'description']) {
        assert.ok(k in p, `preset ${p.id} missing field: ${k}`);
      }
    }
  });

  it('severe preset is more extreme than moderate (all shifts larger magnitude)', () => {
    const { PRESETS } = freshCompose();
    const moderate = PRESETS.find((p) => p.id === 'moderate');
    const severe   = PRESETS.find((p) => p.id === 'severe');
    assert.ok(Math.abs(severe.cedi_pct)   > Math.abs(moderate.cedi_pct));
    assert.ok(Math.abs(severe.diesel_pct) > Math.abs(moderate.diesel_pct));
    assert.ok(Math.abs(severe.opex_pct)   > Math.abs(moderate.opex_pct));
  });

  it('compose with preset inputs produces valid output for all presets', () => {
    const { compose, PRESETS } = freshCompose();
    for (const p of PRESETS) {
      // Should not throw and should return a waterfall with 5 entries
      const result = compose({ cedi_pct: p.cedi_pct, diesel_pct: p.diesel_pct, opex_pct: p.opex_pct }, NOW);
      assert.equal(result.waterfall.length, 5, `preset ${p.id} waterfall length != 5`);
    }
  });
});
