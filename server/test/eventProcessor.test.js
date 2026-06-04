'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB + migrations (must run before any state module) ───────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db); // adds estimated_fuel_l, convoy_id etc.

// ── Stubs ─────────────────────────────────────────────────────────────────
// notificationDispatcher — no email/network calls in tests
const ndKey = require.resolve('../services/notificationDispatcher');
require.cache[ndKey] = { id: ndKey, filename: ndKey, loaded: true, exports: { dispatch: async () => {} } };

// alertEngine — tested separately; keep eventProcessor tests focused on
// trip/position pipeline logic
const aeKey = require.resolve('../services/alertEngine');
require.cache[aeKey] = { id: aeKey, filename: aeKey, loaded: true, exports: { evaluate: () => {} } };

// ── Modules under test ────────────────────────────────────────────────────
// Clear before requiring so prepared statements bind to the in-memory db.
for (const rel of ['../state/tripStore', '../state/positionStore', '../services/eventProcessor']) {
  delete require.cache[require.resolve(rel)];
}

const tripStore      = require('../state/tripStore');
const positionStore  = require('../state/positionStore');
const eventProcessor = require('../services/eventProcessor');

// ── DB helpers ────────────────────────────────────────────────────────────
const insertEvent = db.prepare(`
  INSERT INTO webhook_events (id, hauler_id, source, event_type, raw_json, processed, received_at)
  VALUES (@id, @hauler_id, @source, @event_type, @raw_json, @processed, @received_at)
`);
const getEvent = db.prepare('SELECT * FROM webhook_events WHERE id = ?');

let seq = 0;
function mkEvt(overrides = {}) {
  return {
    id:           `evt-${++seq}`,
    hauler_id:    'haulco-1',
    source:       'test',
    event_type:   'position',
    raw_json:     '{}',
    processed:    0,
    received_at:  new Date().toISOString(),
    ...overrides,
  };
}

