'use strict';

/*
 * Metrics aggregator — LP-15.
 *
 * Computes per-hauler daily metrics from the `trips` table and upserts them
 * into `hauler_daily_metrics`. Run nightly via the schedule runner.
 *
 * aggregate(date?) — aggregate for a given YYYY-MM-DD (defaults to yesterday).
 * aggregateRange(from, to) — aggregate over a date range (for backfill).
 *
 * On_time heuristic: a trip is considered on-time if duration_min ≤ the
 * corridor's target cycle time (CYCLE_TARGET_HOURS * 60). For the
 * Nyinahin–Takoradi corridor the target is 26 hours round-trip (≈ 780 min).
 */

const db          = require('../db');
const haulerStore = require('../state/haulerStore');
const tripStore   = require('../state/tripStore');
const log         = require('./logger');

const CYCLE_TARGET_MIN = parseInt(process.env.CYCLE_TARGET_HOURS ?? '26', 10) * 60;

const stmtUpsert = db.prepare(`
  INSERT INTO hauler_daily_metrics
    (hauler_id, date, trips_total, trips_laden, trips_empty,
     tonnes_total, distance_km, on_time_count, late_count, computed_at)
  VALUES
    (@hauler_id, @date, @trips_total, @trips_laden, @trips_empty,
     @tonnes_total, @distance_km, @on_time_count, @late_count, @computed_at)
  ON CONFLICT(hauler_id, date) DO UPDATE SET
    trips_total   = excluded.trips_total,
    trips_laden   = excluded.trips_laden,
    trips_empty   = excluded.trips_empty,
    tonnes_total  = excluded.tonnes_total,
    distance_km   = excluded.distance_km,
    on_time_count = excluded.on_time_count,
    late_count    = excluded.late_count,
    computed_at   = excluded.computed_at
`);

const stmtForHaulerDate = db.prepare(`
  SELECT * FROM hauler_daily_metrics WHERE hauler_id = ? AND date = ?
`);

const stmtRange = db.prepare(`
  SELECT * FROM hauler_daily_metrics
  WHERE hauler_id = ? AND date >= ? AND date <= ?
  ORDER BY date ASC
`);

/** Aggregate one date for all active haulers. */
function aggregate(date) {
  const d = date ?? yesterday();
  log.info('Metrics aggregator: aggregating', { date: d });

  const haulers   = haulerStore.list();
  const fromISO   = `${d}T00:00:00.000Z`;
  const toISO     = `${d}T23:59:59.999Z`;
  const computedAt = new Date().toISOString();
  let   count     = 0;

  for (const h of haulers) {
    const trips = tripStore.forDateRange(h.id, fromISO, toISO);
    if (trips.length === 0) continue;

    const metrics = {
      hauler_id:    h.id,
      date:         d,
      trips_total:  trips.length,
      trips_laden:  trips.filter((t) => t.direction === 'laden').length,
      trips_empty:  trips.filter((t) => t.direction === 'empty').length,
      tonnes_total: trips.reduce((s, t) => s + (t.tonnage_t ?? 0), 0),
      distance_km:  trips.reduce((s, t) => s + (t.distance_km ?? 0), 0),
      on_time_count: trips.filter((t) => (t.duration_min ?? Infinity) <= CYCLE_TARGET_MIN).length,
      late_count:   trips.filter((t) => (t.duration_min ?? 0) > CYCLE_TARGET_MIN).length,
      computed_at:  computedAt,
    };

    stmtUpsert.run(metrics);
    count++;
  }

  log.info('Metrics aggregator: done', { date: d, haulers_updated: count });
  return count;
}

/** Aggregate every date in [from, to] inclusive. */
function aggregateRange(from, to) {
  const dates = [];
  const cur   = new Date(`${from}T00:00:00Z`);
  const end   = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  for (const d of dates) aggregate(d);
  return dates.length;
}

/** Get pre-computed metrics for one hauler + date. Returns null if not yet computed. */
function get(hauler_id, date) {
  return stmtForHaulerDate.get(hauler_id, date) ?? null;
}

/** Get pre-computed metrics over a date range. */
function getRange(hauler_id, from, to) {
  return stmtRange.all(hauler_id, from, to);
}

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { aggregate, aggregateRange, get, getRange };
