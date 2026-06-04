'use strict';

/*
 * Event processor — LP-11 / LP-13.
 *
 * Consumes unprocessed rows from webhook_events and normalises them into
 * the trips and vehicle_positions tables. Also evaluates alert rules
 * (LP-13) and dispatches notifications (LP-14) for violations.
 *
 * Called:
 *   - Inline by the webhook route after each batch insert (fast path).
 *   - By processPending() on a background interval to catch any backlog.
 *
 * A row is marked processed=1 once all downstream actions succeed.
 * Failures are logged but don't block the batch — the row remains
 * unprocessed and will be retried on the next run.
 */

const db            = require('../db');
const tripStore     = require('../state/tripStore');
const positionStore = require('../state/positionStore');
const fleetStore    = require('../state/fleetStore');
const driverStore   = require('../state/driverStore');
const alertEngine   = require('./alertEngine');
const eventBus      = require('./eventBus');
const log           = require('./logger');

const stmts = {
  pending:     db.prepare(`
    SELECT * FROM webhook_events
    WHERE processed = 0
    ORDER BY received_at ASC
    LIMIT 100
  `),
  markDone:    db.prepare('UPDATE webhook_events SET processed = 1 WHERE id = ?'),
  markFailed:  db.prepare('UPDATE webhook_events SET processed = -1 WHERE id = ?'),
};

/**
 * Process a single webhook event row.
 * Returns true on success, false on error.
 */
function processOne(evt) {
  let payload;
  try {
    payload = JSON.parse(evt.raw_json);
  } catch {
    log.warn('Event processor: invalid JSON in webhook_events', { id: evt.id });
    stmts.markFailed.run(evt.id); // malformed JSON will never parse; mark permanently failed
    return false;
  }

  try {
    switch (evt.event_type) {
      case 'trip_start':
        handleTripStart(evt, payload);
        break;
      case 'trip_end':
        handleTripEnd(evt, payload);
        break;
      case 'position':
        handlePosition(evt, payload);
        break;
      case 'alert':
        handleAlert(evt, payload);
        break;
      default:
        // Unknown types are stored but not processed further.
        break;
    }

    stmts.markDone.run(evt.id);
    return true;
  } catch (err) {
    log.error('Event processor: failed to process event', {
      id: evt.id,
      type: evt.event_type,
      err: err.message,
    });
    stmts.markFailed.run(evt.id);
    return false;
  }
}

/* ── Corridor geography ──────────────────────────────────────────── */

// LP-33: Nyinahin–Takoradi corridor bounding box.
// Positions outside this box trigger a route_deviation alert.
const CORRIDOR_BOUNDS = {
  latMin: parseFloat(process.env.CORRIDOR_LAT_MIN ?? '4.2'),
  latMax: parseFloat(process.env.CORRIDOR_LAT_MAX ?? '7.5'),
  lonMin: parseFloat(process.env.CORRIDOR_LON_MIN ?? '-3.5'),
  lonMax: parseFloat(process.env.CORRIDOR_LON_MAX ?? '-1.0'),
};

// LP-37: Known waypoints for geofence proximity detection (radius in km).
const GEOFENCE_WAYPOINTS = [
  { id: 'mine_gate',    name: 'Nyinahin Mine Gate', lat: 6.834, lon: -2.054, radius_km: 2.0 },
  { id: 'port_gate',   name: 'Takoradi Port Gate',  lat: 4.892, lon: -1.755, radius_km: 2.0 },
  { id: 'weighbridge', name: 'Weighbridge Station', lat: 5.950, lon: -2.100, radius_km: 1.5 },
];

// LP-34: Fuel consumption and cost parameters (env-configurable).
const FUEL_L_PER_100KM = parseFloat(process.env.FUEL_L_PER_100KM ?? '42');
const DIESEL_USD_PER_L = parseFloat(process.env.DIESEL_USD_PER_L  ?? '1.25');

/* ── Haversine helper ────────────────────────────────────────────── */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Event handlers ──────────────────────────────────────────────── */

/* LP-28 — Trip deduplication window (minutes).
 * If an in_progress trip for this vehicle was created within this window,
 * the trip_start is treated as a duplicate (FMS poller + push webhook overlap)
 * and silently suppressed. */
const DEDUP_WIN_MIN = parseInt(process.env.TRIP_DEDUP_WINDOW_MIN ?? '30', 10);

