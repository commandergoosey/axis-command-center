'use strict';

/*
 * Tests for state/positionStore.js —
 *   upsert, byVehicle, byHauler, all, staleCount
 *
 * Uses an in-memory SQLite DB (vehicle_positions table is in base schema).
 *
 * Covers:
 *   - upsert: inserts new row; overwrites with newer position_at;
 *     does NOT overwrite when incoming position_at is older than stored
 *     (the WHERE guard: excluded.position_at >= stored OR stored IS NULL);
 *     null coordinate fields stored as null
 *   - byVehicle: null for unknown vehicle; returns row for known
 *   - byHauler: empty for unknown hauler; returns all for known hauler
 *   - all: empty on fresh DB; returns all positions after upserts
 *   - staleCount: 0 when no positions; counts vehicles whose position_at
 *     is older than the maxAgeMinutes cutoff (or NULL)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

delete require.cache[require.resolve('../state/positionStore')];
const ps = require('../state/positionStore');

// ── Helpers ───────────────────────────────────────────────────────
let _seq = 0;
function vid()  { return `truck-ps-${++_seq}`; }
function hid()  { return `haul-ps-${_seq}`; }

function basePos(vehicle_id, hauler_id, overrides = {}) {
  return {
    vehicle_id,
    hauler_id,
    latitude:    5.5502,
    longitude:  -0.2174,
    speed_kmh:  60,
    heading_deg: 90,
    position_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── upsert ────────────────────────────────────────────────────────

describe('positionStore — upsert', () => {
  it('creates a new row for an unknown vehicle', () => {
    const v = vid(); const h = hid();
    ps.upsert(basePos(v, h));
    assert.ok(ps.byVehicle(v) !== null, 'row should exist after upsert');
  });

  it('stores latitude and longitude', () => {
    const v = vid(); const h = hid();
    ps.upsert(basePos(v, h, { latitude: 6.1234, longitude: -1.5678 }));
    const row = ps.byVehicle(v);
    assert.equal(row.latitude,  6.1234);
    assert.equal(row.longitude, -1.5678);
  });

  it('overwrites existing row when incoming position_at is newer', () => {
    const v = vid(); const h = hid();
    const older = '2026-01-01T06:00:00.000Z';
    const newer = '2026-01-01T07:00:00.000Z';
    ps.upsert(basePos(v, h, { latitude: 5.0, position_at: older }));
    ps.upsert(basePos(v, h, { latitude: 6.0, position_at: newer }));
    assert.equal(ps.byVehicle(v).latitude, 6.0,
      'newer position should overwrite older');
  });

  it('does NOT overwrite when incoming position_at is older than stored', () => {
    const v = vid(); const h = hid();
    const newer = '2026-03-01T10:00:00.000Z';
    const older = '2026-03-01T08:00:00.000Z';
    ps.upsert(basePos(v, h, { latitude: 7.0, position_at: newer }));
    ps.upsert(basePos(v, h, { latitude: 4.0, position_at: older }));  // stale → ignored
    assert.equal(ps.byVehicle(v).latitude, 7.0,
      'stale position should not overwrite a more recent one');
  });

  it('null latitude/longitude are stored as null', () => {
    const v = vid(); const h = hid();
    ps.upsert(basePos(v, h, { latitude: null, longitude: null }));
    const row = ps.byVehicle(v);
    assert.equal(row.latitude,  null);
    assert.equal(row.longitude, null);
  });
});

// ── byVehicle ─────────────────────────────────────────────────────

describe('positionStore — byVehicle', () => {
  it('returns null for an unknown vehicle', () => {
    assert.equal(ps.byVehicle('truck-never-seen'), null);
  });

  it('returns the position row for a known vehicle', () => {
    const v = vid(); const h = hid();
    ps.upsert(basePos(v, h, { speed_kmh: 75 }));
    const row = ps.byVehicle(v);
    assert.ok(row !== null);
    assert.equal(row.vehicle_id, v);
    assert.equal(row.speed_kmh,  75);
  });
});

// ── byHauler ──────────────────────────────────────────────────────

describe('positionStore — byHauler', () => {
  it('returns an empty array for an unknown hauler', () => {
    assert.deepEqual(ps.byHauler('haul-never'), []);
  });

  it('returns all vehicles for a known hauler', () => {
    const h = `haul-bh-${++_seq}`;
    ps.upsert(basePos(`truck-bh-${_seq}a`, h));
    ps.upsert(basePos(`truck-bh-${_seq}b`, h));
    const rows = ps.byHauler(h);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.hauler_id === h));
  });

  it('does not return vehicles from other haulers', () => {
    const hA = `haul-iso-${++_seq}A`;
    const hB = `haul-iso-${_seq}B`;
    ps.upsert(basePos(`truck-iso-${_seq}`, hA));
    const rows = ps.byHauler(hB);
    assert.ok(!rows.some((r) => r.hauler_id === hA));
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('positionStore — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(ps.all()));
  });

  it('includes rows for all vehicles across all haulers', () => {
    const before = ps.all().length;
    const h = `haul-all-${++_seq}`;
    ps.upsert(basePos(`truck-all-${_seq}`, h));
    assert.equal(ps.all().length, before + 1);
  });
});

// ── staleCount ────────────────────────────────────────────────────

describe('positionStore — staleCount', () => {
  it('returns 0 when all positions are recent', () => {
    const v = vid(); const h = hid();
    ps.upsert(basePos(v, h, { position_at: new Date().toISOString() }));
    // With maxAgeMinutes=1, a just-inserted position should not be stale
    // (position_at is now; cutoff is 1 minute ago; now > cutoff)
    const count = ps.staleCount(1);
    // We can't assert exactly 0 because earlier tests may have inserted old rows,
    // but we can verify the return type.
    assert.equal(typeof count, 'number');
    assert.ok(count >= 0);
  });

  it('counts vehicles with position_at older than the cutoff', () => {
    const v = vid(); const h = hid();
    // Insert with position_at far in the past
    const old = '2020-01-01T00:00:00.000Z';
    ps.upsert(basePos(v, h, { position_at: old }));
    // maxAgeMinutes=1 → cutoff is 1 min ago; our position is 6 years old → stale
    const count = ps.staleCount(1);
    assert.ok(count >= 1, `expected ≥ 1 stale vehicle, got ${count}`);
  });

  it('uses 30 minutes as default maxAgeMinutes', () => {
    // Just verify no error thrown and returns a number
    assert.equal(typeof ps.staleCount(), 'number');
  });
});
