'use strict';

/*
 * Tests for services/corridorAnalytics.js — compose()
 *
 * compose() calls roster.list() then builds 12-week deterministic data
 * using a seeded PRNG. It uses new Date() internally (no injectable clock),
 * so all tests are structural / invariant rather than date-pinned.
 *
 * Contract constants:
 *   ANNUAL_TARGET  = 1,000,000 t
 *   ANNUAL_FLOOR   = 800,000 t
 *   WEEKLY_TARGET  = 19,231 t  (= round(1_000_000 / 52))
 *   WEEKLY_FLOOR   = 15,385 t  (= round(800_000  / 52))
 *
 * HAULER_META has 5 fixed entries (haul-01 … haul-05).
 * roster.list() is stubbed; display_name falls back to hauler_id when
 * the roster entry is missing.
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

const MOCK_HAULERS = [
  { id: 'haul-01', display_name: 'Hauler One' },
  { id: 'haul-02', display_name: 'Hauler Two' },
  { id: 'haul-03', display_name: 'Hauler Three' },
  { id: 'haul-04', display_name: 'Hauler Four' },
  { id: 'haul-05', display_name: 'Hauler Five' },
];

function freshCompose(haulers = MOCK_HAULERS) {
  stub('../state/roster', { list: () => haulers });
  delete require.cache[require.resolve('../services/corridorAnalytics')];
  return require('../services/corridorAnalytics').compose;
}

after(() => {
  for (const p of ['../services/corridorAnalytics', '../state/roster'])
    delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────

describe('corridorAnalytics — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose();
    const r = compose();
    for (const k of ['generated_at', 'period', 'weeks_shown', 'contract', 'weeks', 'ytd', 'hauler_totals']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('weeks_shown = 12', () => {
    const compose = freshCompose();
    assert.equal(compose().weeks_shown, 12);
  });

  it('contract block has correct constants', () => {
    const compose = freshCompose();
    const { contract } = compose();
    assert.equal(contract.annual_target_t, 1_000_000);
    assert.equal(contract.annual_floor_t,  800_000);
    assert.equal(contract.weekly_target_t, 19_231);
    assert.equal(contract.weekly_floor_t,  15_385);
  });

  it('generated_at is a valid ISO 8601 timestamp', () => {
    const compose = freshCompose();
    const { generated_at } = compose();
    assert.equal(typeof generated_at, 'string');
    assert.ok(!isNaN(new Date(generated_at).getTime()), `generated_at "${generated_at}" is not a valid date`);
  });

  it('period is a formatted date range string', () => {
    const compose = freshCompose();
    const r = compose();
    assert.ok(typeof r.period === 'string', 'period should be a string');
    assert.ok(r.period.includes(' to '), 'period should contain " to "');
  });
});

// ── Weeks array structure ─────────────────────────────────────────

describe('corridorAnalytics — weeks array', () => {
  it('weeks array has exactly 12 entries', () => {
    const compose = freshCompose();
    assert.equal(compose().weeks.length, 12);
  });

  it('each week entry has all required fields', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      for (const k of ['week_of', 'week_ending', 'tonnes', 'laden_trips',
                        'delayed_trips', 'on_time_pct', 'avg_cycle_h', 'hauler_breakdown']) {
        assert.ok(k in w, `week missing field: ${k}`);
      }
    }
  });

  it('weeks are in chronological order (oldest first)', () => {
    const compose = freshCompose();
    const weeks = compose().weeks;
    for (let i = 1; i < weeks.length; i++) {
      assert.ok(weeks[i].week_of > weeks[i - 1].week_of,
        `week[${i}].week_of ${weeks[i].week_of} should be after ${weeks[i - 1].week_of}`);
    }
  });

  it('week_ending is 6 days after week_of for each week', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      const monday = new Date(w.week_of);
      const sunday = new Date(w.week_ending);
      const diff   = (sunday - monday) / 86_400_000;
      assert.equal(diff, 6, `week starting ${w.week_of}: ending should be 6 days later, got diff=${diff}`);
    }
  });

  it('all weekly tonnes ≥ WEEKLY_FLOOR (15,385)', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      assert.ok(w.tonnes >= 15_385,
        `week ${w.week_of} tonnes ${w.tonnes} is below WEEKLY_FLOOR 15,385`);
    }
  });

  it('each week has hauler_breakdown with 5 entries', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      assert.equal(w.hauler_breakdown.length, 5,
        `week ${w.week_of} hauler_breakdown length should be 5`);
    }
  });

  it('each hauler_breakdown entry has required fields', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      for (const hb of w.hauler_breakdown) {
        for (const k of ['hauler_id', 'display_name', 'tonnes', 'trips', 'on_time_pct']) {
          assert.ok(k in hb, `hb for ${hb.hauler_id} missing field: ${k}`);
        }
      }
    }
  });

  it('hauler_breakdown uses display_name from roster when available', () => {
    const compose = freshCompose();
    const firstWeek = compose().weeks[0];
    const h1 = firstWeek.hauler_breakdown.find((hb) => hb.hauler_id === 'haul-01');
    assert.ok(h1 != null, 'haul-01 should be in hauler_breakdown');
    assert.equal(h1.display_name, 'Hauler One');
  });

  it('hauler_breakdown falls back to hauler_id when not in roster', () => {
    // Pass empty roster — display_name should fall back to hauler_id
    const compose = freshCompose([]);
    const firstWeek = compose().weeks[0];
    const h1 = firstWeek.hauler_breakdown.find((hb) => hb.hauler_id === 'haul-01');
    assert.ok(h1 != null, 'haul-01 should still appear in hauler_breakdown');
    assert.equal(h1.display_name, 'haul-01', 'display_name should fall back to hauler_id');
  });

  it('per-week hauler tonnes sum to corridor tonnes (after normalisation)', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      const haulerSum = w.hauler_breakdown.reduce((s, hb) => s + hb.tonnes, 0);
      // Normalisation rounds each haul individually, so allow ±5 rounding error
      assert.ok(Math.abs(haulerSum - w.tonnes) <= 5,
        `week ${w.week_of}: hauler sum ${haulerSum} should ≈ corridor ${w.tonnes}`);
    }
  });
});

// ── YTD summary ───────────────────────────────────────────────────

describe('corridorAnalytics — ytd', () => {
  it('ytd has all required fields', () => {
    const compose = freshCompose();
    const { ytd } = compose();
    for (const k of ['tonnes_actual', 'tonnes_target', 'tonnes_floor',
                      'pct_of_target', 'pct_of_floor', 'surplus_vs_floor',
                      'above_floor', 'weekly_run_rate', 'projected_year_end',
                      'projected_vs_target', 'days_elapsed']) {
      assert.ok(k in ytd, `ytd missing field: ${k}`);
    }
  });

  it('above_floor is consistent with surplus_vs_floor', () => {
    const compose = freshCompose();
    const { ytd } = compose();
    const expected = ytd.surplus_vs_floor >= 0;
    assert.equal(ytd.above_floor, expected,
      `above_floor ${ytd.above_floor} inconsistent with surplus ${ytd.surplus_vs_floor}`);
  });

  it('tonnes_actual > 0', () => {
    const compose = freshCompose();
    assert.ok(compose().ytd.tonnes_actual > 0);
  });

  it('days_elapsed > 0', () => {
    const compose = freshCompose();
    assert.ok(compose().ytd.days_elapsed > 0);
  });

  it('pct_of_target and pct_of_floor are positive numbers', () => {
    const compose = freshCompose();
    const { ytd } = compose();
    assert.ok(typeof ytd.pct_of_target === 'number' && ytd.pct_of_target > 0);
    assert.ok(typeof ytd.pct_of_floor  === 'number' && ytd.pct_of_floor  > 0);
  });

  it('projected_year_end is greater than tonnes_actual', () => {
    const compose = freshCompose();
    const { ytd } = compose();
    assert.ok(ytd.projected_year_end > ytd.tonnes_actual,
      'projected full-year should exceed current YTD');
  });

  it('weekly_run_rate > 0', () => {
    const compose = freshCompose();
    assert.ok(compose().ytd.weekly_run_rate > 0);
  });
});

// ── Hauler totals ─────────────────────────────────────────────────

describe('corridorAnalytics — hauler_totals', () => {
  it('hauler_totals has 5 entries (one per HAULER_META)', () => {
    const compose = freshCompose();
    assert.equal(compose().hauler_totals.length, 5);
  });

  it('each hauler_totals entry has required fields', () => {
    const compose = freshCompose();
    for (const h of compose().hauler_totals) {
      for (const k of ['hauler_id', 'display_name', 'tonnes', 'trips', 'on_time_pct', 'share_pct']) {
        assert.ok(k in h, `hauler_totals entry missing field: ${k}`);
      }
    }
  });

  it('hauler_totals is sorted by tonnes descending', () => {
    const compose = freshCompose();
    const totals = compose().hauler_totals;
    for (let i = 1; i < totals.length; i++) {
      assert.ok(totals[i].tonnes <= totals[i - 1].tonnes,
        `hauler_totals[${i}] tonnes ${totals[i].tonnes} > [${i - 1}] ${totals[i - 1].tonnes}`);
    }
  });

  it('share_pct values sum to ≈ 100 (within 1%)', () => {
    const compose = freshCompose();
    const total = compose().hauler_totals.reduce((s, h) => s + h.share_pct, 0);
    assert.ok(Math.abs(total - 100) <= 1,
      `share_pct total ${total} should be ≈ 100`);
  });

  it('all on_time_pct values are between 0 and 100', () => {
    const compose = freshCompose();
    for (const h of compose().hauler_totals) {
      assert.ok(h.on_time_pct >= 0 && h.on_time_pct <= 100,
        `${h.hauler_id} on_time_pct ${h.on_time_pct} out of range`);
    }
  });

  it('all on_time_pct values are between 0 and 100 (week level too)', () => {
    const compose = freshCompose();
    for (const w of compose().weeks) {
      for (const hb of w.hauler_breakdown) {
        assert.ok(hb.on_time_pct >= 0 && hb.on_time_pct <= 100,
          `${hb.hauler_id} week ${w.week_of} on_time_pct ${hb.on_time_pct} out of range`);
      }
    }
  });
});

// ── Cross-checks ──────────────────────────────────────────────────

describe('corridorAnalytics — cross-checks', () => {
  it('period start matches weeks[0].week_of', () => {
    const compose = freshCompose();
    const r = compose();
    assert.ok(r.period.startsWith(r.weeks[0].week_of),
      `period "${r.period}" should start with ${r.weeks[0].week_of}`);
  });

  it('period end matches weeks[11].week_ending', () => {
    const compose = freshCompose();
    const r = compose();
    assert.ok(r.period.endsWith(r.weeks[11].week_ending),
      `period "${r.period}" should end with ${r.weeks[11].week_ending}`);
  });

  it('hauler_totals tonnes sum ≈ sum of all weekly corridor tonnes (within 1%)', () => {
    const compose = freshCompose();
    const r = compose();
    const weeklySum = r.weeks.reduce((s, w) => s + w.tonnes, 0);
    const haulerSum = r.hauler_totals.reduce((s, h) => s + h.tonnes, 0);
    const ratio = haulerSum / weeklySum;
    assert.ok(Math.abs(ratio - 1) < 0.01,
      `hauler total ${haulerSum} should be within 1% of weekly sum ${weeklySum}`);
  });

  it('compose() is idempotent — same week_of dates on second call', () => {
    const compose = freshCompose();
    const r1 = compose();
    const r2 = compose();
    const dates1 = r1.weeks.map((w) => w.week_of);
    const dates2 = r2.weeks.map((w) => w.week_of);
    assert.deepEqual(dates1, dates2, 'week_of dates should be identical across calls');
  });

  it('compose() is idempotent — same contract constants on second call', () => {
    const compose = freshCompose();
    const r1 = compose();
    const r2 = compose();
    assert.deepEqual(r1.contract, r2.contract);
  });

  it('last week tonnes are higher than first week tonnes (ramp-up trend)', () => {
    // The PRNG introduces noise but the overall trend goes 17,200 → 19,000
    // Compare averages of first 3 and last 3 weeks rather than individual weeks
    const compose = freshCompose();
    const weeks = compose().weeks;
    const first3avg = (weeks[0].tonnes + weeks[1].tonnes + weeks[2].tonnes) / 3;
    const last3avg  = (weeks[9].tonnes + weeks[10].tonnes + weeks[11].tonnes) / 3;
    assert.ok(last3avg > first3avg,
      `last-3-week avg ${last3avg.toFixed(0)} should be higher than first-3-week avg ${first3avg.toFixed(0)}`);
  });
});
