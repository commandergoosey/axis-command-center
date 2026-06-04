'use strict';

/*
 * Tests for services/eventBus.js — emit, on, off
 *
 * eventBus is a thin EventEmitter singleton that decouples producers
 * (eventProcessor, alertEngine) from SSE consumers (routes).
 *
 * Exports: { emit, on: bus.on.bind(bus), off: bus.off.bind(bus) }
 *
 * No external dependencies — pure EventEmitter behaviour tested here.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// Re-require for each test group to keep the singleton's listener
// count sane; the module is stateless between fresh loads.
function freshBus() {
  delete require.cache[require.resolve('../services/eventBus')];
  return require('../services/eventBus');
}

after(() => {
  delete require.cache[require.resolve('../services/eventBus')];
});

// ── emit + on ─────────────────────────────────────────────────────

describe('eventBus — emit and on', () => {
  it('subscribed listener receives emitted data', () => {
    const bus = freshBus();
    let received = null;
    bus.on('trip_started', (d) => { received = d; });
    bus.emit('trip_started', { trip_id: 'T-001' });
    assert.deepEqual(received, { trip_id: 'T-001' });
  });

  it('data object is passed through unchanged', () => {
    const bus = freshBus();
    const payload = { vehicle_id: 'V-999', latitude: 6.0, longitude: -2.0, speed_kmh: 80 };
    let got = null;
    bus.on('position_update', (d) => { got = d; });
    bus.emit('position_update', payload);
    assert.deepEqual(got, payload);
  });

  it('emit with no subscribers does not throw', () => {
    const bus = freshBus();
    assert.doesNotThrow(() => bus.emit('alert_raised', { alert_id: 'a1' }));
  });

  it('multiple listeners on the same type all receive the event', () => {
    const bus = freshBus();
    const received = [];
    bus.on('trip_completed', (d) => received.push('A:' + d.id));
    bus.on('trip_completed', (d) => received.push('B:' + d.id));
    bus.emit('trip_completed', { id: 'T-123' });
    assert.deepEqual(received, ['A:T-123', 'B:T-123']);
  });
});

// ── type isolation ────────────────────────────────────────────────

describe('eventBus — event type isolation', () => {
  it('listener for type A does not fire when type B is emitted', () => {
    const bus = freshBus();
    let triggered = false;
    bus.on('trip_started', () => { triggered = true; });
    bus.emit('trip_completed', { id: 'T-001' });
    assert.equal(triggered, false);
  });

  it('two different event types fire their respective listeners independently', () => {
    const bus = freshBus();
    const log = [];
    bus.on('trip_started',   () => log.push('started'));
    bus.on('trip_completed', () => log.push('completed'));
    bus.emit('trip_completed', {});
    bus.emit('trip_started',   {});
    assert.deepEqual(log, ['completed', 'started']);
  });
});

// ── off ───────────────────────────────────────────────────────────

describe('eventBus — off (unsubscribe)', () => {
  it('listener is not called after off()', () => {
    const bus = freshBus();
    let count = 0;
    const fn = () => { count++; };
    bus.on('alert_raised', fn);
    bus.emit('alert_raised', {});
    bus.off('alert_raised', fn);
    bus.emit('alert_raised', {});
    assert.equal(count, 1, 'listener should fire once before off, not after');
  });

  it('off() on a non-subscribed listener does not throw', () => {
    const bus = freshBus();
    const fn = () => {};
    assert.doesNotThrow(() => bus.off('trip_started', fn));
  });

  it('off() removes only the specified listener, others remain', () => {
    const bus = freshBus();
    const log = [];
    const fnA = () => log.push('A');
    const fnB = () => log.push('B');
    bus.on('position_update', fnA);
    bus.on('position_update', fnB);
    bus.off('position_update', fnA);
    bus.emit('position_update', {});
    assert.deepEqual(log, ['B'], 'only fnB should remain after removing fnA');
  });
});
