'use strict';

/*
 * Tests for state/tripStore.js —
 *   create, close, findById, update, findOpenByVehicle, list, forDateRange
 *
 * Uses an in-memory SQLite DB. No seed() call; the trips table starts empty
 * on every test run.
 *
 * Three columns used by the `update` prepared statement are added by
 * migration 008 and are not in the base schema: estimated_fuel_l,
 * estimated_cost_usd, convoy_id. We apply them directly to the in-memory
 * DB before requiring tripStore so the prepared statement compiles.
 *
 * Covers:
 *   - create: defaults (status, direction, source, null fields); provided
 *     values stored; findById round-trip
 *   - findById: null for unknown; returns row for known
 *   - close: status→completed; arrived_at set; duration computed from
 *     departed_at when not supplied; explicit duration accepted;
 *     distance_km stored; tonnage_t falls back to original trip value
 *   - findOpenByVehicle: null when no open trip; returns open trip;
 *     null after close
 *   - list: { trips, total } shape; empty; hauler_id filter; status filter;
 *     limit / offset pagination; total independent of offset
 *   - forDateRange: only completed trips; date range inclusive/exclusive;
 *     hauler_id filter; in-progress excluded
 *   - update: COALESCE semantics (null does not overwrite); patches direction,
 *     tonnage_t; returns null for unknown id
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

// Apply migration-008 columns that tripStore's `update` stmt references
db.exec(`
  ALTER TABLE trips ADD COLUMN estimated_fuel_l    REAL;
  ALTER TABLE trips ADD COLUMN estimated_cost_usd  REAL;
  ALTER TABLE trips ADD COLUMN convoy_id           TEXT;
`);

delete require.cache[require.resolve('../state/tripStore')];
const ts = require('../state/tripStore');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

function newTrip(overrides = {}) {
  _seq += 1;
  return {
    hauler_id:  `haul-t${String(_seq).padStart(2, '0')}`,
    vehicle_id: `truck-${_seq}`,
    ...overrides,
  };
}

/** Create a trip and immediately close it to produce a completed row. */
function createCompleted(hauler_id, { departed_at, arrived_at, tonnage_t, distance_km } = {}) {
  const dep = departed_at ?? new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hr ago
  const trip = ts.create({ hauler_id, vehicle_id: `v-${_seq}`, departed_at: dep, tonnage_t });
  return ts.close(trip.id, {
    arrived_at:  arrived_at ?? new Date().toISOString(),
    distance_km: distance_km ?? 300,
    tonnage_t,
  });
}

// ── create ────────────────────────────────────────────────────────

