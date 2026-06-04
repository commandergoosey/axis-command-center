'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

// ── Stubs (before requiring any app modules) ──────────────────────────
// corridorAnalytics only needs roster at runtime; stub it before loading.

const HAULERS = [
  { id: 'haul-01', display_name: 'TruckCo',    status: 'active' },
  { id: 'haul-02', display_name: 'RoadRunner',  status: 'active' },
  { id: 'haul-03', display_name: 'GoldFreight', status: 'active' },
  { id: 'haul-04', display_name: 'AlphaHaul',  status: 'active' },
  { id: 'haul-05', display_name: 'BetaRun',     status: 'active' },
];

const rosterKey = require.resolve('../state/roster');
require.cache[rosterKey] = {
  id: rosterKey, filename: rosterKey, loaded: true,
  exports: { list: () => HAULERS },
};

const convoyStateKey = require.resolve('../state/convoyState');
require.cache[convoyStateKey] = {
  id: convoyStateKey, filename: convoyStateKey, loaded: true,
  exports: {
    todayTonnage: () => ({ total_tonnes: 0, convoy_count: 0 }),
    listActive:   () => [],
  },
};

// aggregator returns a minimal shape with the 5 haulers
const aggregatorKey = require.resolve('../services/aggregator');
require.cache[aggregatorKey] = {
  id: aggregatorKey, filename: aggregatorKey, loaded: true,
  exports: {
    aggregate: (_haulers, _date) => ({
      haulers: HAULERS.map((h, i) => ({
        id:           h.id,
        display_name: h.display_name,
        status:       'active',
        tonnes_delivered_mtd:  (i + 1) * 1_000,
        tonnes_contracted_mtd: (i + 1) * 1_200,
        performance: { sla_attainment_pct: 85 + i },
        fleet: { contracted_trucks: 10 + i * 2 },
      })),
    }),
  },
};

const mockFleetKey = require.resolve('../mock/fleet');
require.cache[mockFleetKey] = {
  id: mockFleetKey, filename: mockFleetKey, loaded: true,
  exports: {
    FLEET: [
      { hauler_id: 'haul-01', efficiency_l_per_100km: 42.0 },
      { hauler_id: 'haul-01', efficiency_l_per_100km: 44.0 },
      { hauler_id: 'haul-02', efficiency_l_per_100km: 38.5 },
    ],
  },
};

// Provide a few mock trips so cost_per_tonne_rank and payload_histogram have data
const MOCK_TRIPS = [
  { hauler_id: 'haul-01', direction: 'southbound', tonnage_t: 42, cost: { total_usd: 630 }, revenue_usd: 840, departed_at: '2026-01-06T08:00:00Z', completed_at: '2026-01-06T22:00:00Z' },
  { hauler_id: 'haul-01', direction: 'southbound', tonnage_t: 38, cost: { total_usd: 570 }, revenue_usd: 760, departed_at: '2026-01-07T08:00:00Z', completed_at: '2026-01-07T22:00:00Z' },
  { hauler_id: 'haul-02', direction: 'southbound', tonnage_t: 40, cost: { total_usd: 680 }, revenue_usd: 800, departed_at: '2026-01-08T08:00:00Z', completed_at: '2026-01-08T22:00:00Z' },
  { hauler_id: 'haul-01', direction: 'northbound', tonnage_t: 0,  cost: { total_usd: 0   }, revenue_usd: 0,   departed_at: '2026-01-09T08:00:00Z', completed_at: '2026-01-09T18:00:00Z' },
];

const mockTripsKey = require.resolve('../mock/trips');
require.cache[mockTripsKey] = {
  id: mockTripsKey, filename: mockTripsKey, loaded: true,
  exports: { TRIPS: MOCK_TRIPS, delayHeatmap: () => [] },
};

// ── Load modules under test ───────────────────────────────────────────
delete require.cache[require.resolve('../services/corridorAnalytics')];
const corridorAnalytics = require('../services/corridorAnalytics');

