'use strict';

/*
 * Teltonika FMB920 MQTT JSON decoder — firmware 03.27+.
 *
 * Expected payload shape (topic: devices/<imei>/data):
 *   {
 *     "ident":      "352093079660097",   // device IMEI
 *     "timestamp":  1710844800000,       // epoch milliseconds
 *     "lat":        5.0234,              // decimal degrees
 *     "lng":        -2.0192,
 *     "alt":        120,                 // metres ASL
 *     "angle":      270,                 // heading 0–360 degrees
 *     "satellites": 8,
 *     "speed":      60,                  // km/h
 *     "io": {
 *       "1":     1,                      // ignition ON (1) / OFF (0)
 *       "9":     150,                    // Escort fuel rod — mm depth (default ID)
 *       "21":    17,                     // GSM signal strength 0–31
 *       "66":    12600,                  // external voltage mV
 *       "10060": 25000000,               // odometer cm
 *       ...                              // other I/O preserved in raw_io
 *     }
 *   }
 *
 * Adapter pattern:
 *   Pass deviceConfig.io = { fuel_mm: 17 } to override the element ID for
 *   the fuel sensor on a device where it is wired to I/O ID 17 instead of 9.
 *   Any DEFAULT_IDS key can be overridden the same way.
 *   This allows other Teltonika models (FMB130, FMB140, FMB150) to be
 *   supported without touching this decoder — only the config differs.
 */

const DEFAULT_IDS = {
  ignition:    1,
  fuel_mm:     9,
  signal:      21,
  battery_mv:  66,
  odometer_cm: 10060,
};

/**
 * Decode a raw Teltonika FMB920 MQTT payload.
 *
 * @param {object} raw           — parsed JSON object from MQTT message
 * @param {object} [deviceConfig] — per-device overrides, e.g. { io: { fuel_mm: 17 } }
 * @returns {object|null}         — normalised record, or null on unrecoverable error
 */
function decode(raw, deviceConfig = {}) {
  if (!raw || typeof raw !== 'object') {
    console.warn('[telematics] decoder: received null or non-object payload');
    return null;
  }

  // Merge default element IDs with any per-device overrides.
  const ids = Object.assign({}, DEFAULT_IDS, deviceConfig.io || {});

  // I/O map — keys are element IDs as strings.
  const io = (raw.io && typeof raw.io === 'object' && !Array.isArray(raw.io)) ? raw.io : {};

  function ioInt(id) {
    const v = io[String(id)];
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  function ioBool(id) {
    const v = io[String(id)];
    if (v == null) return null;
    return Number(v) !== 0;
  }

  function validatedNum(val, min, max) {
    if (val == null) return null;
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return n;
  }

  try {
    return {
      imei:         raw.ident != null ? String(raw.ident) : null,
      timestamp_ms: raw.timestamp != null ? Number(raw.timestamp) : Date.now(),

      position: {
        latitude:   validatedNum(raw.lat,        -90,   90),
        longitude:  validatedNum(raw.lng,        -180, 180),
        altitude:   raw.alt        != null ? Number(raw.alt)        : null,
        angle:      validatedNum(raw.angle,        0,  360),
        speed_kmh:  validatedNum(raw.speed,        0, 1000),
        satellites: raw.satellites != null ? Number(raw.satellites) : null,
      },

      ignition:    ioBool(ids.ignition),
      fuel_mm:     ioInt(ids.fuel_mm),
      signal:      ioInt(ids.signal),
      battery_mv:  ioInt(ids.battery_mv),
      odometer_cm: ioInt(ids.odometer_cm),

      // Full I/O map preserved for diagnostic logging and future element access.
      raw_io: Object.assign({}, io),
    };
  } catch (err) {
    console.error('[telematics] decoder: unexpected error:', err.message);
    return null;
  }
}

module.exports = { decode, DEFAULT_IDS };
