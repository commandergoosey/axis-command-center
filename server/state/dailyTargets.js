'use strict';

/*
 * dailyTargets — Phase 112.
 *
 * Per-day operational throughput targets. axis_admin / axis_ops set the
 * daily tonne target for the corridor; the Today briefing computes actual
 * vs target from live convoy dispatch data.
 *
 * Schema
 *   date          TEXT PRIMARY KEY  — YYYY-MM-DD (UTC = Africa/Accra)
 *   target_tonnes REAL NOT NULL
 *   set_by        TEXT              — display name of the setter
 *   set_at        TEXT NOT NULL     — ISO-8601 timestamp
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_targets (
    date          TEXT PRIMARY KEY,
    target_tonnes REAL NOT NULL,
    set_by        TEXT,
    set_at        TEXT NOT NULL
  )
`);

const upsertStmt = db.prepare(`
  INSERT INTO daily_targets (date, target_tonnes, set_by, set_at)
  VALUES (@date, @target_tonnes, @set_by, @set_at)
  ON CONFLICT (date) DO UPDATE SET
    target_tonnes = excluded.target_tonnes,
    set_by        = excluded.set_by,
    set_at        = excluded.set_at
`);

const getStmt = db.prepare(`SELECT * FROM daily_targets WHERE date = ?`);

/**
 * Returns today's date key in YYYY-MM-DD format (UTC = Accra).
 */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  /**
   * Set or update the daily target for a specific date.
   * @param {string} date   — YYYY-MM-DD
   * @param {number} tonnes — positive number
   * @param {{ by_name?: string }} opts
   * @returns {object} The persisted row.
   */
  setTarget(date, tonnes, opts = {}) {
    const row = {
      date,
      target_tonnes: Number(tonnes),
      set_by:        opts.by_name ?? null,
      set_at:        new Date().toISOString(),
    };
    upsertStmt.run(row);
    return row;
  },

  /**
   * Get the target for a specific date, or null if not set.
   * @param {string} date — YYYY-MM-DD
   * @returns {object|null}
   */
  getTarget(date) {
    return getStmt.get(date) ?? null;
  },

  todayKey,
};
