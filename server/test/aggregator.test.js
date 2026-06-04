'use strict';

/*
 * Tests for services/aggregator.js
 *
 * All exported functions are pure — no DB, no stubs needed.
 *
 * Exports under test:
 *   fractionOfMonthElapsed(now)   — date math helper
 *   apiStatusOf(hauler)           — integration status classifier
 *   aggregate(haulers, now)       — corridor-level roll-up
 *   CONTRACT                      — tariff/contract constants
 *   TRANCHE_1                     — tranche constants
 *
 * Fixed test date: 2026-05-21T00:00:00Z
 *   May has 31 days.
 *   elapsed_days = 20 (days since May 1 00:00 UTC)
 *   fraction      = 20/31 ≈ 0.6452
 *
 * Single-hauler aggregate at this date (run_rate=1.0):
 *   monthlyTonnes = Math.round(1,000,000 / 12) = 83,333  (stored raw; ÷12 before rounding)
 *   contractedMtd = 83,333.33 × 1.0 × (20/31) ≈ 53,763
 *   deliveredMtd  = 53,763 × run_rate
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  fractionOfMonthElapsed,
  apiStatusOf,
  aggregate,
  CONTRACT,
  TRANCHE_1,
} = require('../services/aggregator');

// ── Fixtures ──────────────────────────────────────────────────────

const NOW = new Date('2026-05-21T00:00:00Z'); // day 21 of 31-day May

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
      type:            overrides.integration_type   ?? 'api',
      error_count_24h: overrides.error_count_24h    ?? 0,
    },
  };
}

// ── fractionOfMonthElapsed ────────────────────────────────────────

describe('aggregator — fractionOfMonthElapsed', () => {
  it('returns 0 at the very start of the month', () => {
    const f = fractionOfMonthElapsed(new Date('2026-05-01T00:00:00Z'));
    assert.equal(f, 0);
  });

  it('returns correct fraction at May 21 00:00 UTC (20/31)', () => {
    const f = fractionOfMonthElapsed(NOW);
    const expected = 20 / 31;
    assert.ok(Math.abs(f - expected) < 1e-9,
      `fraction ${f} expected ≈ ${expected}`);
  });

  it('returns ≈1 at the last moment of the month', () => {
    const f = fractionOfMonthElapsed(new Date('2026-05-31T23:59:59.999Z'));
    assert.ok(f > 0.999 && f <= 1.0, `fraction ${f} should be ≈1`);
  });

  it('clamps to 0 (Math.max guard) — value is never negative', () => {
    // Pass start of month exactly; should be 0, never negative
    const f = fractionOfMonthElapsed(new Date('2026-06-01T00:00:00Z'));
    assert.ok(f >= 0);
  });

  it('clamps to 1 (Math.min guard)', () => {
    // Can't normally exceed 1 within a month, but guard exists
    const f = fractionOfMonthElapsed(new Date('2026-02-28T23:59:59.999Z'));
    assert.ok(f <= 1.0);
  });

  it('handles February correctly (28 days in non-leap year)', () => {
    // 2026 is not a leap year
    const midFeb = new Date('2026-02-14T12:00:00Z'); // noon day 14
    const f = fractionOfMonthElapsed(midFeb);
    // elapsed ≈ 13.5 days out of 28
    assert.ok(f > 0.48 && f < 0.49, `February mid fraction ${f} expected ≈ 0.482`);
  });

  it('fraction is higher later in the same month', () => {
    const early = fractionOfMonthElapsed(new Date('2026-05-05T00:00:00Z'));
    const late  = fractionOfMonthElapsed(new Date('2026-05-25T00:00:00Z'));
    assert.ok(early < late);
  });
});

// ── apiStatusOf ───────────────────────────────────────────────────

describe('aggregator — apiStatusOf', () => {
  it('pending status → "pending" (checked first)', () => {
    const h = makeHauler('h1', { status: 'pending' });
    assert.equal(apiStatusOf(h), 'pending');
  });

  it('manual integration type → "manual"', () => {
    const h = makeHauler('h1', { integration_type: 'manual' });
    assert.equal(apiStatusOf(h), 'manual');
  });

  it('api integration with error_count_24h > 0 → "degraded"', () => {
    const h = makeHauler('h1', { error_count_24h: 3 });
    assert.equal(apiStatusOf(h), 'degraded');
  });

  it('api integration with no errors → "connected"', () => {
    const h = makeHauler('h1', { integration_type: 'api', error_count_24h: 0 });
    assert.equal(apiStatusOf(h), 'connected');
  });

  it('pending takes precedence over manual integration type', () => {
    const h = makeHauler('h1', { status: 'pending', integration_type: 'manual' });
    assert.equal(apiStatusOf(h), 'pending');
  });

  it('error_count_24h = 0 is treated as no error', () => {
    const h = makeHauler('h1', { error_count_24h: 0 });
    assert.equal(apiStatusOf(h), 'connected');
  });

  it('missing error_count_24h defaults to 0 (no error)', () => {
    const h = { ...makeHauler('h1') };
    delete h.integration.error_count_24h;
    assert.equal(apiStatusOf(h), 'connected');
  });
});

// ── aggregate — output shape ──────────────────────────────────────

describe('aggregator — aggregate output shape', () => {
  it('returns generated_at, fleet, tonnes, sla_attainment_pct, haulers', () => {
    const r = aggregate([makeHauler('h1')], NOW);
    for (const k of ['generated_at', 'fleet', 'tonnes', 'sla_attainment_pct', 'haulers']) {
      assert.ok(k in r, `missing key: ${k}`);
    }
  });

  it('fleet has contracted_trucks and active_trucks', () => {
    const r = aggregate([makeHauler('h1')], NOW);
    assert.ok('contracted_trucks' in r.fleet);
    assert.ok('active_trucks'     in r.fleet);
  });

  it('tonnes has delivered_mtd, contracted_mtd, contracted_monthly', () => {
    const r = aggregate([makeHauler('h1')], NOW);
    assert.ok('delivered_mtd'      in r.tonnes);
    assert.ok('contracted_mtd'     in r.tonnes);
    assert.ok('contracted_monthly' in r.tonnes);
  });

  it('each hauler entry has required fields', () => {
    const r = aggregate([makeHauler('h1')], NOW);
    const h = r.haulers[0];
    for (const k of ['id', 'display_name', 'status', 'fleet', 'performance',
                      'contract_share', 'tonnes_delivered_mtd', 'tonnes_contracted_mtd']) {
      assert.ok(k in h, `hauler entry missing: ${k}`);
    }
  });

  it('empty roster returns zeros and empty hauler list', () => {
    const r = aggregate([], NOW);
    assert.equal(r.fleet.contracted_trucks, 0);
    assert.equal(r.fleet.active_trucks,     0);
    assert.equal(r.tonnes.delivered_mtd,    0);
    assert.equal(r.tonnes.contracted_mtd,   0);
    assert.equal(r.haulers.length,          0);
    assert.equal(r.sla_attainment_pct,      0);
  });
});

// ── aggregate — fleet counts ──────────────────────────────────────

describe('aggregator — fleet counts', () => {
  it('fleet.contracted_trucks sums only active hauler contracted trucks', () => {
    const haulers = [
      makeHauler('h1', { contracted_trucks: 8,  status: 'active' }),
      makeHauler('h2', { contracted_trucks: 12, status: 'active' }),
      makeHauler('h3', { contracted_trucks: 5,  status: 'pending' }), // inactive
    ];
    const r = aggregate(haulers, NOW);
    assert.equal(r.fleet.contracted_trucks, 20); // 8 + 12 only
  });

  it('fleet.active_trucks sums only active hauler active trucks', () => {
    const haulers = [
      makeHauler('h1', { active_trucks: 7,  status: 'active' }),
      makeHauler('h2', { active_trucks: 6,  status: 'active' }),
      makeHauler('h3', { active_trucks: 3,  status: 'inactive' }),
    ];
    const r = aggregate(haulers, NOW);
    assert.equal(r.fleet.active_trucks, 13); // 7 + 6 only
  });

  it('tonnes.contracted_monthly = Math.round(1,000,000 / 12) = 83,333', () => {
    const r = aggregate([makeHauler('h1')], NOW);
    assert.equal(r.tonnes.contracted_monthly, 83_333);
  });
});

// ── aggregate — tonnage math ──────────────────────────────────────

describe('aggregator — tonnage math', () => {
  it('single active hauler run_rate=1.0: delivered ≈ contracted MTD', () => {
    const r = aggregate([makeHauler('h1', { run_rate: 1.0 })], NOW);
    assert.equal(r.tonnes.delivered_mtd, r.tonnes.contracted_mtd);
  });

  it('single hauler run_rate=0.8: delivered = 80% of contracted MTD (±1 rounding)', () => {
    const r = aggregate([makeHauler('h1', { run_rate: 0.8 })], NOW);
    const expected = Math.round(r.tonnes.contracted_mtd * 0.8);
    assert.ok(Math.abs(r.tonnes.delivered_mtd - expected) <= 1,
      `delivered ${r.tonnes.delivered_mtd} should be ≈ ${expected}`);
  });

  it('run_rate=0 gives zero delivered tonnes', () => {
    const r = aggregate([makeHauler('h1', { run_rate: 0 })], NOW);
    assert.equal(r.tonnes.delivered_mtd, 0);
  });

  it('at start of month (fraction=0), all MTD values are zero', () => {
    const r = aggregate([makeHauler('h1')], new Date('2026-05-01T00:00:00Z'));
    assert.equal(r.tonnes.delivered_mtd,  0);
    assert.equal(r.tonnes.contracted_mtd, 0);
  });

  it('total delivered_mtd = sum of individual hauler delivered values', () => {
    const haulers = [
      makeHauler('h1', { run_rate: 1.0, contracted_trucks: 6 }),
      makeHauler('h2', { run_rate: 0.8, contracted_trucks: 4 }),
    ];
    const r = aggregate(haulers, NOW);
    const sum = r.haulers
      .filter((h) => h.status === 'active')
      .reduce((s, h) => s + h.tonnes_delivered_mtd, 0);
    assert.equal(r.tonnes.delivered_mtd, sum);
  });
});

// ── aggregate — contract share ────────────────────────────────────

describe('aggregator — contract share', () => {
  it('single active hauler has contract_share = 1.000', () => {
    const r = aggregate([makeHauler('h1', { contracted_trucks: 10 })], NOW);
    assert.equal(r.haulers[0].contract_share, 1.000);
  });

  it('two equal haulers each have contract_share = 0.500', () => {
    const r = aggregate([
      makeHauler('h1', { contracted_trucks: 10 }),
      makeHauler('h2', { contracted_trucks: 10 }),
    ], NOW);
    assert.equal(r.haulers[0].contract_share, 0.500);
    assert.equal(r.haulers[1].contract_share, 0.500);
  });

  it('contract shares sum to 1.000 for active haulers (rounding tolerance)', () => {
    const r = aggregate([
      makeHauler('h1', { contracted_trucks: 6 }),
      makeHauler('h2', { contracted_trucks: 4 }),
    ], NOW);
    const sum = r.haulers.reduce((s, h) => s + h.contract_share, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `shares sum to ${sum} expected 1.0`);
  });

  it('inactive hauler has contract_share = 0', () => {
    const r = aggregate([makeHauler('h1', { status: 'pending' })], NOW);
    assert.equal(r.haulers[0].contract_share, 0);
  });

  it('inactive hauler has tonnes_delivered_mtd = 0 and tonnes_contracted_mtd = 0', () => {
    const r = aggregate([makeHauler('h1', { status: 'inactive' })], NOW);
    assert.equal(r.haulers[0].tonnes_delivered_mtd,  0);
    assert.equal(r.haulers[0].tonnes_contracted_mtd, 0);
  });
});

// ── aggregate — SLA attainment ────────────────────────────────────

describe('aggregator — SLA attainment', () => {
  it('single hauler: sla_attainment_pct = hauler sla_attainment_pct', () => {
    const r = aggregate([makeHauler('h1', { sla_attainment_pct: 92 })], NOW);
    assert.equal(r.sla_attainment_pct, 92.0);
  });

  it('weighted by active_trucks: higher-truck hauler dominates', () => {
    const haulers = [
      makeHauler('h1', { sla_attainment_pct: 90, active_trucks: 8 }),
      makeHauler('h2', { sla_attainment_pct: 70, active_trucks: 2 }),
    ];
    const r = aggregate(haulers, NOW);
    // Weighted: (90*8 + 70*2) / 10 = (720 + 140) / 10 = 86.0
    assert.equal(r.sla_attainment_pct, 86.0);
  });

  it('zero active_trucks gives 0 SLA (no division by zero)', () => {
    const r = aggregate([makeHauler('h1', { active_trucks: 0 })], NOW);
    assert.equal(r.sla_attainment_pct, 0);
  });

  it('inactive haulers are excluded from SLA average', () => {
    const haulers = [
      makeHauler('h1', { sla_attainment_pct: 95, active_trucks: 10, status: 'active' }),
      makeHauler('h2', { sla_attainment_pct: 50, active_trucks:  0, status: 'pending' }),
    ];
    const r = aggregate(haulers, NOW);
    assert.equal(r.sla_attainment_pct, 95.0); // inactive excluded
  });
});

// ── aggregate — hauler ordering ───────────────────────────────────

describe('aggregator — hauler ordering', () => {
  it('active haulers appear before inactive in the haulers array', () => {
    const r = aggregate([
      makeHauler('h1', { status: 'pending' }), // inactive first in input
      makeHauler('h2', { status: 'active' }),  // active second in input
    ], NOW);
    assert.equal(r.haulers[0].id, 'h2'); // active comes first in output
    assert.equal(r.haulers[1].id, 'h1');
  });

  it('api_status propagated correctly on hauler entries', () => {
    const r = aggregate([
      makeHauler('h1', { integration_type: 'manual' }),
    ], NOW);
    assert.equal(r.haulers[0].api_status, 'manual');
  });
});

// ── CONTRACT and TRANCHE_1 constants ─────────────────────────────

describe('aggregator — exported constants', () => {
  it('CONTRACT has all required tariff fields', () => {
    for (const k of ['target_mtpa', 'take_or_pay_floor_pct', 'base_tariff_usd_per_tonne',
                      'corridor_km', 'indexation', 'payment_terms_days']) {
      assert.ok(k in CONTRACT, `CONTRACT missing: ${k}`);
    }
  });

  it('CONTRACT.target_mtpa = 1.0', () => {
    assert.equal(CONTRACT.target_mtpa, 1.0);
  });

  it('CONTRACT.take_or_pay_floor_pct = 0.80', () => {
    assert.equal(CONTRACT.take_or_pay_floor_pct, 0.80);
  });

  it('CONTRACT.base_tariff_usd_per_tonne = 24.00', () => {
    assert.equal(CONTRACT.base_tariff_usd_per_tonne, 24.00);
  });

  it('CONTRACT.indexation weights sum to 1.0', () => {
    const { fuel_pct_of_tariff, cpi_pct_of_tariff, fixed_pct_of_tariff } = CONTRACT.indexation;
    assert.ok(Math.abs(fuel_pct_of_tariff + cpi_pct_of_tariff + fixed_pct_of_tariff - 1.0) < 1e-9);
  });

  it('TRANCHE_1.target_mtpa matches CONTRACT.target_mtpa', () => {
    assert.equal(TRANCHE_1.target_mtpa, CONTRACT.target_mtpa);
  });
});
