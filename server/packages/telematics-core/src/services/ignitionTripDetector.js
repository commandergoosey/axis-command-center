'use strict';

/*
 * Ignition-based trip detector.
 *
 * Listens to ignition_on / ignition_off events on the bus (emitted by
 * deviceEventNormaliser) and manages trip lifecycle using the consuming app's
 * trips table via the shared db instance.
 *
 * Writes directly to the trips table — no import from the consuming app.
 * Trip rows created here are identical to those created by eventProcessor.js
 * so all downstream route handlers and aggregators work unchanged.
 *
 * State machine per vehicle (held in memory):
 *   idle        → ignition_on  → in_trip (trip created, trip_started emitted)
 *   in_trip     → ignition_off → waiting_idle (idle timer started)
 *   waiting_idle→ ignition_on  → in_trip (timer cancelled, trip continues)
 *   waiting_idle→ timer fires  → idle (trip closed, trip_completed emitted)
 *
 * Edge cases:
 *   - ignition_off with no open trip → log, no-op
 *   - ignition_on with an already-open trip → log, no-op (dedup)
 *   - Server restart → in-memory state lost; first message per vehicle queries
 *     DB for an open trip and resumes from there
 */

const crypto = require('crypto');

const IDLE_TIMEOUT_MS = parseInt(process.env.IGNITION_IDLE_TIMEOUT_MS ?? '180000', 10);

let _db    = null;
let _bus   = null;
let _stmts = null;

// Per-vehicle state: vehicle_id → { tripId, ignitionOn, idleTimer }
const _state = new Map();

function init({ db, bus }) {
  _db  = db;
  _bus = bus;

  _stmts = {
    openByVehicle: db.prepare(`
      SELECT * FROM trips
      WHERE vehicle_id = ? AND status = 'in_progress'
      ORDER BY departed_at DESC
      LIMIT 1
    `),

    byId: db.prepare('SELECT * FROM trips WHERE id = ?'),

    create: db.prepare(`
      INSERT INTO trips
        (id, hauler_id, vehicle_id, driver_id, status, direction,
         origin, destination, route_id, departed_at, arrived_at,
         duration_min, distance_km, tonnage_t, axle_load_pct,
         source, raw_event_id, created_at, updated_at)
      VALUES
        (@id, @hauler_id, @vehicle_id, NULL, 'in_progress', 'laden',
         NULL, NULL, NULL, @departed_at, NULL,
         NULL, NULL, NULL, NULL,
         'device', NULL, @created_at, @updated_at)
    `),

    close: db.prepare(`
      UPDATE trips
      SET status       = 'completed',
          arrived_at   = @arrived_at,
          duration_min = @duration_min,
          updated_at   = @updated_at
      WHERE id = @id
    `),
  };

  // Subscribe to ignition events from the normaliser.
  bus.on('ignition_on',  (data) => _onIgnitionOn(data));
  bus.on('ignition_off', (data) => _onIgnitionOff(data));
}

/* ── State helpers ───────────────────────────────────────────────── */

function _getState(vehicle_id) {
  if (_state.has(vehicle_id)) return _state.get(vehicle_id);

  // First message for this vehicle since boot — check DB for any open trip.
  const openTrip = _stmts.openByVehicle.get(vehicle_id);
  const s = {
    tripId:     openTrip?.id ?? null,
    ignitionOn: openTrip != null,
    idleTimer:  null,
  };
  _state.set(vehicle_id, s);
  return s;
}

function _cancelIdleTimer(s) {
  if (s.idleTimer) {
    clearTimeout(s.idleTimer);
    s.idleTimer = null;
  }
}

/* ── Event handlers ──────────────────────────────────────────────── */

function _onIgnitionOn({ vehicle_id, hauler_id, position_at }) {
  if (!vehicle_id) return;

  const s = _getState(vehicle_id);

  // Cancel any pending idle timer — vehicle restarted before timeout fired.
  _cancelIdleTimer(s);

  // If an open trip exists (including during the idle window between ignition_off
  // and timer fire), just resume it — don't open a second trip.
  if (s.tripId) {
    if (s.ignitionOn) {
      console.log(`[telematics] ignition_on dedup for ${vehicle_id} — already in trip ${s.tripId}`);
    } else {
      console.log(`[telematics] ignition_on during idle window for ${vehicle_id} — resuming trip ${s.tripId}`);
    }
    s.ignitionOn = true;
    return;
  }

  s.ignitionOn = true;

  const now        = new Date().toISOString();
  const id         = crypto.randomBytes(8).toString('hex');
  const departedAt = position_at ?? now;

  _stmts.create.run({
    id,
    hauler_id:   hauler_id   ?? null,
    vehicle_id,
    departed_at: departedAt,
    created_at:  now,
    updated_at:  now,
  });

  const trip = _stmts.byId.get(id);
  s.tripId = id;

  _bus.emit('trip_started', { trip });
  console.log(`[telematics] trip_started ${id} for vehicle ${vehicle_id}`);
}

function _onIgnitionOff({ vehicle_id, hauler_id, position_at }) {
  if (!vehicle_id) return;

  const s = _getState(vehicle_id);

  if (!s.tripId) {
    console.log(`[telematics] ignition_off with no open trip for ${vehicle_id} — no-op`);
    return;
  }

  if (s.idleTimer) return; // timer already running, don't restart it

  s.ignitionOn = false;

  s.idleTimer = setTimeout(() => {
    s.idleTimer = null;
    _closeTrip(vehicle_id, position_at);
  }, IDLE_TIMEOUT_MS);

  // Don't block Node.js exit while waiting for an idle timeout.
  s.idleTimer.unref();
}

function _closeTrip(vehicle_id, arrivedAt) {
  const s = _state.get(vehicle_id);
  if (!s || !s.tripId) return;

  const tripId = s.tripId;
  const trip   = _stmts.byId.get(tripId);

  if (!trip) {
    s.tripId     = null;
    s.ignitionOn = false;
    return;
  }

  const now         = new Date().toISOString();
  const closedAt    = arrivedAt ?? now;
  const durationMin = trip.departed_at
    ? Math.round((new Date(closedAt) - new Date(trip.departed_at)) / 60_000)
    : null;

  _stmts.close.run({
    id:           tripId,
    arrived_at:   closedAt,
    duration_min: durationMin,
    updated_at:   now,
  });

  const closed = _stmts.byId.get(tripId);
  s.tripId     = null;
  s.ignitionOn = false;

  _bus.emit('trip_completed', { trip: closed });
  console.log(`[telematics] trip_completed ${tripId} for vehicle ${vehicle_id}`);
}

/** Cancel all pending idle timers — call on graceful shutdown. */
function shutdown() {
  for (const s of _state.values()) {
    _cancelIdleTimer(s);
  }
  _state.clear();
}

module.exports = { init, shutdown };
