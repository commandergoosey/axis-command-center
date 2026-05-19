'use strict';

/*
 * Trip store — LP-11.
 *
 * Persists trip lifecycle events sourced from webhook ingestion,
 * the Loconav polling adapter, or manual CSV upload.
 *
 * Trips are created when a trip_start event is received, updated on position
 * events, and closed when trip_end arrives. The event processor
 * (services/eventProcessor.js) is the primary writer.
 */

const crypto = require('crypto');
const db     = require('../db');

function now() { return new Date().toISOString(); }
function newId() { return crypto.randomBytes(8).toString('hex'); }

const stmts = {
  insert: db.prepare(`
    INSERT INTO trips
      (id, hauler_id, vehicle_id, driver_id, status, direction,
       origin, destination, route_id, departed_at, arrived_at,
       duration_min, distance_km, tonnage_t, axle_load_pct,
       source, raw_event_id, created_at, updated_at)
    VALUES
      (@id, @hauler_id, @vehicle_id, @driver_id, @status, @direction,
       @origin, @destination, @route_id, @departed_at, @arrived_at,
       @duration_min, @distance_km, @tonnage_t, @axle_load_pct,
       @source, @raw_event_id, @created_at, @updated_at)
  `),

  byId: db.prepare('SELECT * FROM trips WHERE id = ?'),

  // Find the most recent in-progress trip for a vehicle (for trip_end matching).
  openByVehicle: db.prepare(`
    SELECT * FROM trips
    WHERE vehicle_id = @vehicle_id AND status = 'in_progress'
    ORDER BY departed_at DESC LIMIT 1
  `),

  list: db.prepare(`
    SELECT * FROM trips
    WHERE (:hauler_id IS NULL OR hauler_id = :hauler_id)
      AND (:status    IS NULL OR status    = :status)
    ORDER BY departed_at DESC
    LIMIT :limit OFFSET :offset
  `),

  count: db.prepare(`
    SELECT COUNT(*) AS n FROM trips
    WHERE (:hauler_id IS NULL OR hauler_id = :hauler_id)
      AND (:status    IS NULL OR status    = :status)
  `),

  close: db.prepare(`
    UPDATE trips
    SET status = 'completed',
        arrived_at   = @arrived_at,
        duration_min = @duration_min,
        distance_km  = @distance_km,
        tonnage_t    = @tonnage_t,
        updated_at   = @updated_at
    WHERE id = @id
  `),

  update: db.prepare(`
    UPDATE trips
    SET tonnage_t           = COALESCE(@tonnage_t,          tonnage_t),
        distance_km         = COALESCE(@distance_km,        distance_km),
        duration_min        = COALESCE(@duration_min,       duration_min),
        direction           = COALESCE(@direction,          direction),
        origin              = COALESCE(@origin,             origin),
        destination         = COALESCE(@destination,        destination),
        vehicle_id          = COALESCE(@vehicle_id,         vehicle_id),
        driver_id           = COALESCE(@driver_id,          driver_id),
        estimated_fuel_l    = COALESCE(@estimated_fuel_l,   estimated_fuel_l),
        estimated_cost_usd  = COALESCE(@estimated_cost_usd, estimated_cost_usd),
        convoy_id           = COALESCE(@convoy_id,          convoy_id),
        updated_at          = @updated_at
    WHERE id = @id
  `),

  // Recent trips for the metrics aggregator.
  forDateRange: db.prepare(`
    SELECT * FROM trips
    WHERE hauler_id = @hauler_id
      AND status = 'completed'
      AND departed_at >= @from
      AND departed_at <  @to
  `),
};

/** Create a new in-progress trip from a trip_start event. */
function create(fields) {
  const ts = now();
  const id = newId();
  stmts.insert.run({
    id,
    hauler_id:    fields.hauler_id,
    vehicle_id:   fields.vehicle_id   ?? null,
    driver_id:    fields.driver_id    ?? null,
    status:       'in_progress',
    direction:    fields.direction    ?? 'laden',
    origin:       fields.origin       ?? null,
    destination:  fields.destination  ?? null,
    route_id:     fields.route_id     ?? null,
    departed_at:  fields.departed_at  ?? ts,
    arrived_at:   null,
    duration_min: null,
    distance_km:  null,
    tonnage_t:    fields.tonnage_t    ?? null,
    axle_load_pct: fields.axle_load_pct ?? null,
    source:       fields.source       ?? 'webhook',
    raw_event_id: fields.raw_event_id ?? null,
    created_at:   ts,
    updated_at:   ts,
  });
  return stmts.byId.get(id);
}

/** Close an in-progress trip when trip_end is received. */
function close(id, fields = {}) {
  const ts        = now();
  const trip      = stmts.byId.get(id);
  const arrivedAt = fields.arrived_at ?? ts;
  let durationMin = fields.duration_min ?? null;
  if (!durationMin && trip?.departed_at) {
    durationMin = Math.round((new Date(arrivedAt) - new Date(trip.departed_at)) / 60_000);
  }
  stmts.close.run({
    id,
    arrived_at:   arrivedAt,
    duration_min: durationMin,
    distance_km:  fields.distance_km ?? null,
    tonnage_t:    fields.tonnage_t   ?? trip?.tonnage_t ?? null,
    updated_at:   ts,
  });
  return stmts.byId.get(id);
}

/** Find the open in-progress trip for a vehicle (for trip_end matching). */
function findOpenByVehicle(vehicle_id) {
  return stmts.openByVehicle.get({ vehicle_id }) ?? null;
}

/** List trips, optionally filtered. Returns { trips, total }. */
function list({ hauler_id = null, status = null, limit = 40, offset = 0 } = {}) {
  const params = { hauler_id, status, limit, offset };
  return {
    trips: stmts.list.all(params),
    total: stmts.count.get(params).n,
  };
}

/** Trips completed within a date range for a hauler (metrics aggregation). */
function forDateRange(hauler_id, from, to) {
  return stmts.forDateRange.all({ hauler_id, from, to });
}

/** Fetch a single trip by id. Returns null if not found. */
function findById(id) {
  return stmts.byId.get(id) ?? null;
}

/**
 * Update editable fields on a trip (manual correction).
 * All fields are optional — only non-null values overwrite existing data.
 * Returns the updated row, or null if not found.
 */
function update(id, fields = {}) {
  const ts = now();
  stmts.update.run({
    id,
    tonnage_t:          fields.tonnage_t          ?? null,
    distance_km:        fields.distance_km        ?? null,
    duration_min:       fields.duration_min       ?? null,
    direction:          fields.direction          ?? null,
    origin:             fields.origin             ?? null,
    destination:        fields.destination        ?? null,
    vehicle_id:         fields.vehicle_id         ?? null,
    driver_id:          fields.driver_id          ?? null,
    estimated_fuel_l:   fields.estimated_fuel_l   ?? null,
    estimated_cost_usd: fields.estimated_cost_usd ?? null,
    convoy_id:          fields.convoy_id          ?? null,
    updated_at:         ts,
  });
  return stmts.byId.get(id) ?? null;
}

module.exports = { create, close, findById, update, findOpenByVehicle, list, forDateRange };
