'use strict';

/*
 * Unit tests for services/indexation.js
 *
 * Contract constants (from aggregator.js + mock/tariff.js):
 *   base_tariff_usd_per_tonne = $24.00
 *   fuel weight 40%, CPI weight 30%, fixed weight 30%
 *   NPA_DIESEL: base 15.72 GHS/L, current 16.34 GHS/L
 *   GSS_CPI:    base 100.0, current 102.4
 *   pass_through floor 75%, cap 125%
 *
 * Expected for current values:
 *   fuelIndex  = 16.34/15.72 ≈ 1.03944
 *   cpiIndex   = 102.4/100.0 = 1.0240
 *   multiplier ≈ 0.40×1.03944 + 0.30×1.024 + 0.30 ≈ 1.02298  (not clamped)
 *   effective  = 24.00 × 1.02298 ≈ $24.55
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');
const {
  computeComponents,
  computeEffectiveRate,
  computeEffectiveRateHistory,
} = require('../services/indexation');

// ── computeComponents ─────────────────────────────────────────────────

describe('computeComponents', () => {
  it('returns exactly three components', () => {
    const cs = computeComponents();
    assert.equal(cs.length, 3);
  });

  it('components are keyed fuel / cpi / fixed in order', () => {
    const keys = computeComponents().map((c) => c.key);
    assert.deepEqual(keys, ['fuel', 'cpi', 'fixed']);
  });

  it('weights sum to 1.0', () => {
    const total = computeComponents().reduce((s, c) => s + c.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-9, `weights sum to ${total}, expected 1.0`);
  });

  it('each component has required fields', () => {
    for (const c of computeComponents()) {
      assert.ok('key'               in c, `${c.key}: missing key`);
      assert.ok('label'             in c, `${c.key}: missing label`);
      assert.ok('weight'            in c, `${c.key}: missing weight`);
      assert.ok('base_reading'      in c, `${c.key}: missing base_reading`);
      assert.ok('current_reading'   in c, `${c.key}: missing current_reading`);
      assert.ok('index_current'     in c, `${c.key}: missing index_current`);
      assert.ok('contribution_pct'  in c, `${c.key}: missing contribution_pct`);
    }
  });

  it('fuel index is current / base diesel price', () => {
    const fuel = computeComponents().find((c) => c.key === 'fuel');
    // 16.34 / 15.72 ≈ 1.0394
    assert.ok(Math.abs(fuel.index_current - 1.0394) < 0.0001,
      `fuel index ${fuel.index_current} expected ~1.0394`);
  });

  it('cpi index is current / base CPI', () => {
    const cpi = computeComponents().find((c) => c.key === 'cpi');
    // 102.4 / 100.0 = 1.0240
    assert.ok(Math.abs(cpi.index_current - 1.024) < 0.0001,
      `cpi index ${cpi.index_current} expected ~1.0240`);
  });

  it('fixed index is exactly 1.0', () => {
    const fixed = computeComponents().find((c) => c.key === 'fixed');
    assert.equal(fixed.index_current, 1.0);
  });

  it('contribution_pct values are numeric and positive', () => {
    for (const c of computeComponents()) {
      assert.equal(typeof c.contribution_pct, 'number');
      assert.ok(c.contribution_pct > 0, `${c.key}: contribution_pct should be > 0`);
    }
  });

  it('fuel contribution_pct ≈ 41.58 (0.40 × 1.0394 × 100)', () => {
    const fuel = computeComponents().find((c) => c.key === 'fuel');
    assert.ok(Math.abs(fuel.contribution_pct - 41.58) < 0.02,
      `fuel contribution ${fuel.contribution_pct} expected ~41.58`);
  });

  it('cpi contribution_pct ≈ 30.72 (0.30 × 1.024 × 100)', () => {
    const cpi = computeComponents().find((c) => c.key === 'cpi');
    assert.ok(Math.abs(cpi.contribution_pct - 30.72) < 0.01,
      `cpi contribution ${cpi.contribution_pct} expected ~30.72`);
  });

  it('fixed contribution_pct = 30.00 (0.30 × 1.0 × 100)', () => {
    const fixed = computeComponents().find((c) => c.key === 'fixed');
    assert.ok(Math.abs(fixed.contribution_pct - 30.00) < 0.01,
      `fixed contribution ${fixed.contribution_pct} expected 30.00`);
  });
});

// ── computeEffectiveRate ──────────────────────────────────────────────

describe('computeEffectiveRate', () => {
  it('returns an object with all required fields', () => {
    const r = computeEffectiveRate();
    for (const key of [
      'base_usd_per_tonne', 'effective_usd_per_tonne', 'adjustment_pct',
      'multiplier', 'clamped_at_cap', 'clamped_at_floor', 'components',
    ]) {
      assert.ok(key in r, `missing field: ${key}`);
    }
  });

  it('base rate is $24.00 per tonne', () => {
    assert.equal(computeEffectiveRate().base_usd_per_tonne, 24.00);
  });

  it('effective rate is $24.55 per tonne with current inputs', () => {
    const { effective_usd_per_tonne } = computeEffectiveRate();
    // 24.00 × ~1.02298 ≈ 24.55
    assert.ok(Math.abs(effective_usd_per_tonne - 24.55) < 0.02,
      `effective rate $${effective_usd_per_tonne} expected ~$24.55`);
  });

  it('adjustment_pct reflects positive indexation (≈ +2.30%)', () => {
    const { adjustment_pct } = computeEffectiveRate();
    assert.ok(adjustment_pct > 0, 'should be a positive adjustment');
    assert.ok(Math.abs(adjustment_pct - 2.30) < 0.05,
      `adjustment_pct ${adjustment_pct}% expected ~2.30%`);
  });

  it('multiplier is between floor (0.75) and cap (1.25) with current inputs', () => {
    const { multiplier } = computeEffectiveRate();
    assert.ok(multiplier > 0.75, `multiplier ${multiplier} below floor`);
    assert.ok(multiplier < 1.25, `multiplier ${multiplier} above cap`);
  });

  it('not clamped at cap or floor with current inputs', () => {
    const { clamped_at_cap, clamped_at_floor } = computeEffectiveRate();
    assert.equal(clamped_at_cap,   false);
    assert.equal(clamped_at_floor, false);
  });

  it('effective rate = base × multiplier (formula consistency)', () => {
    const { base_usd_per_tonne, effective_usd_per_tonne, multiplier } = computeEffectiveRate();
    const expected = Number((base_usd_per_tonne * multiplier).toFixed(2));
    assert.equal(effective_usd_per_tonne, expected);
  });

  it('adjustment_pct = (multiplier - 1) × 100 (formula consistency)', () => {
    const { multiplier, adjustment_pct } = computeEffectiveRate();
    const expected = Number(((multiplier - 1) * 100).toFixed(2));
    assert.equal(adjustment_pct, expected);
  });

  it('components array passes through from computeComponents()', () => {
    const r = computeEffectiveRate();
    assert.equal(r.components.length, 3);
    assert.equal(r.components[0].key, 'fuel');
  });
});

// ── computeEffectiveRateHistory ───────────────────────────────────────

describe('computeEffectiveRateHistory', () => {
  it('returns a non-empty array', () => {
    const h = computeEffectiveRateHistory();
    assert.ok(Array.isArray(h));
    assert.ok(h.length > 0, 'history should have at least one entry');
  });

  it('contains no null entries (filter(Boolean) applied)', () => {
    const h = computeEffectiveRateHistory();
    assert.ok(h.every((e) => e != null), 'null entry found in history');
  });

  it('entries are sorted chronologically (ascending month string)', () => {
    const months = computeEffectiveRateHistory().map((e) => e.month);
    for (let i = 1; i < months.length; i++) {
      assert.ok(months[i] > months[i - 1],
        `month out of order: ${months[i - 1]} → ${months[i]}`);
    }
  });

  it('each entry has all required fields', () => {
    for (const e of computeEffectiveRateHistory()) {
      for (const key of [
        'month', 'effective_usd_per_tonne', 'multiplier', 'adjustment_pct',
        'fuel_index', 'cpi_index', 'clamped_at_cap', 'clamped_at_floor',
      ]) {
        assert.ok(key in e, `entry ${e.month} missing field: ${key}`);
      }
    }
  });

  it('base month (2026-01) has multiplier = 1.0 and $0 adjustment', () => {
    const base = computeEffectiveRateHistory().find((e) => e.month === '2026-01');
    assert.ok(base, '2026-01 entry missing from history');
    // fuel_index = 15.72/15.72 = 1.0, cpi_index = 100.0/100.0 = 1.0
    assert.ok(Math.abs(base.multiplier - 1.0) < 0.0001,
      `base month multiplier ${base.multiplier} expected 1.0`);
    assert.ok(Math.abs(base.adjustment_pct - 0.0) < 0.01,
      `base month adjustment ${base.adjustment_pct}% expected 0.00%`);
    assert.equal(base.effective_usd_per_tonne, 24.00);
    assert.equal(base.clamped_at_cap,   false);
    assert.equal(base.clamped_at_floor, false);
  });

  it('latest month (2026-05) matches computeEffectiveRate() current values', () => {
    const latest  = computeEffectiveRateHistory().find((e) => e.month === '2026-05');
    const current = computeEffectiveRate();
    assert.ok(latest, '2026-05 entry missing from history');
    assert.equal(latest.effective_usd_per_tonne, current.effective_usd_per_tonne);
    assert.equal(latest.multiplier, current.multiplier);
  });

  it('effective_usd_per_tonne is within $0.01 of base × multiplier for every entry', () => {
    // effective is computed from full-precision clamped; stored multiplier is
    // already rounded to 4 dp — so up to ~$0.01 difference is expected.
    const base = 24.00;
    for (const e of computeEffectiveRateHistory()) {
      const approx = base * e.multiplier;
      assert.ok(Math.abs(e.effective_usd_per_tonne - approx) <= 0.01,
        `${e.month}: effective $${e.effective_usd_per_tonne} too far from base×multiplier $${approx.toFixed(4)}`);
    }
  });

  it('clamped flags are booleans on every entry', () => {
    for (const e of computeEffectiveRateHistory()) {
      assert.equal(typeof e.clamped_at_cap,   'boolean', `${e.month}: clamped_at_cap not boolean`);
      assert.equal(typeof e.clamped_at_floor, 'boolean', `${e.month}: clamped_at_floor not boolean`);
    }
  });
});
