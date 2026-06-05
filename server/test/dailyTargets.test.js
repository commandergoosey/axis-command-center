'use strict';

/*
 * Tests for state/dailyTargets.js —
 *   setTarget, getTarget, todayKey
 *
 * Uses in-memory SQLite. dailyTargets.js creates its own daily_targets
 * table idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - setTarget: returns row with date/target_tonnes/set_by/set_at;
 *     updates existing row (upsert); set_at is a recent ISO; set_by
 *     stored or null when not provided
 *   - getTarget: null for unknown date; returns row for known date;
 *     target_tonnes reflects latest upsert
 *   - todayKey: returns a YYYY-MM-DD string; matches today's UTC date
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/dailyTargets')];
const dt = require('../state/dailyTargets');

// ── setTarget ─────────────────────────────────────────────────────

describe('dailyTargets — setTarget', () => {
  it('returns a row with expected fields', () => {
    const row = dt.setTarget('2026-06-01', 600);
    assert.ok('date' in row);
    assert.ok('target_tonnes' in row);
    assert.ok('set_at' in row);
  });

  it('stores the date', () => {
    const row = dt.setTarget('2026-06-02', 650);
    assert.equal(row.date, '2026-06-02');
  });

  it('stores target_tonnes as a number', () => {
    const row = dt.setTarget('2026-06-03', 700);
    assert.equal(row.target_tonnes, 700);
  });

  it('stores set_by when provided', () => {
    const row = dt.setTarget('2026-06-04', 500, { by_name: 'Night Op' });
    assert.equal(row.set_by, 'Night Op');
  });

  it('set_by is null when not provided', () => {
    const row = dt.setTarget('2026-06-05', 500);
    assert.equal(row.set_by, null);
  });

  it('set_at is a recent ISO string', () => {
    const before = Date.now();
    const row = dt.setTarget('2026-06-06', 500);
    const after = Date.now();
    const ts = new Date(row.set_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('upserts — second call updates the target for the same date', () => {
    dt.setTarget('2026-06-07', 400);
    dt.setTarget('2026-06-07', 800, { by_name: 'Day Op' });
    const row = dt.getTarget('2026-06-07');
    assert.equal(row.target_tonnes, 800);
    assert.equal(row.set_by, 'Day Op');
  });
});

// ── getTarget ─────────────────────────────────────────────────────

describe('dailyTargets — getTarget', () => {
  it('returns null for an unknown date', () => {
    assert.equal(dt.getTarget('1999-12-31'), null);
  });

  it('returns the row for a known date', () => {
    dt.setTarget('2026-06-10', 555);
    const row = dt.getTarget('2026-06-10');
    assert.ok(row !== null);
    assert.equal(row.date, '2026-06-10');
    assert.equal(row.target_tonnes, 555);
  });

  it('target_tonnes reflects the latest upsert', () => {
    dt.setTarget('2026-06-11', 100);
    dt.setTarget('2026-06-11', 999);
    assert.equal(dt.getTarget('2026-06-11').target_tonnes, 999);
  });
});

// ── todayKey ──────────────────────────────────────────────────────

describe('dailyTargets — todayKey', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const key = dt.todayKey();
    assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the current UTC date', () => {
    const key = dt.todayKey();
    const expected = new Date().toISOString().slice(0, 10);
    assert.equal(key, expected);
  });
});