function handleTripStart(evt, payload) {
  const vehicleId = payload.vehicle_id ?? payload.vehicleId ?? null;

  // LP-28: dedup check — skip if an open trip was started within the window.
  if (vehicleId) {
    const existing = tripStore.findOpenByVehicle(vehicleId);
    if (existing) {
      const sinceMs = Date.now() - new Date(existing.departed_at ?? existing.created_at).getTime();
      if (sinceMs < DEDUP_WIN_MIN * 60_000) {
        log.debug('Event processor: duplicate trip_start suppressed', {
          vehicle_id: vehicleId, existing_trip: existing.id, source: evt.source,
        });
        return;
      }
    }
  }

  const trip = tripStore.create({
    hauler_id:    evt.hauler_id,
    vehicle_id:   vehicleId,
    driver_id:    payload.driver_id   ?? null,
    direction:    payload.direction   ?? inferDirection(payload),
    origin:       payload.origin      ?? payload.start_location ?? null,
    destination:  payload.destination ?? payload.end_location   ?? null,
    departed_at:  payload.timestamp   ?? payload.started_at     ?? null,
    tonnage_t:    payload.tonnage_t   ?? payload.weight_t        ?? null,
    axle_load_pct: payload.axle_load_pct ?? null,
    source:       evt.source,
    raw_event_id: evt.id,
  });

  // LP-45: link to convoy if convoy_id is present in the payload.
  if (trip && (payload.convoy_id ?? null)) {
    try { tripStore.update(trip.id, { convoy_id: String(payload.convoy_id) }); } catch (_) {}
  }

  if (trip) {
    eventBus.emit('trip_started', { trip });
    // LP-27: mark truck as en_route.
    if (vehicleId) {
      try {
        const truck = fleetStore.findByPlate(vehicleId);
        if (truck) fleetStore.setStatus(truck.id, 'en_route');
      } catch (_) {} // non-fatal
    }
  }

  // Update position from the trip-start event if coordinates are present.
  if (vehicleId && payload.latitude != null) {
    positionStore.upsert({
      vehicle_id:  vehicleId,
      hauler_id:   evt.hauler_id,
      latitude:    payload.latitude,
      longitude:   payload.longitude,
      speed_kmh:   payload.speed_kmh  ?? 0,
      heading_deg: payload.heading    ?? null,
      position_at: payload.timestamp  ?? null,
    });
  }
}

function handleTripEnd(evt, payload) {
  const vehicleId = payload.vehicle_id ?? payload.vehicleId ?? null;
  let closed;

  // Match to the most recent open trip for this vehicle.
  const openTrip = vehicleId ? tripStore.findOpenByVehicle(vehicleId) : null;
  if (openTrip) {
    closed = tripStore.close(openTrip.id, {
      arrived_at:   payload.timestamp  ?? payload.ended_at ?? null,
      distance_km:  payload.distance_km ?? null,
      tonnage_t:    payload.tonnage_t   ?? payload.weight_t ?? null,
    });
  } else {
    // No matching open trip — create a completed one directly.
    const created = tripStore.create({
      hauler_id:    evt.hauler_id,
      vehicle_id:   vehicleId,
      direction:    payload.direction ?? inferDirection(payload),
      departed_at:  payload.started_at ?? null,
      tonnage_t:    payload.tonnage_t  ?? null,
      source:       evt.source,
      raw_event_id: evt.id,
    });
    closed = tripStore.close(created.id, {
      arrived_at:   payload.timestamp ?? payload.ended_at ?? null,
      distance_km:  payload.distance_km ?? null,
    });
  }

  if (closed) {
    // LP-34: Estimate fuel burn and trip cost, store in DB.
    try {
      const distKm = closed.distance_km ?? payload.distance_km ?? null;
      if (distKm && distKm > 0) {
        const fuelL    = Number((distKm * FUEL_L_PER_100KM / 100).toFixed(1));
        const costUsd  = Number((fuelL * DIESEL_USD_PER_L).toFixed(2));
        tripStore.update(closed.id, { estimated_fuel_l: fuelL, estimated_cost_usd: costUsd });
        closed.estimated_fuel_l    = fuelL;
        closed.estimated_cost_usd  = costUsd;
      }
    } catch (_) {} // non-fatal

    eventBus.emit('trip_completed', { trip: closed });

    // LP-39: update driver scorecard counters on completion.
    if (closed.driver_id) {
      try { driverStore.updateScorecard(closed.driver_id, { duration_min: closed.duration_min }); }
      catch (_) {} // non-fatal
    }

    // LP-27: revert truck status to idle.
    const closedVehicle = payload.vehicle_id ?? payload.vehicleId ?? null;
    if (closedVehicle) {
      try {
        const truck = fleetStore.findByPlate(closedVehicle);
        if (truck) fleetStore.setStatus(truck.id, 'idle');
      } catch (_) {} // non-fatal
    }
  }
}

