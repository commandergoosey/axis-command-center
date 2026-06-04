'use strict';

/*
 * Tests for services/dieselWatch.js — compose()
 *
 * compose() is a pure read-side composition over:
 *   - NPA_DIESEL, GSS_CPI, TARIFF_TERMS (mock/tariff — loaded from disk)
 *   - CONTRACT (aggregator — pure constants)
 *   - indexation.computeComponents(), indexation.computeEffectiveRate()
 *     (services/indexation — depends only on aggregator + mock/tariff)
 *   - TRIPS (mock/trips — loaded from disk)
 *   - roster.find(id)  ← only state dependency; stubbed here
 *
 * No injectable now — compose() uses new Date() only for generated_at.
 * All assertions are structural / invariant rather than date-pinned.
 *
 * Output sections:
 *   generated_at, base_month, base_ghs_per_l, current_month,
 *   current_ghs_per_l, series, summary, pass_through, pending_review,
 *   fleet_burn, notes
 *
 * summary:  latest_change_pct, trailing_3m_pct, trailing_12m_pct,
 *           vs_base_pct, fuel_index, fuel_contribution_pct
 *
 * pass_through: cap_pct, floor_pct, multiplier, clamped_at_cap,
 *               clamped_at_floor, headroom_pct_points
 *
 * pending_review: review_date, base_usd_per_tonne,
 *                 would_effective_usd_per_tonne, would_delta_pct
 *
 * fleet_burn: corridor_avg_fuel_usd_per_tonne,
 *             corridor_total_fuel_usd, corridor_total_tons,
 *             laden_trips_n, per_hauler
 *
 * per_hauler entries: hauler_id, display_name, trips_n, tons,
 *                     fuel_usd, fuel_usd_per_tonne, vs_corridor_pct, signal
 *   signal: 'better' | 'flat' | 'worse'
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub helper ───────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id:       require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded:   true,
    exports,
  };
}

// Minimal roster stub — dieselWatch calls roster.find(hauler_id)
// for display_name; fallback is hauler_id itself.
const MOCK_HAULER_NAMES = {
  'haul-01': 'Hauler One',
  'haul-02': 'Hauler Two',
  'haul-03': 'Hauler Three',
  'haul-04': 'Hauler Four',
  'haul-05': 'Hauler Five',
};

function freshCompose() {
  stub('../state/roster', {
    find: (id) => MOCK_HAULER_NAMES[id] ? { display_name: MOCK_HAULER_NAMES[id] } : null,
    list: () => [],
  });
  delete require.cache[require.resolve('../services/dieselWatch')];
  return require('../services/dieselWatch').compose;
}

after(() => {
  for (const p of ['../services/dieselWatch', '../state/roster'])
    delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────

describe('dieselWatch — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose();
    const r = compose();
    for (const k of ['generated_at', 'base_month', 'base_ghs_per_l', 'current_month',
                      'current_ghs_per_l', 'series', 'summary', 'pass_through',
                      'pending_review', 'fleet_burn', 'notes']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('generated_at is a valid ISO timestamp', () => {
    const compose = freshCompose();
    const { generated_at } = compose();
    assert.ok(!isNaN(new Date(generated_at).getTime()),
      `generated_at "${generated_at}" is not a valid date`);
  });

  it('series is a non-empty array sorted ascending by month', () => {
    const compose = freshCompose();
    const { series } = compose();
    assert.ok(Array.isArray(series) && series.length > 0);
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i].month >= series[i - 1].month,
        `series not sorted: ${series[i - 1].month} after ${series[i].month}`);
    }
  });

  it('current_ghs_per_l equals the last entry in series', () => {
    const compose = freshCompose();
    const r = compose();
    const last = r.series[r.series.length - 1];
    assert.equal(r.current_ghs_per_l, last.ghs_per_l);
  });

  it('current_month equals the last series entry month', () => {
    const compose = freshCompose();
    const r = compose();
    const last = r.series[r.series.length - 1];
    assert.equal(r.current_month, last.month);
  });
});

// ── Summary block ─────────────────────────────────────────────────

describe('dieselWatch — summary', () => {
  it('summary has all required fields', () => {
    const compose = freshCompose();
    const { summary } = compose();
    for (const k of ['latest_change_pct', 'trailing_3m_pct', 'trailing_12m_pct',
                      'vs_base_pct', 'fuel_index', 'fuel_contribution_pct']) {
      assert.ok(k in summary, `summary missing field: ${k}`);
    }
  });

  it('latest_change_pct is a number (2dp rounded)', () => {
    const compose = freshCompose();
    const { latest_change_pct } = compose().summary;
    assert.equal(typeof latest_change_pct, 'number');
    assert.equal(latest_change_pct, Number(latest_change_pct.toFixed(2)));
  });

  it('trailing_3m_pct is null or a 2dp number', () => {
    const compose = freshCompose();
    const { trailing_3m_pct } = compose().summary;
    assert.ok(trailing_3m_pct === null || typeof trailing_3m_pct === 'number');
  });

  it('trailing_12m_pct is null or a number (series shorter than 13 → null)', () => {
    const compose = freshCompose();
    const { series, summary } = compose();
    if (series.length < 13) {
      assert.equal(summary.trailing_12m_pct, null);
    } else {
      assert.equal(typeof summary.trailing_12m_pct, 'number');
    }
  });

  it('fuel_index > 0', () => {
    const compose = freshCompose();
    assert.ok(compose().summary.fuel_index > 0);
  });

  it('fuel_contribution_pct > 0 (fuel weight 40% × fuel_index > 0)', () => {
    const compose = freshCompose();
    assert.ok(compose().summary.fuel_contribution_pct > 0);
  });
});

// ── Pass-through block ────────────────────────────────────────────

describe('dieselWatch — pass_through', () => {
  it('pass_through has all required fields', () => {
    const compose = freshCompose();
    const { pass_through } = compose();
    for (const k of ['cap_pct', 'floor_pct', 'multiplier', 'clamped_at_cap',
                      'clamped_at_floor', 'headroom_pct_points']) {
      assert.ok(k in pass_through, `pass_through missing field: ${k}`);
    }
  });

  it('cap_pct and floor_pct are positive numbers', () => {
    const compose = freshCompose();
    const { pass_through } = compose();
    assert.ok(typeof pass_through.cap_pct === 'number'   && pass_through.cap_pct   > 0);
    assert.ok(typeof pass_through.floor_pct === 'number' && pass_through.floor_pct > 0);
  });

  it('clamped_at_cap and clamped_at_floor are booleans', () => {
    const compose = freshCompose();
    const { pass_through } = compose();
    assert.equal(typeof pass_through.clamped_at_cap,   'boolean');
    assert.equal(typeof pass_through.clamped_at_floor, 'boolean');
  });

  it('multiplier is between floor_pct/100 and cap_pct/100 (inclusive)', () => {
    const compose = freshCompose();
    const { pass_through } = compose();
    const { multiplier, cap_pct, floor_pct } = pass_through;
    assert.ok(multiplier >= floor_pct / 100,
      `multiplier ${multiplier} below floor ${floor_pct / 100}`);
    assert.ok(multiplier <= cap_pct / 100,
      `multiplier ${multiplier} above cap ${cap_pct / 100}`);
  });

  it('headroom_pct_points = (cap/100 - multiplier) × 100, 2dp', () => {
    const compose = freshCompose();
    const { pass_through } = compose();
    const { cap_pct, multiplier, headroom_pct_points } = pass_through;
    const expected = Number(((cap_pct / 100 - multiplier) * 100).toFixed(2));
    assert.equal(headroom_pct_points, expected);
  });
});

// ── Pending review block ──────────────────────────────────────────

describe('dieselWatch — pending_review', () => {
  it('pending_review has all required fields', () => {
    const compose = freshCompose();
    const { pending_review } = compose();
    for (const k of ['review_date', 'base_usd_per_tonne',
                      'would_effective_usd_per_tonne', 'would_delta_pct']) {
      assert.ok(k in pending_review, `pending_review missing field: ${k}`);
    }
  });

  it('base_usd_per_tonne matches CONTRACT.base_tariff_usd_per_tonne', () => {
    const compose = freshCompose();
    const { pending_review } = compose();
    const { CONTRACT } = require('../services/aggregator');
    assert.equal(pending_review.base_usd_per_tonne, CONTRACT.base_tariff_usd_per_tonne);
  });

  it('would_effective_usd_per_tonne is a positive number', () => {
    const compose = freshCompose();
    assert.ok(compose().pending_review.would_effective_usd_per_tonne > 0);
  });
});

// ── Fleet burn block ──────────────────────────────────────────────

describe('dieselWatch — fleet_burn', () => {
  it('fleet_burn has all required fields', () => {
    const compose = freshCompose();
    const { fleet_burn } = compose();
    for (const k of ['corridor_avg_fuel_usd_per_tonne', 'corridor_total_fuel_usd',
                      'corridor_total_tons', 'laden_trips_n', 'per_hauler']) {
      assert.ok(k in fleet_burn, `fleet_burn missing field: ${k}`);
    }
  });

  it('laden_trips_n > 0 (TRIPS mock has laden trips)', () => {
    const compose = freshCompose();
    assert.ok(compose().fleet_burn.laden_trips_n > 0);
  });

  it('corridor_avg_fuel_usd_per_tonne > 0', () => {
    const compose = freshCompose();
    assert.ok(compose().fleet_burn.corridor_avg_fuel_usd_per_tonne > 0);
  });

  it('per_hauler is an array with at least one entry', () => {
    const compose = freshCompose();
    const { per_hauler } = compose().fleet_burn;
    assert.ok(Array.isArray(per_hauler) && per_hauler.length > 0);
  });

  it('each per_hauler entry has required fields', () => {
    const compose = freshCompose();
    for (const h of compose().fleet_burn.per_hauler) {
      for (const k of ['hauler_id', 'display_name', 'trips_n', 'tons',
                        'fuel_usd', 'fuel_usd_per_tonne', 'vs_corridor_pct', 'signal']) {
        assert.ok(k in h, `per_hauler entry missing field: ${k}`);
      }
    }
  });

  it('per_hauler sorted ascending by fuel_usd_per_tonne', () => {
    const compose = freshCompose();
    const { per_hauler } = compose().fleet_burn;
    for (let i = 1; i < per_hauler.length; i++) {
      assert.ok(per_hauler[i].fuel_usd_per_tonne >= per_hauler[i - 1].fuel_usd_per_tonne,
        `per_hauler not sorted asc: [${i-1}]=${per_hauler[i-1].fuel_usd_per_tonne} > [${i}]=${per_hauler[i].fuel_usd_per_tonne}`);
    }
  });

  it('signal is one of better / flat / worse', () => {
    const compose = freshCompose();
    for (const h of compose().fleet_burn.per_hauler) {
      assert.ok(['better', 'flat', 'worse'].includes(h.signal),
        `${h.hauler_id} has unexpected signal: ${h.signal}`);
    }
  });

  it('roster display_name is used when available', () => {
    const compose = freshCompose();
    const { per_hauler } = compose().fleet_burn;
    // haul-01 should show 'Hauler One' from stub
    const h1 = per_hauler.find((h) => h.hauler_id === 'haul-01');
    if (h1) {
      assert.equal(h1.display_name, 'Hauler One');
    }
  });

  it('compose() is idempotent', () => {
    const compose = freshCompose();
    const r1 = compose();
    const r2 = compose();
    assert.equal(r1.current_month, r2.current_month);
    assert.deepEqual(r1.pass_through, r2.pass_through);
    assert.deepEqual(r1.fleet_burn.per_hauler, r2.fleet_burn.per_hauler);
  });
});
