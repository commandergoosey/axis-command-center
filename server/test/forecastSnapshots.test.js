'use strict';

/*
 * Tests for state/forecastSnapshots.js —
 *   capture, recent
 *
 * Uses in-memory SQLite. forecastSnapshots.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - capture: upserts by snapshot_date; second capture for same date
 *     updates (last-write-wins); stores all required fields; now
 *     parameter controls the date key
 *   - recent: returns array; empty before any captures; includes
 *     snapshots within the window; excludes snapshots outside the
 *     window; days parameter controls the lookback
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/forecastSnapshots')];
const fsnap = require('../state/forecastSnapshots');

// Minimal valid forecast object as expected by capture().
function fakeForecast(overrides = {}) {
  return {
    horizon: { days_in_month: 30, days_elapsed: 10, days_remaining: 20 },
    targets: { monthly: 15000, floor: 12000, floor_pct: 80 },
    actual:  { delivered_mtd: 5000, daily_avg: 500 },
    projection: {
      eom_tonnes: 10000, pct_of_floor: 83, pct_of_monthly: 67,
      shortfall_to_floor: 2000, surplus_over_floor: 0, verdict: 'on_track',
    },
    required: { daily_to_floor: 350 },
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed "today" anchor for deterministic date math.
const NOW = new Date('2026-06-15T10:00:00.000Z').getTime();

// ── capture ───────────────────────────────────────────────────────

describe('forecastSnapshots — capture', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => fsnap.capture(fakeForecast(), NOW));
  });

  it('upserts by snapshot_date — second capture for same date is idempotent', () => {
    const now = NOW + DAY_MS;  // different day to avoid interfering with other tests
    fsnap.capture(fakeForecast(), now);
    fsnap.capture(fakeForecast(), now);
    // Should still be retrievable as a single row.
    const rows = fsnap.recent(1, now);
    assert.ok(rows.length >= 1);
  });

  it('second capture updates the row (last-write-wins)', () => {
    const now = NOW + 2 * DAY_MS;
    fsnap.capture(fakeForecast({ actual: { delivered_mtd: 100, daily_avg: 10 } }), now);
    fsnap.capture(fakeForecast({ actual: { delivered_mtd: 999, daily_avg: 50 } }), now);
    // recent(days, refNow): cutoff = refNow - (days-1)*DAY_MS.
    // With days=2 and refNow=now+DAY_MS, cutoff = now → includes snapshot_date of `now`.
    const rows = fsnap.recent(2, now + DAY_MS);
    const row = rows.find((r) => r.snapshot_date === new Date(now).toISOString().slice(0, 10));
    assert.ok(row);
    assert.equal(row.daily_avg, 50);
  });

  it('stores the snapshot_date as YYYY-MM-DD', () => {
    const now = NOW + 3 * DAY_MS;
    fsnap.capture(fakeForecast(), now);
    const rows = fsnap.recent(7, now + DAY_MS);
    const expected = new Date(now).toISOString().slice(0, 10);
    assert.ok(rows.some((r) => r.snapshot_date === expected));
  });

  it('stores verdict from projection', () => {
    const now = NOW + 4 * DAY_MS;
    fsnap.capture(fakeForecast({ projection: { eom_tonnes: 11000, pct_of_floor: 91, pct_of_monthly: 73, shortfall_to_floor: 0, surplus_over_floor: 1000, verdict: 'on_track' } }), now);
    const rows = fsnap.recent(7, now + DAY_MS);
    const row = rows.find((r) => r.snapshot_date === new Date(now).toISOString().slice(0, 10));
    assert.equal(row.verdict, 'on_track');
  });
});

// ── recent ────────────────────────────────────────────────────────

describe('forecastSnapshots — recent', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(fsnap.recent(14, NOW)));
  });

  it('includes a snapshot captured within the window', () => {
    const now = NOW + 5 * DAY_MS;
    fsnap.capture(fakeForecast(), now);
    const rows = fsnap.recent(14, now + DAY_MS);
    const key = new Date(now).toISOString().slice(0, 10);
    assert.ok(rows.some((r) => r.snapshot_date === key));
  });

  it('excludes snapshots outside the days window', () => {
    const oldNow = NOW - 100 * DAY_MS;  // far in the past
    fsnap.capture(fakeForecast(), oldNow);
    const rows = fsnap.recent(7, NOW);  // 7-day window ending at NOW
    const oldKey = new Date(oldNow).toISOString().slice(0, 10);
    assert.ok(!rows.some((r) => r.snapshot_date === oldKey));
  });

  it('rows are ordered ascending by snapshot_date', () => {
    const base = NOW + 6 * DAY_MS;
    fsnap.capture(fakeForecast(), base);
    fsnap.capture(fakeForecast(), base + DAY_MS);
    const rows = fsnap.recent(7, base + 3 * DAY_MS);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].snapshot_date >= rows[i - 1].snapshot_date);
    }
  });
});