function handlePosition(evt, payload) {
  const vehicleId = payload.vehicle_id ?? payload.vehicleId ?? null;
  if (!vehicleId) return;

  positionStore.upsert({
    vehicle_id:  vehicleId,
    hauler_id:   evt.hauler_id,
    latitude:    payload.latitude  ?? null,
    longitude:   payload.longitude ?? null,
    speed_kmh:   payload.speed_kmh ?? payload.speed ?? null,
    heading_deg: payload.heading   ?? null,
    position_at: payload.timestamp ?? null,
  });

  eventBus.emit('position_update', {
    vehicle_id: vehicleId,
    hauler_id:  evt.hauler_id,
    latitude:   payload.latitude  ?? null,
    longitude:  payload.longitude ?? null,
    speed_kmh:  payload.speed_kmh ?? payload.speed ?? null,
  });

  // LP-13 — evaluate speed rules against this position event.
  if (payload.speed_kmh != null) {
    alertEngine.evaluate({
      rule_type:  'speed',
      value:      payload.speed_kmh,
      hauler_id:  evt.hauler_id,
      vehicle_id: vehicleId,
      meta:       { lat: payload.latitude, lng: payload.longitude, event_id: evt.id },
    });
  }

  const lat = payload.latitude;
  const lon = payload.longitude;

  // LP-33 — route deviation: flag if position is outside corridor bounding box.
  if (lat != null && lon != null) {
    const outside = lat < CORRIDOR_BOUNDS.latMin || lat > CORRIDOR_BOUNDS.latMax
                 || lon < CORRIDOR_BOUNDS.lonMin || lon > CORRIDOR_BOUNDS.lonMax;
    if (outside) {
      alertEngine.evaluate({
        rule_type:  'route_deviation',
        value:      1,
        hauler_id:  evt.hauler_id,
        vehicle_id: vehicleId,
        meta:       { lat, lng: lon, event_id: evt.id },
      });
    }
  }

  // LP-37 — geofence proximity: emit event when vehicle enters a waypoint radius.
  if (lat != null && lon != null) {
    for (const wp of GEOFENCE_WAYPOINTS) {
      const distKm = haversineKm(lat, lon, wp.lat, wp.lon);
      if (distKm <= wp.radius_km) {
        eventBus.emit('geofence_entry', {
          vehicle_id: vehicleId,
          hauler_id:  evt.hauler_id,
          waypoint_id:   wp.id,
          waypoint_name: wp.name,
          distance_km:   Number(distKm.toFixed(3)),
          lat, lon,
        });
        break; // only fire one waypoint per position update
      }
    }
  }
}

function handleAlert(evt, payload) {
  // Adapter-sourced alert (Loconav ALERT event). Pass through to alert engine
  // using the alert_type field if present, otherwise 'device_alert'.
  alertEngine.evaluate({
    rule_type:  payload.alert_type ?? 'device_alert',
    value:      payload.value      ?? 0,
    hauler_id:  evt.hauler_id,
    vehicle_id: payload.vehicle_id ?? null,
    meta:       { raw: payload, event_id: evt.id },
  });
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function inferDirection(payload) {
  // Loconav trip payloads sometimes include a load_type field.
  const lt = (payload.load_type ?? '').toLowerCase();
  if (lt === 'laden' || lt === 'loaded') return 'laden';
  if (lt === 'empty' || lt === 'unloaded') return 'empty';
  // Guess from origin: Nyinahin is the mine (laden outbound), Takoradi is port.
  const origin = (payload.origin ?? payload.start_location ?? '').toLowerCase();
  if (origin.includes('nyinahin')) return 'laden';
  if (origin.includes('takoradi')) return 'empty';
  return 'laden'; // safe default
}

/* ── Batch processor ─────────────────────────────────────────────── */

/** Process up to 100 pending events. Returns { processed, failed } counts. */
function processPending() {
  const rows = stmts.pending.all();
  if (rows.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed    = 0;

  for (const row of rows) {
    if (processOne(row)) processed++;
    else                  failed++;
  }

  if (processed > 0 || failed > 0) {
    log.info('Event processor: batch complete', { processed, failed, total: rows.length });
  }

  return { processed, failed };
}

/**
 * Process a specific set of newly-inserted event IDs immediately.
 * Called by the webhook route after a successful batch insert so newly
 * received events are acted on without waiting for the next poll cycle.
 */
function processIds(ids) {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT * FROM webhook_events WHERE id IN (${placeholders}) AND processed = 0`,
  ).all(...ids);
  // Preserve the caller's ID order so trip_start is always processed before
  // trip_end when both are passed in the same batch.
  const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    if (rowById[id]) processOne(rowById[id]);
  }
}

module.exports = { processPending, processIds };
