'use strict';

/*
 * @axis/telematics-core — entry point.
 *
 * Call init() once with the consuming app's DB instance and event bus.
 * All sub-modules are wired up inside init(); MQTT connects last so the
 * DB and state layers are ready before the first message arrives.
 *
 * Usage:
 *   const telematics = require('@axis/telematics-core');
 *   telematics.init({
 *     mqtt: { host: process.env.MQTT_HOST, port: 8883, tls: true, caFile: process.env.MQTT_CA_FILE },
 *     db:   require('./db'),
 *     bus:  require('./services/eventBus'),
 *     middleware: { requireRole: require('./middleware/auth').requireRole },
 *   });
 *   app.use('/api/devices', telematics.getDevicesRouter());
 */

let _initialised    = false;
let _devicesRouter  = null;

/**
 * Initialise the telematics module.
 * Safe to call multiple times — second call is a no-op with a warning.
 *
 * @param {object}   options
 * @param {object}   [options.mqtt]               — MQTT broker config
 * @param {string}   options.mqtt.host            — broker hostname
 * @param {number}   [options.mqtt.port=8883]     — broker port
 * @param {boolean}  [options.mqtt.tls=true]      — enable TLS
 * @param {string}   [options.mqtt.caFile]        — path to CA cert for mTLS
 * @param {object}   options.db                   — better-sqlite3 Database instance (consuming app's)
 * @param {object}   options.bus                  — EventEmitter bus (consuming app's eventBus)
 * @param {object}   [options.io]                 — per-IMEI Teltonika element ID overrides
 * @param {object}   [options.middleware]         — consuming-app middleware
 * @param {Function} [options.middleware.requireRole] — role-guard middleware factory
 */
function init(options = {}) {
  if (_initialised) {
    console.warn('[telematics] init() called more than once — ignoring');
    return;
  }

  const { db, bus } = options;
  if (!db)  throw new Error('[telematics] init(): options.db (better-sqlite3 instance) is required');
  if (!bus) throw new Error('[telematics] init(): options.bus (EventEmitter) is required');

  // Run this module's own DB migrations against the consuming app's database.
  require('./db/migrate').run(db);

  // Initialise state layer.
  require('./src/state/deviceRegistry').init(db);

  // Initialise decoders that need DB access.
  require('./src/decoders/escortFuelDecoder').init(db);

  // Initialise services — order matters: trip detector subscribes to bus events
  // emitted by the normaliser, so both must init before MQTT connects.
  require('./src/services/ignitionTripDetector').init({ db, bus });
  require('./src/services/deviceEventNormaliser').init({ db, bus });

  // Build the devices API router (may be null if no middleware provided).
  const requireRole = options.middleware?.requireRole ?? null;
  _devicesRouter = require('./src/routes/devices')(db, requireRole);

  // Connect to MQTT broker last — all handlers must be registered first.
  // Non-fatal: if the broker is unreachable the consuming app continues normally.
  try {
    require('./src/services/mqttIngestion').init(options);
  } catch (err) {
    console.error('[telematics] MQTT init error (non-fatal):', err.message);
  }

  _initialised = true;
  console.log('[telematics] module initialised');
}

/**
 * Returns the Express router for /api/devices.
 * Must be called after init().
 */
function getDevicesRouter() {
  if (!_initialised) throw new Error('[telematics] call init() before getDevicesRouter()');
  return _devicesRouter;
}

/**
 * Graceful shutdown — cancels idle timers and disconnects from MQTT.
 * Call from the consuming app's SIGTERM / SIGINT handler.
 */
function shutdown() {
  if (!_initialised) return;
  try { require('./src/services/ignitionTripDetector').shutdown(); } catch (_) {}
  try { require('./src/services/mqttIngestion').shutdown(); } catch (_) {}
  _initialised   = false;
  _devicesRouter = null;
  console.log('[telematics] module shut down');
}

module.exports = { init, getDevicesRouter, shutdown };
