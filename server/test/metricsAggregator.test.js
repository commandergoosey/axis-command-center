'use strict';

/*
 * Tests for services/metricsAggregator.js —
 *   aggregate(date), aggregateRange(from, to), get(hauler_id, date), getRange(...)
 *
 * Uses an in-memory SQLite DB so the upsert/select logic runs for real.
 * Stubs: state/haulerStore (list), state/tripStore (forDateRange), services/logger.
 *
 * Key constant: CYCLE_TARGET_MIN = 26 × 60 = 1560 min (default, no env override).
 *   duration_min ≤ 1560 → on_time
 *   duration_min >  1560 → late
 *   duration_min = null  → neither (Infinity guard for on_time, 0 guard for late)
 *
 * Test isolation: each test uses a unique hauler_id + date pair so the
 * single in-memory DB does not accumulate cross-test interference.
 *
 * Covers:
 *   - aggregate: zero haulers / no trips / haulers-with-trips count
 *   - aggregate: trip counters (total, laden, empty)
 *   - aggregate: tonnes and distance summation (including null fields → 0)
 *   - aggregate: on_time / late classification including edge cases
 *   - aggregate: upsert behaviour — re-running same date overwrites row
 *   - aggregateRange: day count, single-day, multi-day, degenerate range
 *   - get: null before compute, row present after compute
 *   - getRange: empty array, populated array, date-ascending order
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must be set before any require of ../db ────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

// ── Stub helper ───────────────────────────────────────────────────

function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Mutable mock state (closures keep stubs live) ─────────────────

let _haulers = [];
let _trips   = {};   // keyed by hauler_id → trip[]

stub('../state/haulerStore',  { list: () => _haulers });
stub('../state/tripStore',    { forDateRange: (hid) => _trips[hid] ?? [] });
stub('../services/logger',   { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });

delete require.cache[require.resolve('../services/metricsAggregator')];
const ma = require('../services/metricsAggregator');

// ── Fixture helpers ───────────────────────────────────────────────

/** CYCLE_TARGET_MIN default = 26 × 60 = 1560 */
const TARGET = 1560;

let _seq = 0;
function uid()  { return `h-met-${++_seq}`; }
function date() { return `2026-03-${String((_seq % 28) + 1).padStart(2, '0')}`; }

function trip(overrides = {}) {
  return {
    direction:   'laden',
    tonnage_t:   25,
    distance_km: 300,
    duration_min: TARGET,    // exactly on threshold → on_time
    ...overrides,
  };
}

/** Set mock state for the current test */
function useData(haulers, trips) {
  _haulers = haulers;
  _trips   = trips;
}

// ── aggregate — basics ────────────────────────────────────────────

describe('metricsAggregator — aggregate basics', () => {
  it('returns 0 when hauler list is empty', () => {
    useData([], {});
    assert.equal(ma.aggregate('2026-01-01'), 0);
  });

  it('returns 0 when active haulers have no trips for the date', () => {
    const h = uid();
    useData([{ id: h }], {});   // no trips for h
    assert.equal(ma.aggregate(date()), 0);
  });

  it('returns count of haulers that had at least one trip', () => {
    const h1 = uid(), h2 = uid(), h3 = uid();
    useData(
      [{ id: h1 }, { id: h2 }, { id: h3 }],
      { [h1]: [trip()], [h2]: [trip()] },  // h3 has no trips
    );
    assert.equal(ma.aggregate(date()), 2);
  });
});

// ── aggregate — trip counters ─────────────────────────────────────

describe('metricsAggregator — aggregate trip counters', () => {
  it('trips_total reflects total trip count', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip(), trip(), trip()] });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.equal(row.trips_total, 3);
  });

  it('trips_laden counts trips with direction "laden"', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], {
      [h]: [trip({ direction: 'laden' }), trip({ direction: 'laden' }), trip({ direction: 'empty' })],
    });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).trips_laden, 2);
  });

  it('trips_empty counts trips with direction "empty"', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], {
      [h]: [trip({ direction: 'laden' }), trip({ direction: 'empty' }), trip({ direction: 'empty' })],
    });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).trips_empty, 2);
  });

  it('trips_laden + trips_empty = trips_total', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], {
      [h]: [trip({ direction: 'laden' }), trip({ direction: 'empty' }), trip({ direction: 'laden' })],
    });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.equal(row.trips_laden + row.trips_empty, row.trips_total);
  });
});

// ── aggregate — tonnage and distance ─────────────────────────────

describe('metricsAggregator — aggregate tonnage and distance', () => {
  it('tonnes_total sums tonnage_t across all trips', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ tonnage_t: 25 }), trip({ tonnage_t: 30 })] });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).tonnes_total, 55);
  });

  it('null tonnage_t is treated as 0 in the sum', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ tonnage_t: null }), trip({ tonnage_t: 20 })] });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).tonnes_total, 20);
  });

  it('distance_km sums distance_km across all trips', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ distance_km: 300 }), trip({ distance_km: 300 })] });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).distance_km, 600);
  });

  it('null distance_km is treated as 0 in the sum', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ distance_km: null }), trip({ distance_km: 150 })] });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).distance_km, 150);
  });
});

