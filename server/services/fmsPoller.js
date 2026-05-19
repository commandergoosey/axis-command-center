'use strict';

/*
 * FMS poller — LP-12.
 *
 * Scheduled background job that polls connected FMS integrations for vehicle
 * positions and completed trips. Feeds results into webhook_events so the
 * event processor pipeline handles them identically to push webhooks.
 *
 * Currently supports:
 *   loconav — REST API polling (adapters/loconav.js for auth; this file for polling)
 *
 * Scheduling: called by the schedule runner every LOCONAV_POLL_INTERVAL_S
 * seconds (default 300 — every 5 minutes). Set to 0 to disable.
 *
 * Per-hauler token: stored in the integrations layer (haulers table will gain
 * an api_token column via a future migration; for now the probe result token
 * is used if available, falling back to the global LOCONAV_API_KEY).
 */

const crypto         = require('crypto');
const db             = require('../db');
const haulerStore    = require('../state/haulerStore');
const eventProcessor = require('./eventProcessor');
const log            = require('./logger');

const POLL_INTERVAL_S = parseInt(process.env.LOCONAV_POLL_INTERVAL_S ?? '300', 10);
const API_KEY         = process.env.LOCONAV_API_KEY ?? null;
const API_BASE        = (process.env.LOCONAV_API_BASE ?? 'https://api.loconav.com/v2')
                          .replace(/\/$/, '');
const DEMO            = !API_KEY;

if (POLL_INTERVAL_S === 0) {
  log.info('FMS poller disabled (LOCONAV_POLL_INTERVAL_S=0)');
}

function now() { return new Date().toISOString(); }
function newId() { return crypto.randomBytes(8).toString('hex'); }

/* ── HTTP helper (no external deps) ─────────────────────────────── */

const https = require('https');

function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    };
    https.get(url, opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Loconav API ${res.statusCode}`));
        } else {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Loconav: invalid JSON')); }
        }
      });
    }).on('error', reject)
      .on('timeout', function () { this.destroy(); reject(new Error('Loconav: timeout')); });
  });
}

/* ── Event normalisation ─────────────────────────────────────────── */

function vehicleToPositionEvent(v) {
  return {
    event_type: 'position',
    vehicle_id: v.registration_number ?? v.id?.toString(),
    latitude:   v.latitude  ?? v.lat  ?? null,
    longitude:  v.longitude ?? v.lng  ?? null,
    speed_kmh:  v.speed     ?? 0,
    heading:    v.heading   ?? null,
    timestamp:  v.gps_time  ?? v.updated_at ?? now(),
  };
}

function tripToEvents(t) {
  const vId = t.registration_number ?? t.vehicle?.registration_number ?? t.vehicle_id;
  return [
    {
      event_type:  'trip_start',
      vehicle_id:  vId,
      timestamp:   t.start_time ?? t.started_at,
      origin:      t.start_location?.address ?? null,
      destination: t.end_location?.address   ?? null,
      tonnage_t:   t.loaded_weight_kg ? t.loaded_weight_kg / 1000 : null,
      load_type:   t.load_type ?? null,
    },
    {
      event_type:  'trip_end',
      vehicle_id:  vId,
      timestamp:   t.end_time ?? t.ended_at,
      started_at:  t.start_time ?? t.started_at,
      distance_km: t.distance_km ?? (t.distance_m ? t.distance_m / 1000 : null),
      tonnage_t:   t.loaded_weight_kg ? t.loaded_weight_kg / 1000 : null,
    },
  ];
}

/* ── Store + process ─────────────────────────────────────────────── */

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO webhook_events (id, hauler_id, source, event_type, raw_json, received_at)
  VALUES (?, ?, 'loconav', ?, ?, ?)
`);

function storeAndProcess(hauler_id, events) {
  if (events.length === 0) return;
  const ts  = now();
  const ids = [];
  const insertAll = db.transaction((evts) => {
    for (const evt of evts) {
      const id = newId();
      stmtInsert.run(id, hauler_id, evt.event_type, JSON.stringify(evt), ts);
      ids.push(id);
    }
  });
  insertAll(events);
  eventProcessor.processIds(ids);
}

/* ── Live poll for one hauler ────────────────────────────────────── */

async function pollHauler(hauler, token) {
  const hid    = hauler.id;
  const events = [];

  // Current positions.
  try {
    const data = await httpGet(`${API_BASE}/vehicles`, token);
    const vehicles = Array.isArray(data) ? data : (data.vehicles ?? []);
    for (const v of vehicles) events.push(vehicleToPositionEvent(v));
  } catch (err) {
    log.warn('FMS poller: positions fetch failed', { hauler_id: hid, err: err.message });
  }

  // Completed trips in the last 2 hours.
  try {
    const since = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    const data  = await httpGet(`${API_BASE}/trips?started_after=${since}`, token);
    const trips = Array.isArray(data) ? data : (data.trips ?? []);
    for (const t of trips) events.push(...tripToEvents(t));
  } catch (err) {
    log.warn('FMS poller: trips fetch failed', { hauler_id: hid, err: err.message });
  }

  storeAndProcess(hid, events);
  log.info('FMS poller: hauler polled', { hauler_id: hid, events: events.length });
}

/* ── Demo mode ───────────────────────────────────────────────────── */

const _demoPos = new Map();

function syntheticPosition(hauler_id) {
  if (!_demoPos.has(hauler_id)) {
    _demoPos.set(hauler_id, {
      lat:   6.72 + (Math.random() - 0.5) * 0.3,
      lng:  -1.62 + (Math.random() - 0.5) * 0.3,
      spd:  45 + Math.random() * 35,
    });
  }
  const s = _demoPos.get(hauler_id);
  s.lat += (Math.random() - 0.5) * 0.004;
  s.lng += (Math.random() - 0.5) * 0.004;
  s.spd  = Math.max(0, Math.min(90, s.spd + (Math.random() - 0.5) * 8));
  return s;
}

function runDemo(haulers) {
  for (const h of haulers) {
    const s = syntheticPosition(h.id);
    storeAndProcess(h.id, [{
      event_type: 'position',
      vehicle_id: `DEMO-${h.id.toUpperCase()}`,
      latitude:   Number(s.lat.toFixed(5)),
      longitude:  Number(s.lng.toFixed(5)),
      speed_kmh:  Number(s.spd.toFixed(1)),
      timestamp:  now(),
    }]);
  }
  log.debug('FMS poller: demo positions generated', { haulers: haulers.length });
}

/* ── Main ────────────────────────────────────────────────────────── */

async function poll() {
  if (POLL_INTERVAL_S === 0) return;

  const haulers = haulerStore.list().filter((h) => h.integration?.type === 'loconav');
  if (haulers.length === 0) return;

  if (DEMO) {
    runDemo(haulers);
    return;
  }

  await Promise.allSettled(haulers.map((h) => pollHauler(h, API_KEY)));
}

/* ── Schedule registration ───────────────────────────────────────── */

let _timer = null;

function start() {
  if (POLL_INTERVAL_S === 0) return;
  log.info(`FMS poller scheduled`, {
    interval_s: POLL_INTERVAL_S,
    mode: DEMO ? 'demo' : 'live',
  });
  // Fire once immediately, then on interval.
  poll().catch((err) => log.error('FMS poller: initial poll failed', { err: err.message }));
  _timer = setInterval(
    () => poll().catch((err) => log.error('FMS poller: poll failed', { err: err.message })),
    POLL_INTERVAL_S * 1000,
  );
  _timer.unref(); // don't keep the process alive on shutdown
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, poll, DEMO };
