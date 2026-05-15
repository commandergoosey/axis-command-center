'use strict';

/*
 * Forecast snapshots — Phase 43.
 *
 * Phase 42 gave the operator a point-in-time projection of month-end
 * tonnes. The natural next question — "did my day move the line?" — is
 * what this module answers. Every time the /api/today/forecast route is
 * hit (which happens on every Today page load and every digest export),
 * we upsert a row keyed to (year, month, day) with the latest projection
 * fields. Last-write-wins, so the row always reflects the freshest read
 * for that calendar day.
 *
 * The trend endpoint then reads the last N rows so the UI can sparkline
 * "projected EOM over the last 14 days against the floor line." This
 * gives forward-looking accountability — operators see whether yesterday's
 * dispatch decisions improved or eroded the projection.
 *
 * Schema is created idempotently here so prod can ship the migration
 * without touching db/index.js (matching the rest of the state overlays).
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS forecast_snapshots (
    snapshot_date         TEXT PRIMARY KEY,   -- 'YYYY-MM-DD' (UTC)
    captured_at           TEXT NOT NULL,
    days_in_month         INTEGER NOT NULL,
    days_elapsed          INTEGER NOT NULL,
    days_remaining        INTEGER NOT NULL,
    monthly_target        INTEGER NOT NULL,
    floor_target          INTEGER NOT NULL,
    floor_pct             REAL    NOT NULL,
    delivered_mtd         INTEGER NOT NULL,
    daily_avg             INTEGER NOT NULL,
    eom_tonnes            INTEGER NOT NULL,
    pct_of_floor          REAL    NOT NULL,
    pct_of_monthly        REAL    NOT NULL,
    shortfall_to_floor    INTEGER NOT NULL,
    surplus_over_floor    INTEGER NOT NULL,
    required_daily_floor  INTEGER NOT NULL,
    verdict               TEXT    NOT NULL
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO forecast_snapshots (
    snapshot_date, captured_at, days_in_month, days_elapsed, days_remaining,
    monthly_target, floor_target, floor_pct,
    delivered_mtd, daily_avg, eom_tonnes,
    pct_of_floor, pct_of_monthly,
    shortfall_to_floor, surplus_over_floor, required_daily_floor, verdict
  ) VALUES (
    @snapshot_date, @captured_at, @days_in_month, @days_elapsed, @days_remaining,
    @monthly_target, @floor_target, @floor_pct,
    @delivered_mtd, @daily_avg, @eom_tonnes,
    @pct_of_floor, @pct_of_monthly,
    @shortfall_to_floor, @surplus_over_floor, @required_daily_floor, @verdict
  )
  ON CONFLICT(snapshot_date) DO UPDATE SET
    captured_at          = excluded.captured_at,
    days_in_month        = excluded.days_in_month,
    days_elapsed         = excluded.days_elapsed,
    days_remaining       = excluded.days_remaining,
    monthly_target       = excluded.monthly_target,
    floor_target         = excluded.floor_target,
    floor_pct            = excluded.floor_pct,
    delivered_mtd        = excluded.delivered_mtd,
    daily_avg            = excluded.daily_avg,
    eom_tonnes           = excluded.eom_tonnes,
    pct_of_floor         = excluded.pct_of_floor,
    pct_of_monthly       = excluded.pct_of_monthly,
    shortfall_to_floor   = excluded.shortfall_to_floor,
    surplus_over_floor   = excluded.surplus_over_floor,
    required_daily_floor = excluded.required_daily_floor,
    verdict              = excluded.verdict
`);

const recentStmt = db.prepare(`
  SELECT * FROM forecast_snapshots
   WHERE snapshot_date >= ?
   ORDER BY snapshot_date ASC
`);

function dateKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

// Capture (upsert) today's projection. Idempotent — Today page reload,
// digest export, lender refresh all collapse to a single per-day row.
function capture(forecast, now = Date.now()) {
  upsertStmt.run({
    snapshot_date:        dateKey(now),
    captured_at:          new Date(now).toISOString(),
    days_in_month:        forecast.horizon.days_in_month,
    days_elapsed:         forecast.horizon.days_elapsed,
    days_remaining:       forecast.horizon.days_remaining,
    monthly_target:       forecast.targets.monthly,
    floor_target:         forecast.targets.floor,
    floor_pct:            forecast.targets.floor_pct,
    delivered_mtd:        forecast.actual.delivered_mtd,
    daily_avg:            forecast.actual.daily_avg,
    eom_tonnes:           forecast.projection.eom_tonnes,
    pct_of_floor:         forecast.projection.pct_of_floor,
    pct_of_monthly:       forecast.projection.pct_of_monthly,
    shortfall_to_floor:   forecast.projection.shortfall_to_floor,
    surplus_over_floor:   forecast.projection.surplus_over_floor,
    required_daily_floor: forecast.required.daily_to_floor,
    verdict:              forecast.projection.verdict,
  });
}

// Last `days` calendar days of snapshots, ascending. Caller is expected
// to handle gaps (early in a deployment we'll have only a few rows).
function recent(days = 14, now = Date.now()) {
  const cutoff = new Date(now - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return recentStmt.all(cutoff);
}

module.exports = { capture, recent };