// ── aggregate — on-time / late classification ─────────────────────

describe('metricsAggregator — on-time / late classification', () => {
  it(`duration_min = ${TARGET} (at threshold) is on-time`, () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ duration_min: TARGET })] });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.equal(row.on_time_count, 1);
    assert.equal(row.late_count,    0);
  });

  it(`duration_min = ${TARGET + 1} (just over) is late`, () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ duration_min: TARGET + 1 })] });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.equal(row.on_time_count, 0);
    assert.equal(row.late_count,    1);
  });

  it('duration_min = null is neither on-time nor late (Infinity / 0 guards)', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ duration_min: null })] });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.equal(row.on_time_count, 0);
    assert.equal(row.late_count,    0);
  });

  it('mix: on_time + late <= trips_total (nulls account for remainder)', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], {
      [h]: [
        trip({ duration_min: TARGET - 100 }), // on_time
        trip({ duration_min: TARGET + 100 }), // late
        trip({ duration_min: null }),          // neither
      ],
    });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.equal(row.on_time_count, 1);
    assert.equal(row.late_count,    1);
    assert.equal(row.trips_total,   3);
  });
});

// ── aggregate — upsert ────────────────────────────────────────────

describe('metricsAggregator — upsert behaviour', () => {
  it('re-running the same date overwrites the existing row', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ tonnage_t: 25 })] });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).tonnes_total, 25);

    // Now update the mock trips and re-aggregate
    useData([{ id: h }], { [h]: [trip({ tonnage_t: 50 }), trip({ tonnage_t: 50 })] });
    ma.aggregate(d);
    assert.equal(ma.get(h, d).tonnes_total, 100);
    assert.equal(ma.get(h, d).trips_total,  2);
  });
});

// ── aggregateRange ────────────────────────────────────────────────

describe('metricsAggregator — aggregateRange', () => {
  it('returns 1 for a single-day range (from === to)', () => {
    useData([], {});
    assert.equal(ma.aggregateRange('2026-04-01', '2026-04-01'), 1);
  });

  it('returns 7 for a week-long range', () => {
    useData([], {});
    assert.equal(ma.aggregateRange('2026-04-01', '2026-04-07'), 7);
  });

  it('aggregates all days in range — data appears for each day', () => {
    const h = uid();
    useData([{ id: h }], { [h]: [trip({ tonnage_t: 30 })] });
    ma.aggregateRange('2026-05-10', '2026-05-12');
    // All three days should have a metrics row (trips were provided)
    assert.ok(ma.get(h, '2026-05-10') !== null, 'metrics missing for 2026-05-10');
    assert.ok(ma.get(h, '2026-05-11') !== null, 'metrics missing for 2026-05-11');
    assert.ok(ma.get(h, '2026-05-12') !== null, 'metrics missing for 2026-05-12');
  });

  it('returns 0 and runs no aggregations when from > to', () => {
    useData([], {});
    assert.equal(ma.aggregateRange('2026-04-10', '2026-04-01'), 0);
  });
});

// ── get ───────────────────────────────────────────────────────────

describe('metricsAggregator — get', () => {
  it('returns null for a hauler/date with no computed metrics', () => {
    assert.equal(ma.get('nonexistent-hauler', '2026-12-31'), null);
  });

  it('returns the stored row after aggregate()', () => {
    const h = uid(); const d = date();
    useData([{ id: h }], { [h]: [trip({ tonnage_t: 42, distance_km: 300 })] });
    ma.aggregate(d);
    const row = ma.get(h, d);
    assert.ok(row !== null, 'expected a non-null row');
    assert.equal(row.hauler_id,   h);
    assert.equal(row.date,        d);
    assert.equal(row.tonnes_total, 42);
    assert.equal(row.distance_km,  300);
  });
});

// ── getRange ──────────────────────────────────────────────────────

describe('metricsAggregator — getRange', () => {
  it('returns an empty array when no metrics have been computed', () => {
    const rows = ma.getRange('never-seen', '2026-01-01', '2026-01-31');
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });

  it('returns rows for days in range after aggregation', () => {
    const h = uid();
    useData([{ id: h }], { [h]: [trip()] });
    ma.aggregateRange('2026-06-01', '2026-06-03');
    const rows = ma.getRange(h, '2026-06-01', '2026-06-03');
    assert.equal(rows.length, 3);
  });

  it('rows are ordered by date ascending', () => {
    const h = uid();
    useData([{ id: h }], { [h]: [trip()] });
    ma.aggregateRange('2026-07-01', '2026-07-05');
    const rows = ma.getRange(h, '2026-07-01', '2026-07-05');
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].date >= rows[i - 1].date,
        `dates out of order: ${rows[i - 1].date} then ${rows[i].date}`);
    }
  });

  it('does not return rows outside the requested range', () => {
    const h = uid();
    useData([{ id: h }], { [h]: [trip()] });
    ma.aggregateRange('2026-08-01', '2026-08-10'); // 10 days total
    const rows = ma.getRange(h, '2026-08-03', '2026-08-07'); // only 5 days
    assert.equal(rows.length, 5);
  });
});
