'use strict';

/*
 * MQTT ingestion — connects to EMQX over TLS, subscribes to all device topics,
 * and routes raw payloads through the Teltonika decoder and event normaliser.
 *
 * Non-fatal design: if the broker is unreachable at startup the consuming app
 * continues booting normally; this module retries in the background with
 * exponential backoff (max 60 s between attempts).
 *
 * Topic pattern subscribed: devices/+/data
 * The + wildcard matches the device IMEI. Messages from IMEIs not in the
 * devices table (or inactive) are dropped with a warning log.
 */

const fs   = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const TOPIC_PATTERN  = 'devices/+/data';
const MAX_BACKOFF_MS = 60_000;
const RECONNECT_BASE = 1_000;

let _options    = null;
let _client     = null;
let _retryCount = 0;
let _retryTimer = null;

function init(options) {
  _options = options;

  const mqttCfg = options.mqtt;
  if (!mqttCfg || !mqttCfg.host) {
    console.warn('[telematics] No MQTT host configured — broker connection skipped');
    return;
  }

  _connect();
}

/* ── Connection helpers ──────────────────────────────────────────── */

function _url(cfg) {
  const proto = cfg.tls !== false ? 'mqtts' : 'mqtt';
  const port  = cfg.port ?? (cfg.tls !== false ? 8883 : 1883);
  return `${proto}://${cfg.host}:${port}`;
}

function _connectOpts(cfg) {
  const opts = {
    reconnectPeriod:    0,       // manual reconnect
    connectTimeout:     30_000,
    rejectUnauthorized: true,
    clean:              true,
  };

  if (cfg.tls !== false && cfg.caFile) {
    try {
      opts.ca = fs.readFileSync(path.resolve(cfg.caFile));
    } catch (err) {
      console.error('[telematics] Cannot read MQTT CA file:', err.message);
    }
  }

  return opts;
}

function _connect() {
  const cfg = _options.mqtt;
  const url = _url(cfg);

  console.log(`[telematics] MQTT connecting to ${url} (attempt ${_retryCount + 1})`);

  try {
    _client = mqtt.connect(url, _connectOpts(cfg));
  } catch (err) {
    console.error('[telematics] mqtt.connect() threw:', err.message);
    _scheduleReconnect();
    return;
  }

  _client.on('connect', _onConnect);
  _client.on('message', _onMessage);
  _client.on('error',   _onError);
  _client.on('close',   _onClose);
}

function _onConnect() {
  _retryCount = 0;
  console.log('[telematics] MQTT connected');

  _client.subscribe(TOPIC_PATTERN, { qos: 1 }, (err) => {
    if (err) console.error('[telematics] MQTT subscribe error:', err.message);
    else     console.log(`[telematics] MQTT subscribed to ${TOPIC_PATTERN}`);
  });
}

function _onError(err) {
  console.error('[telematics] MQTT error:', err.message);
}

function _onClose() {
  console.warn('[telematics] MQTT connection closed — scheduling reconnect');
  _scheduleReconnect();
}

function _scheduleReconnect() {
  if (_retryTimer) return; // already scheduled

  _retryCount++;
  const delay = Math.min(RECONNECT_BASE * Math.pow(2, _retryCount - 1), MAX_BACKOFF_MS);
  console.log(`[telematics] MQTT reconnect in ${Math.round(delay / 1000)}s`);

  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    if (_client) {
      try { _client.end(true); } catch (_) {}
      _client = null;
    }
    _connect();
  }, delay);

  _retryTimer.unref();
}

/* ── Message handler ─────────────────────────────────────────────── */

function _onMessage(topic, payloadBuf) {
  // Topic format: devices/<imei>/data
  const parts = topic.split('/');
  if (parts.length < 3) return;
  const imei = parts[1];

  // Parse JSON payload — drop silently on parse error (decoder will log).
  let raw;
  try {
    raw = JSON.parse(payloadBuf.toString());
  } catch {
    console.warn(`[telematics] Non-JSON message on topic ${topic} — dropped`);
    return;
  }

  const deviceRegistry = require('../state/deviceRegistry');
  const device = deviceRegistry.findByImei(imei);

  if (!device) {
    console.warn(`[telematics] Message from unregistered device ${imei} — dropped`);
    return;
  }

  if (!device.active) {
    console.warn(`[telematics] Message from deactivated device ${imei} — dropped`);
    return;
  }

  // Per-device IO element ID overrides (from init options, keyed by IMEI).
  const ioOverrides = (_options.io || {})[imei] || {};

  const decoder    = require('../decoders/teltonikaDecoder');
  const normaliser = require('./deviceEventNormaliser');

  const decoded = decoder.decode(raw, { io: ioOverrides });
  if (!decoded) return; // malformed payload; decoder already logged

  // Ensure IMEI from message matches topic IMEI (sanity check).
  if (decoded.imei && decoded.imei !== imei) {
    console.warn(`[telematics] IMEI mismatch: topic=${imei} payload=${decoded.imei} — using topic`);
    decoded.imei = imei;
  }

  normaliser.handle(decoded, device);
}

/** Expose the MQTT client for diagnostics. */
function client() { return _client; }

/** Disconnect cleanly and cancel any pending reconnect timer. */
function shutdown() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  if (_client) {
    try { _client.end(true); } catch (_) {}
    _client = null;
  }
}

module.exports = { init, client, shutdown };
