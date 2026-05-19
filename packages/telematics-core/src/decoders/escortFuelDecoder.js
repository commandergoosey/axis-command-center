'use strict';

/*
 * Escort FLS fuel level decoder and calibration engine.
 *
 * Escort capacitive fuel rods (LLS protocol) connect to the Teltonika device
 * via RS-232. The Teltonika reads the sensor and encodes the raw depth (mm)
 * as an I/O element in its MQTT payload. Calibration is server-side only —
 * this module converts mm → litres using per-vehicle calibration curves stored
 * in fuel_calibrations.
 *
 * Anomaly detection compares the current calibrated reading against the most
 * recent stored reading and classifies significant changes as refuel or drain.
 * Drain detection only fires when the ignition is OFF (parked siphon scenario).
 */

let _REFUEL_MIN_L   = NaN;
let _DRAIN_MIN_L    = NaN;
let _MAX_INTERVAL_M = NaN;

let _db    = null;
let _stmts = null;

function _requirePositiveFinite(val, name) {
  if (!Number.isFinite(val) || val <= 0) {
    throw new Error(`[telematics] escortFuelDecoder: invalid config — ${name}=${val} must be a positive number`);
  }
}

function init(db) {
  _REFUEL_MIN_L   = parseFloat(process.env.FUEL_REFUEL_MIN_L    ?? '20');
  _DRAIN_MIN_L    = parseFloat(process.env.FUEL_DRAIN_MIN_L     ?? '15');
  _MAX_INTERVAL_M = parseFloat(process.env.FUEL_MAX_INTERVAL_MIN ?? '30');

  _requirePositiveFinite(_REFUEL_MIN_L,   'FUEL_REFUEL_MIN_L');
  _requirePositiveFinite(_DRAIN_MIN_L,    'FUEL_DRAIN_MIN_L');
  _requirePositiveFinite(_MAX_INTERVAL_M, 'FUEL_MAX_INTERVAL_MIN');

  _db = db;

  _stmts = {
    calibration: db.prepare(
      'SELECT mm, litres FROM fuel_calibrations WHERE vehicle_id = ? ORDER BY mm ASC',
    ),

    lastReading: db.prepare(`
      SELECT fuel_litres, recorded_at FROM fuel_readings
      WHERE vehicle_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `),
  };
}

/**
 * Convert a raw mm depth to calibrated litres using the vehicle's curve.
 *
 * Uses linear interpolation between the nearest two calibration points.
 * Clamps to the min/max of the table if the reading is out of range.
 * Returns null if no calibration table exists for the vehicle.
 *
 * @param {string} vehicle_id
 * @param {number} mm           — raw sensor reading in millimetres
 * @returns {number|null}       — calibrated litres, or null
 */
function calibratedLitres(vehicle_id, mm) {
  if (vehicle_id == null || mm == null) return null;

  const points = _stmts.calibration.all(vehicle_id);
  if (points.length === 0) return null;
  if (points.length === 1) return points[0].litres; // degenerate single-point table

  const rawMm = Number(mm);

  // Clamp to calibration range.
  if (rawMm <= points[0].mm)                 return points[0].litres;
  if (rawMm >= points[points.length - 1].mm) return points[points.length - 1].litres;

  // Linear interpolation between adjacent calibration points.
  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];

    if (rawMm >= lo.mm && rawMm <= hi.mm) {
      if (hi.mm === lo.mm) return lo.litres; // degenerate duplicate point
      const ratio = (rawMm - lo.mm) / (hi.mm - lo.mm);
      return lo.litres + ratio * (hi.litres - lo.litres);
    }
  }

  return null; // unreachable with a valid sorted table
}

/**
 * Compare current_l against the last stored reading to detect fuel anomalies.
 *
 * Only valid when the last reading is within FUEL_MAX_INTERVAL_MIN minutes.
 * Drain detection requires ignition OFF — changes while driving are not
 * classified as drains (normal fuel burn varies fuel level non-linearly).
 *
 * @param {string}  vehicle_id
 * @param {number}  current_l   — calibrated litres at the current moment
 * @param {boolean} ignition    — true = engine running
 * @returns {null | { type: 'refuel'|'drain', before_l: number, after_l: number, delta_l: number }}
 */
function detectAnomaly(vehicle_id, current_l, ignition) {
  if (vehicle_id == null || current_l == null) return null;

  const last = _stmts.lastReading.get(vehicle_id);
  if (!last || last.fuel_litres == null) return null;

  // Ignore stale comparisons — sensor gap too large to be meaningful.
  // Math.abs handles device clock skew where recorded_at is slightly in the future.
  const ageMs = Math.abs(Date.now() - new Date(last.recorded_at).getTime());
  if (ageMs > _MAX_INTERVAL_M * 60_000) return null;

  const delta = current_l - last.fuel_litres;

  if (delta >= _REFUEL_MIN_L) {
    return {
      type:     'refuel',
      before_l: last.fuel_litres,
      after_l:  current_l,
      delta_l:  delta,
    };
  }

  // Only classify drops as drains when the vehicle is parked.
  if (!ignition && -delta >= _DRAIN_MIN_L) {
    return {
      type:     'drain',
      before_l: last.fuel_litres,
      after_l:  current_l,
      delta_l:  delta,  // negative number
    };
  }

  return null;
}

module.exports = { init, calibratedLitres, detectAnomaly };