function clearTables() {
  db.exec('DELETE FROM webhook_events; DELETE FROM trips; DELETE FROM vehicle_positions');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('eventProcessor — trip_start', () => {
  beforeEach(clearTables);

  it('creates an in_progress trip row', () => {
    const ts  = new Date().toISOString();
    const evt = mkEvt({
      event_type: 'trip_start',
      raw_json: JSON.stringify({
        vehicle_id:  'TRUCK-01',
        direction:   'laden',
        origin:      'Nyinahin Mine Gate',
        destination: 'Takoradi Port Gate',
        timestamp:   ts,
      }),
    });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);

    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips.length, 1);
    assert.strictEqual(trips[0].vehicle_id,  'TRUCK-01');
    assert.strictEqual(trips[0].status,      'in_progress');
    assert.strictEqual(trips[0].direction,   'laden');
    assert.strictEqual(trips[0].hauler_id,   'haulco-1');
    assert.strictEqual(getEvent.get(evt.id).processed, 1);
  });

  it('infers laden direction from a Nyinahin origin', () => {
    const evt = mkEvt({
      event_type: 'trip_start',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-02', origin: 'Nyinahin Mine Access Road' }),
    });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);
    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips[0].direction, 'laden');
  });

  it('infers empty direction from a Takoradi origin', () => {
    const evt = mkEvt({
      event_type: 'trip_start',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-03', origin: 'Takoradi Port Gate' }),
    });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);
    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips[0].direction, 'empty');
  });

  it('suppresses a duplicate trip_start within the 30-minute dedup window', () => {
    const payload = JSON.stringify({ vehicle_id: 'TRUCK-04', timestamp: new Date().toISOString() });
    const e1 = mkEvt({ event_type: 'trip_start', raw_json: payload });
    const e2 = mkEvt({ event_type: 'trip_start', raw_json: payload }); // same vehicle
    insertEvent.run(e1);
    insertEvent.run(e2);

    eventProcessor.processIds([e1.id, e2.id]);

    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips.length, 1, 'second trip_start should be suppressed');
    // Both events are marked done — dedup is a soft suppress, not a failure
    assert.strictEqual(getEvent.get(e1.id).processed, 1);
    assert.strictEqual(getEvent.get(e2.id).processed, 1);
  });

  it('upserts position from trip_start payload when coordinates are present', () => {
    const evt = mkEvt({
      event_type: 'trip_start',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-05', latitude: 6.834, longitude: -2.054, speed_kmh: 0 }),
    });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);

    const pos = positionStore.byVehicle('TRUCK-05');
    assert.ok(pos, 'position should be stored from trip_start');
    assert.strictEqual(pos.latitude,  6.834);
    assert.strictEqual(pos.longitude, -2.054);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('eventProcessor — trip_end', () => {
  beforeEach(clearTables);

  it('closes an open trip and computes duration', () => {
    const departedAt = new Date(Date.now() - 90 * 60_000).toISOString(); // 90 min ago
    const arrivedAt  = new Date().toISOString();

    const eStart = mkEvt({
      event_type: 'trip_start',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-06', timestamp: departedAt }),
    });
    const eEnd = mkEvt({
      event_type: 'trip_end',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-06', timestamp: arrivedAt, distance_km: 180 }),
    });
    insertEvent.run(eStart);
    insertEvent.run(eEnd);
    eventProcessor.processIds([eStart.id, eEnd.id]);

    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips.length, 1);
    assert.strictEqual(trips[0].status,      'completed');
    assert.strictEqual(trips[0].distance_km, 180);
    assert.ok(trips[0].duration_min >= 88 && trips[0].duration_min <= 92,
      `duration should be ~90 min, got ${trips[0].duration_min}`);
  });

  it('estimates fuel burn and trip cost from distance', () => {
    // FUEL_L_PER_100KM=42 (default), DIESEL_USD_PER_L=1.25 (default)
    // distance 100 km → 42 L → $52.50
    const eStart = mkEvt({ event_type: 'trip_start', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-07' }) });
    const eEnd   = mkEvt({ event_type: 'trip_end',   raw_json: JSON.stringify({ vehicle_id: 'TRUCK-07', distance_km: 100 }) });
    insertEvent.run(eStart);
    insertEvent.run(eEnd);
    eventProcessor.processIds([eStart.id, eEnd.id]);

    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips[0].estimated_fuel_l,    42);
    assert.strictEqual(trips[0].estimated_cost_usd,  52.5);
  });

  it('creates a completed trip directly when no matching open trip exists', () => {
    const eEnd = mkEvt({
      event_type: 'trip_end',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-08', distance_km: 200, timestamp: new Date().toISOString() }),
    });
    insertEvent.run(eEnd);
    eventProcessor.processIds([eEnd.id]);

    const { trips } = tripStore.list({ hauler_id: 'haulco-1' });
    assert.strictEqual(trips.length, 1);
    assert.strictEqual(trips[0].status,      'completed');
    assert.strictEqual(trips[0].vehicle_id,  'TRUCK-08');
    assert.strictEqual(trips[0].distance_km, 200);
    assert.strictEqual(getEvent.get(eEnd.id).processed, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('eventProcessor — position', () => {
  beforeEach(clearTables);

  it('upserts vehicle_positions and marks event done', () => {
    const ts  = new Date().toISOString();
    const evt = mkEvt({
      event_type: 'position',
      raw_json: JSON.stringify({ vehicle_id: 'TRUCK-09', latitude: 6.834, longitude: -2.054, speed_kmh: 62, timestamp: ts }),
    });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);

    const pos = positionStore.byVehicle('TRUCK-09');
    assert.ok(pos, 'position record should exist');
    assert.strictEqual(pos.latitude,   6.834);
    assert.strictEqual(pos.longitude,  -2.054);
    assert.strictEqual(pos.speed_kmh,  62);
    assert.strictEqual(pos.hauler_id,  'haulco-1');
    assert.strictEqual(getEvent.get(evt.id).processed, 1);
  });

  it('silently skips position event with no vehicle_id', () => {
    const evt = mkEvt({
      event_type: 'position',
      raw_json: JSON.stringify({ latitude: 5.0, longitude: -2.0 }),
    });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);

    assert.strictEqual(positionStore.all().length, 0, 'no position should be stored');
    assert.strictEqual(getEvent.get(evt.id).processed, 1, 'event is still marked done');
  });

  it('does not overwrite a newer position with an older one', () => {
    const now   = new Date().toISOString();
    const older = new Date(Date.now() - 30_000).toISOString(); // 30 s ago

    // Process newer first
    const e1 = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-10', latitude: 6.0, timestamp: now }) });
    // Then an older update arrives out of order
    const e2 = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-10', latitude: 5.0, timestamp: older }) });
    insertEvent.run(e1);
    insertEvent.run(e2);
    eventProcessor.processIds([e1.id, e2.id]);

    const pos = positionStore.byVehicle('TRUCK-10');
    assert.strictEqual(pos.latitude, 6.0, 'newer position should not be overwritten by stale update');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('eventProcessor — error handling', () => {
  beforeEach(clearTables);

  it('marks an event failed (-1) when raw_json is invalid', () => {
    const evt = mkEvt({ event_type: 'trip_start', raw_json: 'NOT { valid JSON ~~~' });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);
    assert.strictEqual(getEvent.get(evt.id).processed, -1);
  });

  it('marks unknown event_type as done (processed=1) without error', () => {
    const evt = mkEvt({ event_type: 'future_event_type', raw_json: '{"foo":1}' });
    insertEvent.run(evt);
    eventProcessor.processIds([evt.id]);
    assert.strictEqual(getEvent.get(evt.id).processed, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('eventProcessor — processPending / processIds', () => {
  beforeEach(clearTables);

  it('processPending returns { processed, failed } counts', () => {
    const good1 = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-11', latitude: 5.1, longitude: -2.1 }) });
    const good2 = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-12', latitude: 5.2, longitude: -2.2 }) });
    const bad   = mkEvt({ event_type: 'trip_start', raw_json: 'INVALID' });
    insertEvent.run(good1);
    insertEvent.run(good2);
    insertEvent.run(bad);

    const { processed, failed } = eventProcessor.processPending();
    assert.strictEqual(processed, 2);
    assert.strictEqual(failed,    1);
    assert.strictEqual(getEvent.get(good1.id).processed,  1);
    assert.strictEqual(getEvent.get(good2.id).processed,  1);
    assert.strictEqual(getEvent.get(bad.id).processed,   -1);
  });

  it('processPending returns { processed:0, failed:0 } when nothing is pending', () => {
    const result = eventProcessor.processPending();
    assert.deepStrictEqual(result, { processed: 0, failed: 0 });
  });

  it('processIds only processes the specified event ids', () => {
    const e1 = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-13', latitude: 5.3 }) });
    const e2 = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-14', latitude: 5.4 }) });
    insertEvent.run(e1);
    insertEvent.run(e2);

    // Process only e1
    eventProcessor.processIds([e1.id]);

    assert.strictEqual(getEvent.get(e1.id).processed, 1,  'e1 should be processed');
    assert.strictEqual(getEvent.get(e2.id).processed, 0,  'e2 should remain pending');
  });

  it('processIds with an empty list is a no-op', () => {
    const evt = mkEvt({ event_type: 'position', raw_json: JSON.stringify({ vehicle_id: 'TRUCK-15' }) });
    insertEvent.run(evt);
    eventProcessor.processIds([]);
    assert.strictEqual(getEvent.get(evt.id).processed, 0, 'event should remain unprocessed');
  });
});
