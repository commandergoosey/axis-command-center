'use strict';

/*
 * Position store — LP-11.
 *
 * Maintains the latest known GPS position for each vehicle. Upserted on
 * every position event received from the webhook pipeline or Loconav poller.
 * Used by the fleet list and corridor map to show live truck positions.
 */

const db = require('../db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO vehicle_positions
      (vehicle_id, hauler_id, latitude, longitude, speed_kmh, heading_deg, position_at, updated_at)
    VALUES
      (@vehicle_id, @hauler_id, @latitude, @longitude, @speed_kmh, @heading_deg, @position_at, @updated_at)
    ON CONFLICT(vehicle_id) DO UPDATE SET
      hauler_id   = excluded.hauler_id,
      latitude    = excluded.latitude,
      longitude   = excluded.longitude,
      speed_kmh   = excluded.speed_kmh,
      heading_deg = excluded.heading_deg,
      position_at = excluded.position_at,
      updated_at  = excluded.updated_at
    WHERE excluded.position_at >= vehicle_positions.position_at
       OR vehicle_positions.position_at IS NULL
  `),

  byVehicle:  db.prepare('SELECT * FROM vehicle_positions WHERE vehicle_id = ?'),
  byHauler:   db.prepare('SELECT * FROM vehicle_positions WHERE hauler_id = ? ORDER BY vehicle_id'),
  all:        db.prepare('SELECT * FROM vehicle_positions ORDER BY hauler_id, vehicle_id'),
  staleCount: db.prepare(`
    SELECT COUNT(*) AS n FROM vehicle_positions
    WHERE position_at < @cutoff OR position_at IS NULL
  `),
};

/** Upsert the latest position for a vehicle. Only advances forward in time. */
function upsert(fields) {
  const ts = new Date().toISOString();
  stmts.upsert.run({
    vehicle_id:  fields.vehicle_id,
    hauler_id:   fields.hauler_id,
    latitude:    fields.latitude    ?? null,
    longitude:   fields.longitude   ?? null,
    speed_kmh:   fields.speed_kmh   ?? null,
    heading_deg: fields.heading_deg ?? null,
    position_at: fields.position_at ?? ts,
    updated_at:  ts,
  });
}

/** Get the last known position for a single vehicle. */
function byVehicle(vehicle_id) {
  return stmts.byVehicle.get(vehicle_id) ?? null;
}

/** Get all latest positions for a hauler. */
function byHauler(hauler_id) {
  return stmts.byHauler.all(hauler_id);
}

/** Get all positions across all haulers. */
function all() {
  return stmts.all.all();
}

/**
 * How many vehicles have a stale (or no) position older than `maxAgeMinutes`.
 * Used by the health endpoint and corridor dashboard.
 */
function staleCount(maxAgeMinutes = 30) {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  return stmts.staleCount.get({ cutoff }).n;
}

module.exports = { upsert, byVehicle, byHauler, all, staleCount };
