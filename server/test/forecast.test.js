'use strict';

/*
 * Tests for services/forecast.js — buildForecast() and buildForecastScenario()
 *
 * aggregate() is pure (takes haulers array directly) so no stub needed.
 * workorderState.allOpen() is stubbed via require.cache.
 *
 * Fixed test date: 2026-05-21T00:00:00Z
 *   May has 31 days.
 *   daysElapsed   = 21 (getUTCDate)
 *   daysRemaining = 10
 *   fractionOfMonthElapsed = 20/31 ≈ 0.6452 (elapsed_days since month start)
 *
 * Contract constants (from aggregator.js):
 *   target_mtpa            = 1.0
 *   take_or_pay_floor_pct  = 0.80
 *   monthlyTarget          = Math.round(1,000,000 / 12)   = 83,333
 *   floorTarget            = Math.round(83,333.33 × 0.80) = 66,667
 *
 * Run-rate verdicts for 1-hauler corridor (derived below):
 *   run_rate 1.1 → delivered ≈ 59,140, projected ≈ 87,302 → on_pace_for_contracted
 *   run_rate 1.0 → delivered ≈ 53,763, projected ≈ 79,364 → above_floor
 *   run_rate 0.8 → delivered ≈ 43,011, projected ≈ 63,492 → below_floor_at_pace
 *
 * Note: 'banked_floor_drift' verdict requires projectedEom < floorTarget
 * AND deliveredMtd >= floorTarget. Given projectedEom ≥ deliveredMtd always
 * (positive daysRemaining), this branch is mathematically unreachable in
 * normal operation and is not tested.
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Constants ─────────────────────────────────────────────────────

const NOW      = new Date('2026-05-21T00:00:00Z'); // day 21 of 31
const LAST_DAY = new Date('2026-05-31T00:00:00Z'); // day 31, daysRemaining=0

const MONTHLY_TARGET = 83_333;
const FLOOR_TARGET   = 66_667;

// ── Fixtures ──────────────────────────────────────────────────────

function makeHauler(id, overrides = {}) {
  return {
    id,
    display_name:   `Hauler ${id}`,
    status:         overrides.status ?? 'active',
    onboarded_date: '2026-01-01',
    run_rate:       overrides.run_rate ?? 1.0,
    fleet: {
      contracted_trucks: overrides.contracted_trucks ?? 10,
      active_trucks:     overrides.active_trucks     ?? 10,
    },
    performance: { sla_attainment_pct: overrides.sla_attainment_pct ?? 95 },
    integration: {
      type:              overrides.integration_type ?? 'api',
      error_count_24h:   overrides.error_count_24h  ?? 0,
    },
  };
}

// ── Stub helpers ──────────────────────────────────────────────────

function stubWorkorders(list = []) {
  require.cache[require.resolve('../state/workorderState')] = {
    id:       require.resolve('../state/workorderState'),
    filename: require.resolve('../state/workorderState'),
    loaded:   true,
    exports:  { allOpen: () => list },
  };
}

function freshForecast() {
  delete require.cache[require.resolve('../services/forecast')];
  return require('../services/forecast');
}

before(() => stubWorkorders([]));   // default: no open workorders

after(() => {
  for (const p of [
    '../services/forecast',
    '../state/workorderState',
  ]) delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────

describe('forecast — buildForecast output shape', () => {
  it('returns all required top-level keys', () => {
    const { buildForecast } = freshForecast();
    const result = buildForecast([makeHauler('h1')], NOW);
    for (const k of ['generated_at', 'horizon', 'targets', 'actual',
                      'projection', 'required', 'levers', 'haulers', 'workshop_drag']) {
      assert.ok(k in result, `missing key: ${k}`);
    }
  });

  it('horizon fields are correct for May 21', () => {
    const { buildForecast } = freshForecast();
    const { horizon } = buildForecast([makeHauler('h1')], NOW);
    assert.equal(horizon.days_in_month,  31);
    assert.equal(horizon.days_elapsed,   21);
    assert.equal(horizon.days_remaining, 10);
  });

  it('targets carries contract constants', () => {
    const { buildForecast } = freshForecast();
    const { targets } = buildForecast([makeHauler('h1')], NOW);
    assert.equal(targets.monthly,   MONTHLY_TARGET);
    assert.equal(targets.floor,     FLOOR_TARGET);
    assert.equal(targets.floor_pct, 0.80);
  });

  it('projection has required fields', () => {
    const { buildForecast } = freshForecast();
    const { projection } = buildForecast([makeHauler('h1')], NOW);
    for (const k of ['eom_tonnes', 'pct_of_monthly', 'pct_of_floor',
                      'shortfall_to_floor', 'shortfall_to_contracted',
                      'surplus_over_floor', 'verdict']) {
      assert.ok(k in projection, `projection missing: ${k}`);
    }
  });

  it('required has daily_to_floor, daily_to_contracted, lift_pct_to_floor', () => {
    const { buildForecast } = freshForecast();
    const { required } = buildForecast([makeHauler('h1')], NOW);
    assert.ok('daily_to_floor'      in required);
    assert.ok('daily_to_contracted' in required);
    assert.ok('lift_pct_to_floor'   in required);
  });
});

// ── Verdict system ────────────────────────────────────────────────

describe('forecast — verdict system', () => {
  it('run_rate 1.1 → on_pace_for_contracted (projected ≥ 83,333)', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.1 })], NOW);
    assert.equal(f.projection.verdict, 'on_pace_for_contracted');
    assert.ok(f.projection.eom_tonnes >= MONTHLY_TARGET,
      `projected ${f.projection.eom_tonnes} should be ≥ ${MONTHLY_TARGET}`);
  });

  it('run_rate 1.0 → above_floor (projected ≥ 66,667 but < 83,333)', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.0 })], NOW);
    assert.equal(f.projection.verdict, 'above_floor');
    assert.ok(f.projection.eom_tonnes >= FLOOR_TARGET);
    assert.ok(f.projection.eom_tonnes < MONTHLY_TARGET);
  });

  it('run_rate 0.8 → below_floor_at_pace (projected < 66,667)', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 0.8 })], NOW);
    assert.equal(f.projection.verdict, 'below_floor_at_pace');
    assert.ok(f.projection.eom_tonnes < FLOOR_TARGET);
  });

  it('empty hauler roster → below_floor_at_pace with 0 delivered', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([], NOW);
    assert.equal(f.projection.verdict, 'below_floor_at_pace');
    assert.equal(f.actual.delivered_mtd, 0);
    assert.equal(f.projection.eom_tonnes, 0);
  });

  it('on_pace: shortfall_to_contracted = 0, surplus_over_floor > 0', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.1 })], NOW);
    assert.equal(f.projection.shortfall_to_contracted, 0);
    assert.ok(f.projection.surplus_over_floor > 0);
  });

  it('below_floor: shortfall_to_floor > 0, surplus_over_floor = 0', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 0.8 })], NOW);
    assert.ok(f.projection.shortfall_to_floor > 0);
    assert.equal(f.projection.surplus_over_floor, 0);
  });
});

// ── Projection math ───────────────────────────────────────────────

describe('forecast — projection math', () => {
  it('projectedEom = Math.round(deliveredMtd + (deliveredMtd/daysElapsed) × daysRemaining)', () => {
    // Use the raw ratio (not the pre-rounded daily_avg) to match the code's formula exactly.
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.0 })], NOW);
    const { delivered_mtd } = f.actual;
    const { days_elapsed, days_remaining } = f.horizon;
    const expected = Math.round(delivered_mtd + (delivered_mtd / days_elapsed) * days_remaining);
    assert.equal(f.projection.eom_tonnes, expected);
  });

  it('on last day of month, projectedEom equals deliveredMtd (daysRemaining=0)', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.0 })], LAST_DAY);
    assert.equal(f.horizon.days_remaining, 0);
    assert.equal(f.projection.eom_tonnes, f.actual.delivered_mtd);
  });

  it('daysElapsed is at least 1 (first of month guard)', () => {
    const { buildForecast } = freshForecast();
    const firstOfMonth = new Date('2026-05-01T00:00:00Z');
    const f = buildForecast([makeHauler('h1')], firstOfMonth);
    assert.ok(f.horizon.days_elapsed >= 1);
  });

  it('pct_of_floor = (projectedEom / floorTarget) × 100', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.0 })], NOW);
    const expected = Number(((f.projection.eom_tonnes / FLOOR_TARGET) * 100).toFixed(1));
    assert.equal(f.projection.pct_of_floor, expected);
  });

  it('actual.pct_of_monthly = (deliveredMtd / monthlyTarget) × 100', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1')], NOW);
    const expected = Number(((f.actual.delivered_mtd / MONTHLY_TARGET) * 100).toFixed(1));
    assert.equal(f.actual.pct_of_monthly, expected);
  });
});

// ── Required rates ────────────────────────────────────────────────

describe('forecast — required daily rates', () => {
  it('below_floor: daily_to_floor > daily_avg (need to lift pace)', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 0.8 })], NOW);
    assert.ok(f.required.daily_to_floor > f.actual.daily_avg,
      'required daily exceeds current daily when below floor');
  });

  it('daily_to_floor = 0 when deliveredMtd already exceeds floor (run_rate 1.3)', () => {
    // requiredDailyToFloor = max(0, (floor - deliveredMtd) / daysRemaining)
    // run_rate 1.3 → deliveredMtd ≈ 69,892 > 66,667 → result is 0
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.3 })], NOW);
    assert.ok(f.actual.delivered_mtd > FLOOR_TARGET,
      `delivered ${f.actual.delivered_mtd} must exceed floor ${FLOOR_TARGET}`);
    assert.equal(f.required.daily_to_floor, 0);
  });

  it('daily_to_contracted = 0 when deliveredMtd already exceeds monthly target (run_rate 1.6)', () => {
    // run_rate 1.6 → deliveredMtd ≈ 86,021 > 83,333 → result is 0
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.6 })], NOW);
    assert.ok(f.actual.delivered_mtd > MONTHLY_TARGET,
      `delivered ${f.actual.delivered_mtd} must exceed target ${MONTHLY_TARGET}`);
    assert.equal(f.required.daily_to_contracted, 0);
  });

  it('lift_pct_to_floor = ((daily_to_floor − daily_avg) / daily_avg) × 100', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 0.8 })], NOW);
    const expected = Number((((f.required.daily_to_floor - f.actual.daily_avg) / f.actual.daily_avg) * 100).toFixed(1));
    assert.equal(f.required.lift_pct_to_floor, expected);
  });

  it('lift_pct_to_floor is null when daily_avg is 0', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([], NOW); // no haulers → daily_avg=0
    assert.equal(f.required.lift_pct_to_floor, null);
  });
});

// ── Levers (idle trucks) ──────────────────────────────────────────

describe('forecast — levers', () => {
  it('hauler with all trucks active has no lever entry', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { contracted_trucks: 10, active_trucks: 10 })], NOW);
    assert.equal(f.levers.by_hauler.length, 0);
  });

  it('hauler with idle trucks appears in levers.by_hauler', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { contracted_trucks: 10, active_trucks: 5 })], NOW);
    assert.equal(f.levers.by_hauler.length, 1);
    assert.equal(f.levers.by_hauler[0].hauler_id, 'h1');
    assert.equal(f.levers.by_hauler[0].idle_trucks, 5);
  });

  it('levers.by_hauler entry has remainder_recovery > 0 when days remain', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { contracted_trucks: 10, active_trucks: 5 })], NOW);
    assert.ok(f.levers.by_hauler[0].remainder_recovery > 0);
  });

  it('total_remainder_recovery_if_all_active = sum of lever by_hauler entries', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([
      makeHauler('h1', { contracted_trucks: 10, active_trucks: 7 }),
      makeHauler('h2', { contracted_trucks: 10, active_trucks: 6 }),
    ], NOW);
    const sum = f.levers.by_hauler.reduce((s, l) => s + l.remainder_recovery, 0);
    assert.equal(f.levers.total_remainder_recovery_if_all_active, sum);
  });
});

// ── Workshop drag ─────────────────────────────────────────────────

describe('forecast — workshop_drag', () => {
  it('zero open workorders → open_count=0, total_drag=0', () => {
    stubWorkorders([]);
    const { buildForecast } = freshForecast();
    const { workshop_drag } = buildForecast([makeHauler('h1')], NOW);
    assert.equal(workshop_drag.open_count, 0);
    assert.equal(workshop_drag.total_drag, 0);
    assert.equal(workshop_drag.by_workorder.length, 0);
  });

  it('open workorder adds drag entry with required fields', () => {
    stubWorkorders([{
      id: 'wo-1', rig_id: 'rig-1', hauler_id: 'h1', title: 'Engine repair',
      status: 'open', opened_at: new Date('2026-05-11T00:00:00Z').toISOString(),
    }]);
    const { buildForecast } = freshForecast();
    const { workshop_drag } = buildForecast([makeHauler('h1')], NOW);
    assert.equal(workshop_drag.open_count, 1);
    const wo = workshop_drag.by_workorder[0];
    for (const k of ['workorder_id', 'rig_id', 'hauler_id', 'days_open',
                      'days_lost', 'lost_so_far', 'remainder_drag', 'total_drag']) {
      assert.ok(k in wo, `workorder drag entry missing: ${k}`);
    }
    assert.ok(wo.days_open >= 10, `opened May 11, should be ≥10 days open`);
    assert.equal(wo.total_drag, wo.lost_so_far + wo.remainder_drag);
    // Restore
    stubWorkorders([]);
  });

  it('pct_of_floor_gap is null when projectedEom ≥ floor', () => {
    stubWorkorders([]);
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { run_rate: 1.0 })], NOW); // above_floor
    assert.equal(f.workshop_drag.pct_of_floor_gap, null);
  });
});

// ── Hauler projections ────────────────────────────────────────────

describe('forecast — hauler projections', () => {
  it('inactive hauler has verdict=inactive and zeros', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([makeHauler('h1', { status: 'pending' })], NOW);
    const hp = f.haulers.find((h) => h.hauler_id === 'h1');
    assert.equal(hp.verdict, 'inactive');
    assert.equal(hp.projected_eom, 0);
    assert.equal(hp.delivered_mtd, 0);
  });

  it('hauler projections sorted worst-first (ascending projected_pct_contracted)', () => {
    const { buildForecast } = freshForecast();
    const f = buildForecast([
      makeHauler('h1', { run_rate: 0.8 }), // lagging
      makeHauler('h2', { run_rate: 1.1 }), // on_pace
    ], NOW);
    assert.ok(
      f.haulers[0].projected_pct_contracted <= f.haulers[1].projected_pct_contracted,
      'lagging hauler should sort first',
    );
  });

  it('per-hauler verdict thresholds: ≥100%=on_pace, ≥90%=drift, ≥75%=lagging, <75%=severely_lagging', () => {
    // Single hauler at various run rates
    const { buildForecast } = freshForecast();
    // run_rate 1.1 → pct ≈ 110% → on_pace
    const hp1 = buildForecast([makeHauler('h1', { run_rate: 1.1 })], NOW).haulers[0];
    assert.equal(hp1.verdict, 'on_pace');
    // run_rate 0.8 → pct ≈ 80% → lagging (≥75, <90)
    const hp2 = buildForecast([makeHauler('h1', { run_rate: 0.8 })], NOW).haulers[0];
    assert.equal(hp2.verdict, 'lagging');
    // run_rate 0.6 → pct ≈ 60% → severely_lagging
    const hp3 = buildForecast([makeHauler('h1', { run_rate: 0.6 })], NOW).haulers[0];
    assert.equal(hp3.verdict, 'severely_lagging');
  });
});

// ── buildForecastScenario ─────────────────────────────────────────

describe('forecast — buildForecastScenario', () => {
  it('no scenario inputs → scenario.projection within 1 tonne of baseline (rounding path differs)', () => {
    // buildForecast uses raw dailyActual; scenario planner uses Math.round(daily_avg).
    // These can differ by 1 tonne. Both should agree within that tolerance.
    const { buildForecastScenario } = freshForecast();
    const result = buildForecastScenario([makeHauler('h1', { run_rate: 0.8 })], {}, NOW);
    const diff = Math.abs(result.scenario.projection.eom_tonnes - result.projection.eom_tonnes);
    assert.ok(diff <= 1,
      `scenario ${result.scenario.projection.eom_tonnes} should be within 1t of baseline ${result.projection.eom_tonnes}`);
    assert.ok(Math.abs(result.scenario.delta.eom_tonnes) <= 1,
      `delta should be ≤1 with no scenario inputs`);
  });

  it('truck lift → scenario projectedEom exceeds baseline', () => {
    const { buildForecastScenario } = freshForecast();
    const result = buildForecastScenario(
      [makeHauler('h1', { run_rate: 0.8, contracted_trucks: 10, active_trucks: 5 })],
      { hauler_truck_lifts: { 'h1': 5 } },
      NOW,
    );
    assert.ok(result.scenario.projection.eom_tonnes > result.projection.eom_tonnes,
      'truck lift should increase projectedEom');
    assert.ok(result.scenario.delta.eom_tonnes > 0);
  });

  it('truck lift capped at idle_trucks (cannot exceed available idle)', () => {
    const { buildForecastScenario } = freshForecast();
    // 5 idle trucks, request 20 → only 5 granted
    const result = buildForecastScenario(
      [makeHauler('h1', { run_rate: 0.8, contracted_trucks: 10, active_trucks: 5 })],
      { hauler_truck_lifts: { 'h1': 20 } }, // request 20, only 5 idle
      NOW,
    );
    const granted = result.scenario.totals.from_truck_lifts;
    assert.ok(granted <= 5, `granted ${granted} should not exceed 5 idle trucks`);
  });

  it('daily_avg_lift_pct improves projection proportionally', () => {
    const { buildForecastScenario } = freshForecast();
    const result = buildForecastScenario(
      [makeHauler('h1', { run_rate: 0.8 })],
      { daily_avg_lift_pct: 10 },
      NOW,
    );
    assert.ok(result.scenario.projection.eom_tonnes > result.projection.eom_tonnes);
    assert.ok(result.scenario.delta.eom_tonnes > 0);
  });

  it('delta.clears_floor is true when baseline is below_floor and scenario lifts above', () => {
    const { buildForecastScenario } = freshForecast();
    // Run rate 0.8 → baseline is below_floor_at_pace
    // Adding 5 idle trucks + 10% pace lift should cross floor
    const result = buildForecastScenario(
      [makeHauler('h1', { run_rate: 0.8, contracted_trucks: 10, active_trucks: 5 })],
      { hauler_truck_lifts: { 'h1': 5 }, daily_avg_lift_pct: 10 },
      NOW,
    );
    if (result.scenario.projection.verdict !== 'below_floor_at_pace') {
      assert.equal(result.scenario.delta.clears_floor, true,
        'crossing the floor should set delta.clears_floor=true');
    }
  });

  it('scenario.applied echoes the scenario inputs', () => {
    const { buildForecastScenario } = freshForecast();
    const result = buildForecastScenario(
      [makeHauler('h1', { run_rate: 0.8 })],
      { daily_avg_lift_pct: 5 },
      NOW,
    );
    assert.equal(result.scenario.applied.daily_avg_lift_pct, 5);
  });

  it('daily_avg_lift_pct clamped at 50 (no more than 50% pace lift)', () => {
    const { buildForecastScenario } = freshForecast();
    const result = buildForecastScenario(
      [makeHauler('h1')],
      { daily_avg_lift_pct: 999 },
      NOW,
    );
    assert.equal(result.scenario.applied.daily_avg_lift_pct, 50);
  });
});
