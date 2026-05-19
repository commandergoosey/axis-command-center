'use strict';

/*
 * Device event normaliser.
 *
 * Receives a decoded Teltonika record from mqttIngestion and:
 *   1. Writes position to the consuming app's vehicle_positions table.
 *   2. Emits position_update, ignition_on/off, fuel_level, fuel_refuel/drain,
 *      and device_heartbeat onto the bus.
 *   3. Upserts device_heartbeats.
 *   4. Inserts fuel_readings and trims the ring buffer.
 *   5. Logs a diagnostic device_event row.
 *
 * Writes to vehicle_positions directly via the shared db instance — no import
 * from the consuming app is needed, and no circular requires exist.
 *
 * The ignitionTripDetector subscribes to ignition_on / ignition_off events
 * emitted here and handles trip lifecycle independently.
 */

const FUEL_RING_MAX = parseInt(process.env.FUEL_RING_MAX ?? '2000', 10);

let _db    = null;
let _bus   = null;
let _stmts = null;

function init({ db, bus }) {
  _db  = db;
  _bus = bus;

  _stmts = {
    // Consuming app's position table — shared db, direct write, no import.
    upsertPosition: db.prepare(`
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

    // Module-owned tables.
    upsertHeartbeat: db.prepare(`
      INSERT INTO device_heartbeats (imei, signal, battery_mv, firmware, last_seen_at)
      VALUES (@imei, @signal, @battery_mv, @firmware, @last_seen_at)
      ON CONFLICT(imei) DO UPDATE SET
        signal       = excluded.signal,
        battery_mv   = excluded.battery_mv,
        firmware     = excluded.firmware,
        last_seen_at = excluded.last_seen_at
    `),

    insertFuelReading: db.prepare(`
      INSERT INTO fuel_readings (imei, vehicle_id, hauler_id, fuel_mm, fuel_litres, recorded_at)
      VALUES (@imei, @vehicle_id, @hauler_id, @fuel_mm, @fuel_litres, @recorded_at)
    `),

    trimFuelReadings: db.prepare(`
      DELETE FROM fuel_readings
      WHERE vehicle_id = @vehicle_id
        AND id NOT IN (
          SELECT id FROM fuel_readings
          WHERE vehicle_id = @vehicle_id
          ORDER BY recorded_at DESC
          LIMIT @max_rows
        )
    `),

    insertDeviceEvent: db.prepare(`
      INSERT INTO device_events (imei, event_type, payload_json, recorded_at)
      VALUES (@imei, @event_type, @payload_json, @recorded_at)
    `),
  };
}

/**
 * Process one decoded telemetry record from a Teltonika device.
 *
 * @param {object} decoded — output of teltonikaDecoder.decode()
 * @param {object} device  — row from the devices table
 */
function handle(decoded, device) {
  const now         = new Date().toISOString();
  const position_at = decoded.timestamp_ms
    ? new Date(decoded.timestamp_ms).toISOString()
    : now;

  const { vehicle_id, hauler_id } = device;
  const imei = decoded.imei;

  // ── 1. Position update ────────────────────────────────────────────────────

  const pos = decoded.position;
  if (pos && pos.latitude != null && pos.longitude != null) {
    try {
      _stmts.upsertPosition.run({
        vehicle_id,
        hauler_id:   hauler_id  ?? null,
        latitude:    pos.latitude,
        longitude:   pos.longitude,
        speed_kmh:   pos.speed_kmh  ?? null,
        heading_deg: pos.angle      ?? null,
        position_at,
        updated_at:  now,
      });
    } catch (err) {
      // vehicle_positions may not exist in isolated test environments.
      console.warn('[telematics] position upsert failed (table missing?):', err.message);
    }

    _bus.emit('position_update', {
      vehicle_id,
      hauler_id:   hauler_id  ?? null,
      latitude:    pos.latitude,
      longitude:   pos.longitude,
      speed_kmh:   pos.speed_kmh  ?? null,
      heading_deg: pos.angle      ?? null,
      position_at,
    });
  }

  // ── 2. Ignition events ─────────────────────────────────────────────────────
  // ignitionTripDetector listens to these events on the bus.

  if (decoded.ignition != null) {
    const evtType = decoded.ignition ? 'ignition_on' : 'ignition_off';
    _bus.emit(evtType, { vehicle_id, hauler_id: hauler_id ?? null, position_at });
  }

  // ── 3. Fuel level ──────────────────────────────────────────────────────────

  if (decoded.fuel_mm != null && vehicle_id) {
    const fuelDecoder = require('../decoders/escortFuelDecoder');
    const fuel_litres_raw = fuelDecoder.calibratedLitres(vehicle_id, decoded.fuel_mm);
    const fuel_litres = fuel_litres_raw != null
      ? Math.round(fuel_litres_raw * 10) / 10  // 1 d.p. for stable comparisons
      : null;

    // Anomaly detection BEFORE insert — so lastReading query sees the previous
    // reading, not the one we are about to store (which would always give delta=0).
    let anomaly = null;
    if (fuel_litres != null) {
      anomaly = fuelDecoder.detectAnomaly(vehicle_id, fuel_litres, decoded.ignition ?? false);
    }

    _stmts.insertFuelReading.run({
      imei:        imei         ?? null,
      vehicle_id,
      hauler_id:   hauler_id   ?? null,
      fuel_mm:     decoded.fuel_mm,
      fuel_litres: fuel_litres ?? null,
      recorded_at: position_at,
    });

    _stmts.trimFuelReadings.run({ vehicle_id, max_rows: FUEL_RING_MAX });

    if (fuel_litres != null) {
      _bus.emit('fuel_level', {
        vehicle_id,
        hauler_id:   hauler_id ?? null,
        fuel_litres,
        fuel_mm:     decoded.fuel_mm,
        position_at,
      });

      if (anomaly) {
        const evtType = anomaly.type === 'refuel' ? 'fuel_refuel' : 'fuel_drain';
        _bus.emit(evtType, {
          vehicle_id,
          hauler_id:  hauler_id ?? null,
          before_l:   anomaly.before_l,
          after_l:    anomaly.after_l,
          delta_l:    anomaly.delta_l,
          position_at,
        });
      }
    }
  }

  // ── 4. Device heartbeat ────────────────────────────────────────────────────

  _stmts.upsertHeartbeat.run({
    imei:        imei          ?? null,
    signal:      decoded.signal      ?? null,
    battery_mv:  decoded.battery_mv  ?? null,
    firmware:    device.firmware     ?? null,
    last_seen_at: now,
  });

  _bus.emit('device_heartbeat', {
    imei:        imei          ?? null,
    vehicle_id,
    hauler_id:   hauler_id    ?? null,
    signal:      decoded.signal      ?? null,
    battery_mv:  decoded.battery_mv  ?? null,
    firmware:    device.firmware     ?? null,
    position_at,
  });

  // ── 5. Diagnostic event log ────────────────────────────────────────────────

  try {
    _stmts.insertDeviceEvent.run({
      imei:         imei ?? null,
      event_type:   'telemetry',
      payload_json: JSON.stringify({
        ignition:    decoded.ignition,
        fuel_mm:     decoded.fuel_mm,
        signal:      decoded.signal,
        battery_mv:  decoded.battery_mv,
        odometer_cm: decoded.odometer_cm,
        ...decoded.raw_io,
      }),
      recorded_at:  now,
    });
  } catch (_) {
    // Diagnostic logging is non-fatal.
  }
}

module.exports = { init, handle };