describe('tripStore — create', () => {
  it('returns a row with a non-null id', () => {
    const row = ts.create(newTrip());
    assert.ok(row !== null);
    assert.ok(typeof row.id === 'string' && row.id.length > 0);
  });

  it('status is "in_progress" by default', () => {
    const row = ts.create(newTrip());
    assert.equal(row.status, 'in_progress');
  });

  it('direction defaults to "laden"', () => {
    const row = ts.create(newTrip());
    assert.equal(row.direction, 'laden');
  });

  it('source defaults to "webhook"', () => {
    const row = ts.create(newTrip());
    assert.equal(row.source, 'webhook');
  });

  it('arrived_at is null on creation', () => {
    const row = ts.create(newTrip());
    assert.equal(row.arrived_at, null);
  });

  it('duration_min is null on creation', () => {
    const row = ts.create(newTrip());
    assert.equal(row.duration_min, null);
  });

  it('distance_km is null on creation', () => {
    const row = ts.create(newTrip());
    assert.equal(row.distance_km, null);
  });

  it('provided tonnage_t is stored', () => {
    const row = ts.create(newTrip({ tonnage_t: 28.5 }));
    assert.equal(row.tonnage_t, 28.5);
  });

  it('provided direction is stored', () => {
    const row = ts.create(newTrip({ direction: 'empty' }));
    assert.equal(row.direction, 'empty');
  });

  it('provided departed_at is stored verbatim', () => {
    const dep = '2026-03-15T06:00:00.000Z';
    const row = ts.create(newTrip({ departed_at: dep }));
    assert.equal(row.departed_at, dep);
  });

  it('created trip is retrievable via findById', () => {
    const row = ts.create(newTrip());
    const found = ts.findById(row.id);
    assert.ok(found !== null);
    assert.equal(found.id, row.id);
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('tripStore — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(ts.findById('00000000deadbeef'), null);
  });

  it('returns the row for a known id', () => {
    const row = ts.create(newTrip());
    const found = ts.findById(row.id);
    assert.equal(found.id,     row.id);
    assert.equal(found.status, 'in_progress');
  });
});

// ── close ─────────────────────────────────────────────────────────

describe('tripStore — close', () => {
  it('sets status to "completed"', () => {
    const trip = ts.create(newTrip());
    const closed = ts.close(trip.id);
    assert.equal(closed.status, 'completed');
  });

  it('sets arrived_at to the provided value', () => {
    const trip     = ts.create(newTrip());
    const arrivedAt = '2026-04-01T14:30:00.000Z';
    const closed   = ts.close(trip.id, { arrived_at: arrivedAt });
    assert.equal(closed.arrived_at, arrivedAt);
  });

  it('computes duration_min from departed_at when not supplied', () => {
    const dep  = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hrs ago
    const arr  = new Date().toISOString();
    const trip = ts.create(newTrip({ departed_at: dep }));
    const closed = ts.close(trip.id, { arrived_at: arr });
    // 2-hour trip = ~120 minutes (±1 for rounding)
    assert.ok(
      closed.duration_min >= 119 && closed.duration_min <= 121,
      `expected ~120 min, got ${closed.duration_min}`,
    );
  });

  it('uses explicitly provided duration_min without recomputing', () => {
    const trip   = ts.create(newTrip());
    const closed = ts.close(trip.id, { duration_min: 90 });
    assert.equal(closed.duration_min, 90);
  });

  it('stores provided distance_km', () => {
    const trip   = ts.create(newTrip());
    const closed = ts.close(trip.id, { distance_km: 350 });
    assert.equal(closed.distance_km, 350);
  });

  it('uses provided tonnage_t over original trip value', () => {
    const trip   = ts.create(newTrip({ tonnage_t: 20 }));
    const closed = ts.close(trip.id, { tonnage_t: 25 });
    assert.equal(closed.tonnage_t, 25);
  });

  it('falls back to original trip tonnage_t when not provided in close()', () => {
    const trip   = ts.create(newTrip({ tonnage_t: 22 }));
    const closed = ts.close(trip.id, {});
    assert.equal(closed.tonnage_t, 22);
  });

  it('returns the updated row', () => {
    const trip = ts.create(newTrip());
    const closed = ts.close(trip.id);
    assert.ok(closed !== null);
    assert.equal(closed.id, trip.id);
  });
});

// ── findOpenByVehicle ─────────────────────────────────────────────

describe('tripStore — findOpenByVehicle', () => {
  it('returns null when no open trip exists for the vehicle', () => {
    assert.equal(ts.findOpenByVehicle('vehicle-never-seen'), null);
  });

  it('returns the in-progress trip for a vehicle', () => {
    const trip = ts.create(newTrip({ vehicle_id: 'truck-fov-01' }));
    const found = ts.findOpenByVehicle('truck-fov-01');
    assert.ok(found !== null);
    assert.equal(found.id, trip.id);
  });

  it('returns null after the trip has been closed', () => {
    const trip = ts.create(newTrip({ vehicle_id: 'truck-fov-02' }));
    ts.close(trip.id);
    assert.equal(ts.findOpenByVehicle('truck-fov-02'), null);
  });
});

// ── list ──────────────────────────────────────────────────────────

describe('tripStore — list', () => {
  it('returns an object with trips array and total number', () => {
    const result = ts.list();
    assert.ok(Array.isArray(result.trips), 'trips should be an array');
    assert.ok(typeof result.total === 'number', 'total should be a number');
  });

  it('trips and total reflect all inserted trips with no filter', () => {
    const haulerId = `haul-list-${++_seq}`;
    ts.create({ hauler_id: haulerId, vehicle_id: 'v1' });
    ts.create({ hauler_id: haulerId, vehicle_id: 'v2' });
    const result = ts.list({ hauler_id: haulerId });
    assert.equal(result.trips.length, 2);
    assert.equal(result.total,        2);
  });

  it('hauler_id filter returns only matching hauler trips', () => {
    const hA = `haul-fA-${++_seq}`;
    const hB = `haul-fB-${++_seq}`;
    ts.create({ hauler_id: hA, vehicle_id: 'vA' });
    ts.create({ hauler_id: hB, vehicle_id: 'vB' });
    const result = ts.list({ hauler_id: hA });
    assert.ok(result.trips.every((t) => t.hauler_id === hA),
      'hauler_id filter should return only that hauler\'s trips');
  });

  it('status filter returns only matching trips', () => {
    const haulerId = `haul-sf-${++_seq}`;
    const trip = ts.create({ hauler_id: haulerId, vehicle_id: 'vsf' });
    ts.close(trip.id);
    const inProg = ts.list({ hauler_id: haulerId, status: 'in_progress' });
    const done   = ts.list({ hauler_id: haulerId, status: 'completed' });
    assert.equal(inProg.trips.length, 0);
    assert.equal(done.trips.length,   1);
  });

  it('limit constrains the number of returned trips', () => {
    const haulerId = `haul-lim-${++_seq}`;
    for (let i = 0; i < 5; i++) ts.create({ hauler_id: haulerId, vehicle_id: `vl${i}` });
    const result = ts.list({ hauler_id: haulerId, limit: 2 });
    assert.equal(result.trips.length, 2);
    assert.equal(result.total,        5);   // total is unaffected by limit
  });

  it('offset skips earlier rows', () => {
    const haulerId = `haul-off-${++_seq}`;
    for (let i = 0; i < 4; i++) ts.create({ hauler_id: haulerId, vehicle_id: `vo${i}` });
    const p1 = ts.list({ hauler_id: haulerId, limit: 2, offset: 0 });
    const p2 = ts.list({ hauler_id: haulerId, limit: 2, offset: 2 });
    assert.equal(p1.trips.length, 2);
    assert.equal(p2.trips.length, 2);
    assert.ok(p1.trips[0].id !== p2.trips[0].id, 'pages should not overlap');
  });
});

// ── forDateRange ──────────────────────────────────────────────────

describe('tripStore — forDateRange', () => {
  it('returns an empty array when no completed trips exist for hauler', () => {
    const rows = ts.forDateRange('haul-never', '2026-01-01', '2026-12-31');
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });

  it('returns completed trips within the date range', () => {
    const hauler = `haul-dr-${++_seq}`;
    createCompleted(hauler, {
      departed_at: '2026-05-10T06:00:00.000Z',
      arrived_at:  '2026-05-10T14:00:00.000Z',
    });
    const rows = ts.forDateRange(hauler, '2026-05-10', '2026-05-11');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hauler_id, hauler);
  });

  it('excludes trips whose departed_at is before the from date', () => {
    const hauler = `haul-dr2-${++_seq}`;
    createCompleted(hauler, {
      departed_at: '2026-04-01T06:00:00.000Z',
      arrived_at:  '2026-04-01T14:00:00.000Z',
    });
    const rows = ts.forDateRange(hauler, '2026-05-01', '2026-06-01');
    assert.equal(rows.length, 0, 'trip before range should be excluded');
  });

  it('excludes trips whose departed_at is on or after the to date (exclusive upper bound)', () => {
    const hauler = `haul-dr3-${++_seq}`;
    createCompleted(hauler, {
      departed_at: '2026-06-01T00:00:00.000Z',
      arrived_at:  '2026-06-01T08:00:00.000Z',
    });
    const rows = ts.forDateRange(hauler, '2026-05-01', '2026-06-01');
    assert.equal(rows.length, 0, 'trip at upper bound should be excluded (< to)');
  });

  it('excludes in-progress trips (only completed are returned)', () => {
    const hauler = `haul-dr4-${++_seq}`;
    ts.create({ hauler_id: hauler, vehicle_id: 'v-ip', departed_at: '2026-05-15T06:00:00.000Z' });
    const rows = ts.forDateRange(hauler, '2026-05-01', '2026-06-01');
    assert.equal(rows.length, 0, 'in-progress trips should not appear in forDateRange');
  });

  it('hauler_id filter isolates trips to the requested hauler', () => {
    const hA = `haul-drA-${++_seq}`;
    const hB = `haul-drB-${++_seq}`;
    createCompleted(hA, { departed_at: '2026-05-20T06:00:00.000Z', arrived_at: '2026-05-20T14:00:00.000Z' });
    createCompleted(hB, { departed_at: '2026-05-20T06:00:00.000Z', arrived_at: '2026-05-20T14:00:00.000Z' });
    const rows = ts.forDateRange(hA, '2026-05-20', '2026-05-21');
    assert.ok(rows.every((r) => r.hauler_id === hA),
      'forDateRange should only return trips for the requested hauler');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('tripStore — update', () => {
  it('COALESCE: null value does not overwrite an existing non-null field', () => {
    const trip = ts.create(newTrip({ tonnage_t: 30, direction: 'laden' }));
    // Pass null for tonnage_t and direction — should not overwrite
    ts.update(trip.id, { tonnage_t: null, direction: null });
    const row = ts.findById(trip.id);
    assert.equal(row.tonnage_t, 30,      'tonnage_t should not be overwritten by null');
    assert.equal(row.direction, 'laden', 'direction should not be overwritten by null');
  });

  it('patches direction when provided', () => {
    const trip = ts.create(newTrip({ direction: 'laden' }));
    ts.update(trip.id, { direction: 'empty' });
    assert.equal(ts.findById(trip.id).direction, 'empty');
  });

  it('patches tonnage_t when provided', () => {
    const trip = ts.create(newTrip({ tonnage_t: 20 }));
    ts.update(trip.id, { tonnage_t: 35 });
    assert.equal(ts.findById(trip.id).tonnage_t, 35);
  });

  it('patches distance_km when provided', () => {
    const trip   = ts.create(newTrip());
    ts.update(trip.id, { distance_km: 280 });
    assert.equal(ts.findById(trip.id).distance_km, 280);
  });

  it('returns null for an unknown trip id', () => {
    assert.equal(ts.update('00000000deadbeef', { tonnage_t: 10 }), null);
  });

  it('returns the updated row', () => {
    const trip = ts.create(newTrip());
    const result = ts.update(trip.id, { tonnage_t: 18 });
    assert.ok(result !== null);
    assert.equal(result.id, trip.id);
  });
});
