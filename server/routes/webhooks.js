'use strict';

/*
 * Webhooks — LP-7.
 *
 * Receives push events from hauler telematics integrations (Loconav, custom
 * GeoTab adapters, etc.), verifies the HMAC-SHA256 signature, persists the
 * raw payload to webhook_events, then normalises the event for downstream use.
 *
 * Endpoints:
 *   POST /api/webhooks/:hauler_id/loconav   — Loconav push events
 *   POST /api/webhooks/:hauler_id/custom    — Generic JSON event envelope
 *
 * Signature verification:
 *   Loconav sends X-Loconav-Signature: sha256=<hex>
 *   Custom adapters send X-Axis-Signature: sha256=<hex>
 *   The HMAC key is the per-hauler webhook_secret (stored in haulers table).
 *   Falls back to the WEBHOOK_SECRET env var if no per-hauler secret is set.
 *
 * Admin: rotate a hauler's webhook secret via the admin route:
 *   POST /api/admin/haulers/:id/webhook-secret  → { secret }
 */

const express    = require('express');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');

const router  = express.Router({ mergeParams: true });

const db             = require('../db');
const haulerStore    = require('../state/haulerStore');
const eventProcessor = require('../services/eventProcessor');
const log            = require('../services/logger');
const { haulerTokenAuth } = require('../middleware/haulerTokenAuth'); // LP-36

/* ── LP-26: Per-hauler rate limiting ────────────────────────────── */
// Max events per hauler per 5-minute window. Prevents a misconfigured
// integration from flooding the events table.
const WEBHOOK_MAX = parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX ?? '500', 10);

const webhookLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,
  max:             WEBHOOK_MAX,
  keyGenerator:    (req) => `webhook:${req.params.hauler_id}`,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many webhook events from this hauler — please back off' },
});

/* ── Helpers ─────────────────────────────────────────────────────── */

function now() { return new Date().toISOString(); }
function newId() { return crypto.randomBytes(8).toString('hex'); }

/**
 * Verify HMAC-SHA256 signature.
 * Expected header value: "sha256=<hex-digest>"
 */
function verifySignature(rawBody, secret, header) {
  if (!secret) return false;
  if (!header)  return false;
  const [algo, received] = header.split('=');
  if (algo !== 'sha256' || !received) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(received,  'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false; // length mismatch → invalid
  }
}

/**
 * Persist a raw event to webhook_events. Returns the generated event id.
 */
function storeEvent(haulerId, source, eventType, rawBody) {
  const id = newId();
  db.prepare(`
    INSERT INTO webhook_events (id, hauler_id, source, event_type, raw_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, haulerId, source, eventType || null, rawBody, now());
  return id;
}

/**
 * Resolve the webhook secret for a hauler.
 * Prefers the per-hauler secret; falls back to the global env var.
 */
function resolveSecret(hauler) {
  return hauler?.webhook_secret || process.env.WEBHOOK_SECRET || null;
}

/* ── Loconav push events ─────────────────────────────────────────── */

/*
 * Loconav sends a JSON array of vehicle events. Each event has at minimum:
 *   { vehicle_id, timestamp, latitude, longitude, speed_kmh, event_type }
 *
 * Body parsing is handled by the global express.json() middleware in index.js,
 * which also saves req.rawBody (Buffer) via its verify callback so we can
 * verify HMAC signatures on the original bytes.
 *
 * event_type is mapped to our canonical labels:
 *   "TRIP_START"    → trip_start
 *   "TRIP_END"      → trip_end
 *   "POSITION"      → position
 *   "ALERT"         → alert
 *   anything else   → raw value (lower-cased)
 */
router.post('/:hauler_id/loconav', webhookLimiter, haulerTokenAuth, (req, res) => {
  const { hauler_id } = req.params;
  const hauler = haulerStore.findById(hauler_id);

  if (!hauler) {
    log.warn('Webhook received for unknown hauler', { hauler_id, source: 'loconav' });
    return res.status(404).json({ error: 'Unknown hauler' });
  }

  // HMAC verification — only enforced when a secret is configured.
  const sig    = req.headers['x-loconav-signature'];
  const secret = resolveSecret(hauler);
  if (secret && !verifySignature(req.rawBody || Buffer.alloc(0), secret, sig)) {
    log.warn('Loconav webhook signature invalid', { hauler_id });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body;
  if (!payload) return res.status(400).json({ error: 'Invalid JSON payload' });

  const events = Array.isArray(payload) ? payload : [payload];
  let stored = 0;
  const ids  = [];

  for (const evt of events) {
    const canonical = normaliseLoconavType(evt.event_type);
    try {
      ids.push(storeEvent(hauler_id, 'loconav', canonical, JSON.stringify(evt)));
      stored++;
    } catch (err) {
      log.error('Failed to store Loconav event', { hauler_id, err: err.message });
    }
  }

  log.http('Loconav webhook processed', { hauler_id, stored, total: events.length });

  // LP-11 — process inline so events are acted on immediately.
  if (ids.length > 0) {
    setImmediate(() => {
      try { eventProcessor.processIds(ids); }
      catch (err) { log.error('Event processor error (loconav)', { err: err.message }); }
    });
  }

  res.json({ ok: true, stored });
});

function normaliseLoconavType(raw) {
  if (!raw) return 'position';
  const t = String(raw).toUpperCase();
  if (t === 'TRIP_START') return 'trip_start';
  if (t === 'TRIP_END')   return 'trip_end';
  if (t === 'POSITION' || t === 'LOCATION') return 'position';
  if (t === 'ALERT' || t === 'ALARM')       return 'alert';
  return t.toLowerCase();
}

/* ── Generic / custom adapter push events ────────────────────────── */

/*
 * Custom adapters (GeoTab etc.) post a standard envelope:
 *   {
 *     "event_type": "position" | "trip_start" | "trip_end" | "alert",
 *     "vehicle_id": "...",
 *     "timestamp":  "ISO-8601",
 *     "payload":    { ... adapter-specific fields ... }
 *   }
 */
router.post('/:hauler_id/custom', webhookLimiter, haulerTokenAuth, (req, res) => {
  const { hauler_id } = req.params;
  const hauler = haulerStore.findById(hauler_id);

  if (!hauler) {
    log.warn('Webhook received for unknown hauler', { hauler_id, source: 'custom' });
    return res.status(404).json({ error: 'Unknown hauler' });
  }

  const sig    = req.headers['x-axis-signature'];
  const secret = resolveSecret(hauler);
  if (secret && !verifySignature(req.rawBody || Buffer.alloc(0), secret, sig)) {
    log.warn('Custom webhook signature invalid', { hauler_id });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body;
  if (!payload) return res.status(400).json({ error: 'Invalid JSON payload' });

  const events = Array.isArray(payload) ? payload : [payload];
  let stored = 0;
  const ids  = [];

  for (const evt of events) {
    try {
      ids.push(storeEvent(hauler_id, 'custom', evt.event_type || null, JSON.stringify(evt)));
      stored++;
    } catch (err) {
      log.error('Failed to store custom webhook event', { hauler_id, err: err.message });
    }
  }

  log.http('Custom webhook processed', { hauler_id, stored, total: events.length });

  if (ids.length > 0) {
    setImmediate(() => {
      try { eventProcessor.processIds(ids); }
      catch (err) { log.error('Event processor error (custom)', { err: err.message }); }
    });
  }

  res.json({ ok: true, stored });
});

module.exports = router;
