'use strict';

/*
 * Tests for services/driverLeaderboard.js
 *
 * compose() reads from driverStore, convoyState, and dailyTargets.
 * We stub all three via require.cache so the service sees controlled data.
 *
 * Test driver pool (4 drivers, 2 haulers):
 *   A — safety 80, trips 10, hours 55  → hauler-01  (below all HOS thresholds)
 *   B — safety 60, trips  8, hours 62  → hauler-01  (HOS: WATCH   ≥60)
 *   C — safety 90, trips  5, hours 66  → hauler-02  (HOS: WARNING ≥65)
 *   D — safety 70, trips 10, hours 69  → hauler-02  (HOS: CRITICAL ≥68)
 *
 * Expected composite scores (normalise against corridor maxima):
 *   maxSafety=90, maxTrips=10, maxHours=69
 *   D → round((77.78+100+100)/3)  = 93  rank 1
 *   A → round((88.89+100+79.71)/3) = 90  rank 2
 *   C → round((100  + 50+95.65)/3) = 82  rank 3
 *   B → round((66.67+ 80+89.86)/3) = 79  rank 4
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Fixtures ──────────────────────────────────────────────────────────

const DRIVERS = [
  { id: 'drv-A', full_name: 'Alice Mensah',  hauler_id: 'hauler-01', hauler_display: 'H01',
    safety_score: 80, trips_this_week: 10, hours_this_week: 55, harsh_events_7d: 1, flag: false },
  { id: 'drv-B', full_name: 'Ben Asante',    hauler_id: 'hauler-01', hauler_display: 'H01',
    safety_score: 60, trips_this_week:  8, hours_this_week: 62, harsh_events_7d: 4, flag: false },
  { id: 'drv-C', full_name: 'Clara Boateng', hauler_id: 'hauler-02', hauler_display: 'H02',
    safety_score: 90, trips_this_week:  5, hours_this_week: 66, harsh_events_7d: 0, flag: false },
  { id: 'drv-D', full_name: 'Dan Owusu',     hauler_id: 'hauler-02', hauler_display: 'H02',
    safety_score: 70, trips_this_week: 10, hours_this_week: 69, harsh_events_7d: 2, flag: true  },
];

// ── Stub setup ────────────────────────────────────────────────────────

function stubRequire(resolvedPath, mockExports) {
  require.cache[require.resolve(resolvedPath)] = {
    id:       require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded:   true,
    exports:  mockExports,
  };
}

function stubDriverStore(drivers) {
  stubRequire('../state/driverStore', { list: () => drivers });
}

function stubConvoyState(opts = {}) {
  const { total_tonnes = 1200, convoy_count = 6, active = 3 } = opts;
  stubRequire('../state/convoyState', {
    todayTonnage: () => ({ total_tonnes, convoy_count }),
    listActive:   () => new Array(active).fill({}),
  });
}

function stubDailyTargets() {
  stubRequire('../state/dailyTargets', { todayKey: () => '2026-05-21' });
}

function freshCompose() {
  // Clear the leaderboard module so it re-resolves its stubs
  delete require.cache[require.resolve('../services/driverLeaderboard')];
  return require('../services/driverLeaderboard').compose;
}

before(() => {
  stubConvoyState();
  stubDailyTargets();
});

after(() => {
  // Clean up so other test files aren't affected
  for (const path of [
    '../state/driverStore',
    '../state/convoyState',
    '../state/dailyTargets',
    '../services/driverLeaderboard',
  ]) {
    delete require.cache[require.resolve(path)];
  }
});

// ── Output shape ──────────────────────────────────────────────────────

describe('driverLeaderboard — output shape', () => {
  it('returns all required top-level keys', () => {
    stubDriverStore(DRIVERS);
    const result = freshCompose()();
    for (const key of [
      'generated_at', 'period', 'total_drivers', 'hauler_filter',
      'podiums', 'corridor_avg', 'rankings', 'live_corridor',
      'fatigue_flags', 'hos_trend', 'hauler_radar',
    ]) {
      assert.ok(key in result, `missing key: ${key}`);
    }
  });

  it('total_drivers equals pool size', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()();
    assert.equal(r.total_drivers, 4);
  });

  it('rankings length equals pool size', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()();
    assert.equal(r.rankings.length, 4);
  });

  it('each ranking entry has required fields', () => {
    stubDriverStore(DRIVERS);
    for (const d of freshCompose()().rankings) {
      for (const key of ['id', 'full_name', 'hauler_id', 'safety_score',
                          'trips_this_week', 'hours_this_week', 'composite', 'rank']) {
        assert.ok(key in d, `ranking entry missing: ${key}`);
      }
    }
  });

  it('empty pool returns valid zero-state without throwing', () => {
    stubDriverStore([]);
    const r = freshCompose()();
    assert.equal(r.total_drivers, 0);
    assert.equal(r.rankings.length, 0);
    assert.deepEqual(r.podiums, { safety: [], trips: [], hours: [] });
    assert.deepEqual(r.corridor_avg, { safety: 0, trips: 0, hours: 0 });
  });
});

// ── Composite ranking ─────────────────────────────────────────────────

describe('driverLeaderboard — composite ranking', () => {
  it('ranks are assigned 1…N in composite-score order', () => {
    stubDriverStore(DRIVERS);
    const ranks = freshCompose()().rankings.map((d) => d.rank);
    assert.deepEqual(ranks, [1, 2, 3, 4]);
  });

  it('rank 1 has the highest composite score', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()().rankings;
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[0].composite >= r[i].composite,
        `rank 1 composite ${r[0].composite} < rank ${i+1} composite ${r[i].composite}`);
    }
  });

  it('Driver D (highest composite ≈93) is ranked 1', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()().rankings;
    assert.equal(r[0].id, 'drv-D');
  });

  it('Driver B (lowest composite ≈79) is ranked 4', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()().rankings;
    assert.equal(r[r.length - 1].id, 'drv-B');
  });

  it('composite scores are integers (Math.round applied)', () => {
    stubDriverStore(DRIVERS);
    for (const d of freshCompose()().rankings) {
      assert.equal(d.composite, Math.round(d.composite), `${d.id} composite not integer`);
    }
  });

  it('composite scores are in 0–100 range', () => {
    stubDriverStore(DRIVERS);
    for (const d of freshCompose()().rankings) {
      assert.ok(d.composite >= 0 && d.composite <= 100,
        `${d.id}: composite ${d.composite} out of range`);
    }
  });

  it('driver with all-zero metrics gets composite 0', () => {
    const zeroDriver = { ...DRIVERS[0], id: 'drv-Z', safety_score: 0,
                         trips_this_week: 0, hours_this_week: 0 };
    stubDriverStore([zeroDriver]);
    const r = freshCompose()().rankings;
    assert.equal(r[0].composite, 0);
  });
});

// ── Fatigue flags ─────────────────────────────────────────────────────

describe('driverLeaderboard — fatigue flags (HOS thresholds)', () => {
  it('only drivers at ≥60h appear in fatigue_flags', () => {
    stubDriverStore(DRIVERS);
    const flags = freshCompose()().fatigue_flags;
    const flaggedIds = flags.map((f) => f.driver_id);
    assert.ok(!flaggedIds.includes('drv-A'), 'Driver A (55h) should not be flagged');
    assert.ok(flaggedIds.includes('drv-B'),  'Driver B (62h) should be flagged');
    assert.ok(flaggedIds.includes('drv-C'),  'Driver C (66h) should be flagged');
    assert.ok(flaggedIds.includes('drv-D'),  'Driver D (69h) should be flagged');
  });

  it('62h → WATCH (≥60, <65)', () => {
    stubDriverStore(DRIVERS);
    const b = freshCompose()().fatigue_flags.find((f) => f.driver_id === 'drv-B');
    assert.equal(b.severity, 'WATCH');
  });

  it('66h → WARNING (≥65, <68)', () => {
    stubDriverStore(DRIVERS);
    const c = freshCompose()().fatigue_flags.find((f) => f.driver_id === 'drv-C');
    assert.equal(c.severity, 'WARNING');
  });

  it('69h → CRITICAL (≥68)', () => {
    stubDriverStore(DRIVERS);
    const d = freshCompose()().fatigue_flags.find((f) => f.driver_id === 'drv-D');
    assert.equal(d.severity, 'CRITICAL');
  });

  it('hours_to_limit = max(0, 70 − hours_this_week)', () => {
    stubDriverStore(DRIVERS);
    const flags = freshCompose()().fatigue_flags;
    const b = flags.find((f) => f.driver_id === 'drv-B');
    const c = flags.find((f) => f.driver_id === 'drv-C');
    const d = flags.find((f) => f.driver_id === 'drv-D');
    assert.equal(b.hours_to_limit, 8);  // 70-62
    assert.equal(c.hours_to_limit, 4);  // 70-66
    assert.equal(d.hours_to_limit, 1);  // 70-69
  });

  it('fatigue_flags sorted by hours_this_week descending', () => {
    stubDriverStore(DRIVERS);
    const flags = freshCompose()().fatigue_flags;
    for (let i = 1; i < flags.length; i++) {
      assert.ok(flags[i - 1].hours_this_week >= flags[i].hours_this_week,
        'fatigue_flags not sorted by hours desc');
    }
  });

  it('driver exactly at ceiling (70h) has hours_to_limit = 0', () => {
    const atCeiling = { ...DRIVERS[0], id: 'drv-X', hours_this_week: 70 };
    stubDriverStore([atCeiling]);
    const flags = freshCompose()([]).fatigue_flags ?? freshCompose()().fatigue_flags;
    // Re-stub and call fresh
    stubDriverStore([atCeiling]);
    const f = freshCompose()().fatigue_flags.find((x) => x.driver_id === 'drv-X');
    assert.equal(f?.hours_to_limit, 0);
    assert.equal(f?.severity, 'CRITICAL');
  });
});

// ── Hauler filter ─────────────────────────────────────────────────────

describe('driverLeaderboard — hauler filter', () => {
  it('filtered result contains only that hauler\'s drivers', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()('hauler-01');
    for (const d of r.rankings) {
      assert.equal(d.hauler_id, 'hauler-01', `unexpected hauler_id: ${d.hauler_id}`);
    }
  });

  it('total_drivers reflects filtered count', () => {
    stubDriverStore(DRIVERS);
    assert.equal(freshCompose()('hauler-01').total_drivers, 2);
    assert.equal(freshCompose()('hauler-02').total_drivers, 2);
  });

  it('hauler_filter field echoes the argument', () => {
    stubDriverStore(DRIVERS);
    assert.equal(freshCompose()('hauler-01').hauler_filter, 'hauler-01');
    assert.equal(freshCompose()(null).hauler_filter,       null);
  });

  it('corridor_avg always reflects the full driver pool (not just filtered)', () => {
    stubDriverStore(DRIVERS);
    const filtered   = freshCompose()('hauler-01').corridor_avg;
    const unfiltered = freshCompose()().corridor_avg;
    // Both calls use all 4 drivers for corridor_avg
    assert.deepEqual(filtered, unfiltered);
  });

  it('unknown hauler filter returns empty rankings', () => {
    stubDriverStore(DRIVERS);
    const r = freshCompose()('hauler-99');
    assert.equal(r.rankings.length, 0);
    assert.equal(r.total_drivers, 0);
  });
});

// ── Podiums ───────────────────────────────────────────────────────────

describe('driverLeaderboard — podiums', () => {
  it('each podium has at most 3 entries', () => {
    stubDriverStore(DRIVERS);
    const { podiums } = freshCompose()();
    assert.ok(podiums.safety.length <= 3);
    assert.ok(podiums.trips.length  <= 3);
    assert.ok(podiums.hours.length  <= 3);
  });

  it('podium medals are 1, 2, 3 in order', () => {
    stubDriverStore(DRIVERS);
    const { podiums } = freshCompose()();
    [podiums.safety, podiums.trips, podiums.hours].forEach((p) => {
      p.forEach((e, i) => assert.equal(e.medal, i + 1));
    });
  });

  it('safety podium gold (medal=1) has highest safety_score', () => {
    stubDriverStore(DRIVERS);
    const gold = freshCompose()().podiums.safety[0];
    assert.equal(gold.id, 'drv-C'); // safety 90
  });

  it('hours podium gold has highest hours_this_week', () => {
    stubDriverStore(DRIVERS);
    const gold = freshCompose()().podiums.hours[0];
    assert.equal(gold.id, 'drv-D'); // hours 69
  });
});

// ── Live corridor ─────────────────────────────────────────────────────

describe('driverLeaderboard — live_corridor', () => {
  it('live_corridor carries convoy counts from convoyState', () => {
    stubDriverStore(DRIVERS);
    stubConvoyState({ total_tonnes: 850, convoy_count: 5, active: 2 });
    const r = freshCompose()();
    assert.equal(r.live_corridor.today_convoys, 5);
    assert.equal(r.live_corridor.active_now,    2);
    assert.equal(r.live_corridor.today_tonnes,  850);
  });

  it('live_corridor defaults to zeros when convoyState throws', () => {
    stubDriverStore(DRIVERS);
    stubRequire('../state/convoyState', {
      todayTonnage: () => { throw new Error('db error'); },
      listActive:   () => { throw new Error('db error'); },
    });
    const r = freshCompose()();
    assert.deepEqual(r.live_corridor, { today_convoys: 0, today_tonnes: 0, active_now: 0 });
    // Restore normal stub
    stubConvoyState();
  });
});

// ── HOS trend ─────────────────────────────────────────────────────────

describe('driverLeaderboard — hos_trend', () => {
  it('hos_trend has exactly 8 weeks', () => {
    stubDriverStore(DRIVERS);
    assert.equal(freshCompose()().hos_trend.length, 8);
  });

  it('each week entry has the required fields', () => {
    stubDriverStore(DRIVERS);
    for (const w of freshCompose()().hos_trend) {
      for (const key of ['week', 'critical', 'warning', 'watch', 'ok', 'total']) {
        assert.ok(key in w, `hos_trend entry missing: ${key}`);
      }
    }
  });

  it('counts within each week sum to total_drivers', () => {
    stubDriverStore(DRIVERS);
    for (const w of freshCompose()().hos_trend) {
      const sum = w.critical + w.warning + w.watch + w.ok;
      assert.equal(sum, w.total, `${w.week}: counts ${sum} ≠ total ${w.total}`);
    }
  });

  it('week labels are YYYY-MM-DD ISO dates in ascending order', () => {
    stubDriverStore(DRIVERS);
    const weeks = freshCompose()().hos_trend.map((w) => w.week);
    for (let i = 1; i < weeks.length; i++) {
      assert.ok(weeks[i] > weeks[i - 1],
        `hos_trend weeks not ascending: ${weeks[i - 1]} → ${weeks[i]}`);
    }
  });
});
