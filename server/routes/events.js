'use strict';

/*
 * Server-Sent Events stream — LP-25.
 *
 * GET /api/events/stream
 *
 * Authenticated clients connect and receive a real-time stream of corridor
 * events pushed by the event processor and alert engine. The stream stays
 * open until the client disconnects.
 *
 * Event types delivered over the stream:
 *   trip_started    { trip }
 *   trip_completed  { trip }
 *   position_update { vehicle_id, hauler_id, latitude, longitude, speed_kmh }
 *   alert_raised    { alert_id, rule_type, severity, vehicle_id, hauler_id }
 *   heartbeat       { ts } — sent every 25 s to keep proxies alive
 *
 * Authentication: Bearer token in Authorization header or ?token= param
 * (EventSource in the browser cannot set custom headers, so the ?token=
 * fallback is needed there).
 *
 * Hauler scoping: hauler_admin users only receive events for their hauler.
 */

const express    = require('express');
const router     = express.Router();
const eventBus   = require('../services/eventBus');
const { requireAuth }        = require('../middleware/auth');
const { enforceHaulerScope } = require('../middleware/haulerScope');

const HEARTBEAT_MS = 25_000;

const EVENT_TYPES = ['trip_started', 'trip_completed', 'position_update', 'alert_raised'];

router.get('/stream', requireAuth, enforceHaulerScope, (req, res) => {
  // SSE headers — disable buffering so events are flushed immediately.
  res.setHeader('Content-Type',                'text/event-stream');
  res.setHeader('Cache-Control',               'no-cache');
  res.setHeader('Connection',                  'keep-alive');
  res.setHeader('X-Accel-Buffering',           'no');  // nginx: disable proxy buffering
  res.flushHeaders();

  const user      = req.user;
  const haulerId  = user?.role === 'hauler_admin' ? user.hauler_id : null;

  /** Write one SSE message. */
  function send(type, data) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush if the response supports it (compressed streams may buffer).
    if (typeof res.flush === 'function') res.flush();
  }

  /** Filter payload by hauler scope. */
  function scopeOk(payload) {
    if (!haulerId) return true;                          // axis_admin/ops: all events
    return (payload.hauler_id ?? payload.trip?.hauler_id) === haulerId;
  }

  // Send an immediate connection confirmation.
  send('connected', { ts: new Date().toISOString(), user_id: user?.id });

  // Subscribe to all event types.
  const handlers = {};
  for (const type of EVENT_TYPES) {
    handlers[type] = (payload) => {
      if (scopeOk(payload)) send(type, payload);
    };
    eventBus.on(type, handlers[type]);
  }

  // Heartbeat keeps the connection alive through idle periods and proxies.
  const heartbeat = setInterval(() => {
    send('heartbeat', { ts: new Date().toISOString() });
  }, HEARTBEAT_MS);

  // Cleanup on client disconnect.
  req.on('close', () => {
    clearInterval(heartbeat);
    for (const type of EVENT_TYPES) {
      eventBus.off(type, handlers[type]);
    }
  });
});

module.exports = router;