// ── HTTP server for route tests ───────────────────────────────────────
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/analytics', require('../routes/analytics'));

let server, base;

before(() => new Promise((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

// ─────────────────────────────────────────────────────────────────────

describe('corridorAnalytics.compose() — structure', () => {
  let result;
  before(() => { result = corridorAnalytics.compose(); });

  it('returns the top-level required fields', () => {
    assert.ok('generated_at'  in result, 'generated_at missing');
    assert.ok('period'        in result, 'period missing');
    assert.ok('weeks_shown'   in result, 'weeks_shown missing');
    assert.ok('contract'      in result, 'contract missing');
    assert.ok('weeks'         in result, 'weeks missing');
    assert.ok('ytd'           in result, 'ytd missing');
    assert.ok('hauler_totals' in result, 'hauler_totals missing');
  });

  it('contract contains the four expected constants', () => {
    const { contract } = result;
    assert.strictEqual(contract.annual_target_t, 1_000_000);
    assert.strictEqual(contract.annual_floor_t,    800_000);
    assert.ok(contract.weekly_target_t > 0, 'weekly_target_t must be positive');
    assert.ok(contract.weekly_floor_t  > 0, 'weekly_floor_t must be positive');
    assert.ok(contract.weekly_target_t > contract.weekly_floor_t,
      'weekly target must exceed weekly floor');
  });

  it('returns exactly 12 weeks', () => {
    assert.strictEqual(result.weeks.length, 12);
    assert.strictEqual(result.weeks_shown,   12);
  });

  it('weeks are in ascending (oldest → newest) order', () => {
    const { weeks } = result;
    for (let i = 1; i < weeks.length; i++) {
      assert.ok(weeks[i].week_of > weeks[i - 1].week_of,
        `week[${i}].week_of should be after week[${i-1}].week_of`);
    }
  });

  it('each week has all required fields', () => {
    for (const w of result.weeks) {
      assert.ok('week_of'         in w, 'week_of missing');
      assert.ok('week_ending'     in w, 'week_ending missing');
      assert.ok('tonnes'          in w, 'tonnes missing');
      assert.ok('laden_trips'     in w, 'laden_trips missing');
      assert.ok('delayed_trips'   in w, 'delayed_trips missing');
      assert.ok('on_time_pct'     in w, 'on_time_pct missing');
      assert.ok('avg_cycle_h'     in w, 'avg_cycle_h missing');
      assert.ok('hauler_breakdown' in w, 'hauler_breakdown missing');
    }
  });

  it('weekly tonnes are at or above the floor and below a plausible ceiling', () => {
    const WEEKLY_FLOOR = result.contract.weekly_floor_t;
    for (const w of result.weeks) {
      assert.ok(w.tonnes >= WEEKLY_FLOOR,
        `week ${w.week_of} tonnes=${w.tonnes} is below floor=${WEEKLY_FLOOR}`);
      assert.ok(w.tonnes <= 35_000,
        `week ${w.week_of} tonnes=${w.tonnes} exceeds plausible ceiling`);
    }
  });

  it('each week has hauler_breakdown with one entry per hauler', () => {
    for (const w of result.weeks) {
      assert.strictEqual(w.hauler_breakdown.length, HAULERS.length,
        `week ${w.week_of} should have ${HAULERS.length} hauler entries`);
    }
  });

  it('hauler_breakdown tonnes in each week sum to week tonnes', () => {
    for (const w of result.weeks) {
      const breakdownSum = w.hauler_breakdown.reduce((s, h) => s + h.tonnes, 0);
      // Allow ±1 t for rounding
      assert.ok(Math.abs(breakdownSum - w.tonnes) <= 1,
        `week ${w.week_of}: breakdown sum ${breakdownSum} should equal week tonnes ${w.tonnes} (±1)`);
    }
  });

  it('on_time_pct is between 70 and 100 for every week', () => {
    for (const w of result.weeks) {
      assert.ok(w.on_time_pct >= 70 && w.on_time_pct <= 100,
        `on_time_pct=${w.on_time_pct} out of expected range for week ${w.week_of}`);
    }
  });

  it('period string spans first week_of to last week_ending', () => {
    const { period, weeks } = result;
    assert.ok(period.startsWith(weeks[0].week_of),      'period should start with oldest week_of');
    assert.ok(period.endsWith(weeks[weeks.length-1].week_ending), 'period should end with newest week_ending');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('corridorAnalytics.compose() — YTD', () => {
  let ytd;
  before(() => { ytd = corridorAnalytics.compose().ytd; });

  it('ytd has all required fields', () => {
    for (const field of ['tonnes_actual', 'tonnes_target', 'tonnes_floor',
      'pct_of_target', 'pct_of_floor', 'surplus_vs_floor', 'above_floor',
      'weekly_run_rate', 'projected_year_end', 'days_elapsed']) {
      assert.ok(field in ytd, `ytd.${field} missing`);
    }
  });

  it('ytd.tonnes_actual includes the Jan–Apr monthly actuals (≥ 304,200 t)', () => {
    // Jan 68,200 + Feb 75,400 + Mar 79,100 + Apr 81,500 = 304,200 t minimum
    assert.ok(ytd.tonnes_actual >= 304_200,
      `ytd.tonnes_actual=${ytd.tonnes_actual} should be ≥ 304,200 (Jan–Apr actuals)`);
  });

  it('ytd.above_floor is a boolean', () => {
    assert.strictEqual(typeof ytd.above_floor, 'boolean');
  });

  it('ytd.weekly_run_rate is a positive integer', () => {
    assert.ok(Number.isInteger(ytd.weekly_run_rate) && ytd.weekly_run_rate > 0);
  });

  it('projected_year_end is between floor and a plausible maximum', () => {
    assert.ok(ytd.projected_year_end > 0);
    assert.ok(ytd.projected_year_end < 2_000_000, 'projection should not be wildly high');
  });

  it('pct_of_floor > 0 when above floor', () => {
    if (ytd.above_floor) {
      assert.ok(ytd.pct_of_floor >= 100, 'above floor → pct_of_floor should be ≥ 100');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('corridorAnalytics.compose() — hauler totals', () => {
  let hauler_totals;
  before(() => { hauler_totals = corridorAnalytics.compose().hauler_totals; });

  it('returns one entry per hauler (5 haulers)', () => {
    assert.strictEqual(hauler_totals.length, HAULERS.length);
  });

  it('share_pct values sum to ~100 (within 1 %)', () => {
    const totalShare = hauler_totals.reduce((s, h) => s + h.share_pct, 0);
    assert.ok(Math.abs(totalShare - 100) <= 1,
      `share_pct sum=${totalShare.toFixed(1)} should be ≈100`);
  });

  it('hauler_totals is sorted by tonnes descending', () => {
    for (let i = 1; i < hauler_totals.length; i++) {
      assert.ok(hauler_totals[i].tonnes <= hauler_totals[i - 1].tonnes,
        `hauler_totals not sorted: [${i-1}]=${hauler_totals[i-1].tonnes} < [${i}]=${hauler_totals[i].tonnes}`);
    }
  });

  it('each hauler total has tonnes, trips, on_time_pct, share_pct', () => {
    for (const h of hauler_totals) {
      assert.ok(h.tonnes      > 0,    `${h.hauler_id}: tonnes should be positive`);
      assert.ok(h.trips       > 0,    `${h.hauler_id}: trips should be positive`);
      assert.ok(h.on_time_pct >= 0,   `${h.hauler_id}: on_time_pct should be non-negative`);
      assert.ok(h.share_pct   > 0,    `${h.hauler_id}: share_pct should be positive`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('analytics route GET /api/analytics', () => {
  let body;

  before(async () => {
    const res = await fetch(`${base}/api/analytics`);
    assert.strictEqual(res.status, 200);
    body = await res.json();
  });

  it('returns 200 with the corridorAnalytics base fields', () => {
    assert.ok('weeks'          in body, 'weeks missing from response');
    assert.ok('ytd'            in body, 'ytd missing from response');
    assert.ok('hauler_totals'  in body, 'hauler_totals missing from response');
    assert.ok('contract'       in body, 'contract missing from response');
    assert.ok('generated_at'   in body, 'generated_at missing from response');
  });

  it('includes today_live with expected shape', () => {
    assert.ok('today_live' in body, 'today_live missing');
    if (body.today_live) {
      assert.ok('date'                in body.today_live);
      assert.ok('convoy_count_today'  in body.today_live);
      assert.ok('tonnes_today'        in body.today_live);
      assert.ok('active_convoys'      in body.today_live);
      assert.ok('has_live_data'       in body.today_live);
    }
  });

  it('weekday_pattern has exactly 7 days Mon–Sun', () => {
    assert.ok(Array.isArray(body.weekday_pattern), 'weekday_pattern should be an array');
    assert.strictEqual(body.weekday_pattern.length, 7);
    const days = body.weekday_pattern.map((d) => d.day);
    assert.deepStrictEqual(days, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('weekday_pattern avg_tonnes are non-negative numbers', () => {
    for (const d of body.weekday_pattern) {
      assert.ok(typeof d.avg_tonnes === 'number' && d.avg_tonnes >= 0,
        `${d.day}: avg_tonnes=${d.avg_tonnes} should be a non-negative number`);
    }
  });

  it('payload_histogram has 5 bands with non-negative counts', () => {
    assert.ok(Array.isArray(body.payload_histogram));
    assert.strictEqual(body.payload_histogram.length, 5);
    for (const b of body.payload_histogram) {
      assert.ok('key'       in b, 'band key missing');
      assert.ok('label'     in b, 'band label missing');
      assert.ok('count'     in b, 'band count missing');
      assert.ok('share_pct' in b, 'band share_pct missing');
      assert.ok(b.count     >= 0, `${b.key}: count must be non-negative`);
      assert.ok(b.share_pct >= 0, `${b.key}: share_pct must be non-negative`);
    }
  });

  it('payload_histogram share_pct sums to ~100 when there are trips', () => {
    const total = body.payload_histogram.reduce((s, b) => s + b.count, 0);
    if (total > 0) {
      const shareSum = body.payload_histogram.reduce((s, b) => s + b.share_pct, 0);
      assert.ok(Math.abs(shareSum - 100) <= 0.5,
        `payload share_pct sum=${shareSum.toFixed(1)} should be ≈100`);
    }
  });

  it('cost_per_tonne_rank is sorted ascending (cheapest first)', () => {
    const rank = body.cost_per_tonne_rank;
    if (rank && rank.length > 1) {
      for (let i = 1; i < rank.length; i++) {
        assert.ok(rank[i].avg_cost_per_tonne >= rank[i - 1].avg_cost_per_tonne,
          'cost_per_tonne_rank must be sorted cheapest first');
      }
    }
  });

  it('hauler_attainment entries have the expected shape', () => {
    if (body.hauler_attainment && body.hauler_attainment.length > 0) {
      for (const h of body.hauler_attainment) {
        assert.ok('hauler_id'          in h, 'hauler_id missing');
        assert.ok('sla_attainment_pct' in h, 'sla_attainment_pct missing');
        assert.ok('trailing_12w_tonnes' in h, 'trailing_12w_tonnes missing');
      }
    }
  });

  it('revenue_per_km entries have week_of, revenue_usd, revenue_per_km', () => {
    if (body.revenue_per_km && body.revenue_per_km.length > 0) {
      for (const entry of body.revenue_per_km) {
        assert.ok('week_of'        in entry, 'week_of missing from revenue_per_km entry');
        assert.ok('revenue_usd'    in entry, 'revenue_usd missing');
        assert.ok('revenue_per_km' in entry, 'revenue_per_km missing');
      }
    }
  });
});
