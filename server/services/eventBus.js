'use strict';

/*
 * Event bus — LP-25.
 *
 * Tiny EventEmitter singleton that decouples event producers
 * (eventProcessor, alertEngine) from the SSE endpoint.
 *
 * Event types emitted:
 *   'trip_started'    — { trip }
 *   'trip_completed'  — { trip }
 *   'position_update' — { vehicle_id, hauler_id, latitude, longitude, speed_kmh }
 *   'alert_raised'    — { alert_id, rule_type, severity, vehicle_id, hauler_id }
 *
 * Consumers subscribe via eventBus.on(type, listener) and must call
 * eventBus.off(type, listener) on cleanup (SSE disconnect).
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200); // support up to 200 concurrent SSE clients

/**
 * Publish an event to all subscribed SSE clients.
 * @param {string} type  — one of the event types listed above
 * @param {object} data  — serialisable payload
 */
function emit(type, data) {
  bus.emit(type, data);
}

module.exports = { emit, on: bus.on.bind(bus), off: bus.off.bind(bus) };
