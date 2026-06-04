'use strict';

/*
 * Tests for state/fleetStatus.js —
 *   setStatus, getAllOverrides, getOverride, applyOverride
 *
 * Uses an in-memory SQLite DB. fleetStatus.js creates its own
 * fleet_status_overrides table idempotently (PRIMARY KEY rig_id →
 * one override per truck, upsert semantics). No stubs required.
 *
 * Covers:
 *   - setStatus: rig_id required; invalid status throws; invalid
 *     maintenance_flag throws; empty string flag coerced to null;
 *     stores all fields; updated_at recent ISO; upsert overwrites on
 *     same rig_id; returns the raw row
 *   - getAllOverrides: returns a Map; keyed by rig_id; value is row;
 *     size increments; reflects latest upsert
 *   - getOverride: null for unknown rig_id; row for known
 *   - applyOverride: no override → truck unchanged; override applied →
 *     status and maintenance_flag replaced; _status_override envelope
 *     added; does not mutate original truck or override objects
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/fleetStatus')];
const fs = require('../state/fleetStatus');

let _seq = 0;
function rig() { return `rig-fs-${String(++_seq).padStart(3, '0')}`; }

function baseSet(overrides = {}) {
  return {
    rig_id:          rig(),
    status:          'idle',
    maintenance_flag: null,
    notes:           'Routine update',
    updated_by_id:   'u-fs-01',
    updated_by_name: 'Fleet Manager',
    ...overrides,
  };
}

// ── setStatus ─────────────────────────────────────────────────────

describe('fleetStatus — setStatus', () => {
  it('throws when rig_id is missing', () => {
    assert.throws(
      () => fs.setStatus({ ...baseSet(), rig_id: null }),
      /rig_id required/i,
    );
  });

  it('throws for an invalid status', () => {
    assert.throws(
      () => fs.setStatus(baseSet({ status: 'parked' })),
      /status must be one of/i,
    );
  });

  it('throws for an invalid maintenance_flag', () => {
    assert.throws(
      () => fs.setStatus(baseSet({ maintenance_flag: 'broken' })),
      /maintenance_flag must be one of/i,
    );
  });

  it('coerces empty string maintenance_flag to null', () => {
    const rigId = rig();
    const row = fs.setStatus(baseSet({ rig_id: rigId, maintenance_flag: '' }));
    assert.equal(row.maintenance_flag, null);
  });

  it('stores status', () => {
    const rigId = rig();
    const row = fs.setStatus(baseSet({ rig_id: rigId, status: 'garage' }));
    assert.equal(row.status, 'garage');
  });

  it('stores maintenance_flag when provided', () => {
    const rigId = rig();
    const row = fs.setStatus(baseSet({ rig_id: rigId, maintenance_flag: 'critical' }));
    assert.equal(row.maintenance_flag, 'critical');
  });

  it('maintenance_flag is null when not provided', () => {
    const rigId = rig();
    const row = fs.setStatus(baseSet({ rig_id: rigId, maintenance_flag: null }));
    assert.equal(row.maintenance_flag, null);
  });

  it('trims and stores notes', () => {
    const rigId = rig();
    const row = fs.setStatus(baseSet({ rig_id: rigId, notes: '  Oil change done  ' }));
    assert.equal(row.notes, 'Oil change done');
  });

  it('notes is null when not provided', () => {
    const rigId = rig();
    const row = fs.setStatus({ rig_id: rigId, status: 'active', updated_by_id: 'u1', updated_by_name: 'U1' });
    assert.equal(row.notes, null);
  });

  it('updated_at is a recent ISO string', () => {
    const rigId = rig();
    const before = Date.now();
    const row = fs.setStatus(baseSet({ rig_id: rigId }));
    const after = Date.now();
    assert.ok(new Date(row.updated_at).getTime() >= before);
    assert.ok(new Date(row.updated_at).getTime() <= after);
  });

  it('returns the stored row', () => {
    const rigId = rig();
    const row = fs.setStatus(baseSet({ rig_id: rigId }));
    assert.equal(row.rig_id, rigId);
  });

  it('upsert: second setStatus overwrites the row for same rig_id', () => {
    const rigId = rig();
    fs.setStatus(baseSet({ rig_id: rigId, status: 'idle' }));
    fs.setStatus(baseSet({ rig_id: rigId, status: 'garage' }));
    assert.equal(fs.getOverride(rigId).status, 'garage');
  });

  it('upsert: does not create a duplicate row', () => {
    const rigId = rig();
    fs.setStatus(baseSet({ rig_id: rigId }));
    fs.setStatus(baseSet({ rig_id: rigId }));
    // Map should still have exactly one entry per rig
    assert.ok(fs.getAllOverrides().has(rigId));
  });
});

// ── getAllOverrides ───────────────────────────────────────────────

describe('fleetStatus — getAllOverrides', () => {
  it('returns a Map', () => {
    assert.ok(fs.getAllOverrides() instanceof Map);
  });

  it('Map is keyed by rig_id', () => {
    const rigId = rig();
    fs.setStatus(baseSet({ rig_id: rigId }));
    const map = fs.getAllOverrides();
    assert.ok(map.has(rigId));
    assert.equal(map.get(rigId).rig_id, rigId);
  });

  it('size increments after each new rig setStatus()', () => {
    const before = fs.getAllOverrides().size;
    fs.setStatus(baseSet());
    assert.equal(fs.getAllOverrides().size, before + 1);
  });
});

// ── getOverride ───────────────────────────────────────────────────

describe('fleetStatus — getOverride', () => {
  it('returns null for an unknown rig_id', () => {
    assert.equal(fs.getOverride('rig-never'), null);
  });

  it('returns the row for a known rig_id', () => {
    const rigId = rig();
    fs.setStatus(baseSet({ rig_id: rigId, status: 'in_transit' }));
    const row = fs.getOverride(rigId);
    assert.ok(row !== null);
    assert.equal(row.rig_id, rigId);
    assert.equal(row.status, 'in_transit');
  });
});

// ── applyOverride ─────────────────────────────────────────────────

describe('fleetStatus — applyOverride', () => {
  const mockTruck = {
    id: 'rig-mock-001',
    status: 'active',
    maintenance_flag: null,
    plate: 'GH-0001',
  };

  it('returns the truck unchanged when override is null', () => {
    const result = fs.applyOverride(mockTruck, null);
    assert.equal(result.status,           mockTruck.status);
    assert.equal(result.maintenance_flag, mockTruck.maintenance_flag);
    assert.ok(!('_status_override' in result));
  });

  it('applies status from override', () => {
    const override = { status: 'garage', maintenance_flag: null, notes: null,
                       updated_by_name: 'Ops', updated_at: new Date().toISOString() };
    const result = fs.applyOverride(mockTruck, override);
    assert.equal(result.status, 'garage');
  });

  it('applies maintenance_flag from override', () => {
    const override = { status: 'idle', maintenance_flag: 'service_due', notes: null,
                       updated_by_name: 'Ops', updated_at: new Date().toISOString() };
    const result = fs.applyOverride(mockTruck, override);
    assert.equal(result.maintenance_flag, 'service_due');
  });

  it('adds _status_override envelope with notes/updated_by_name/updated_at', () => {
    const override = { status: 'idle', maintenance_flag: null, notes: 'Scheduled',
                       updated_by_name: 'Manager', updated_at: '2026-06-01T00:00:00.000Z' };
    const result = fs.applyOverride(mockTruck, override);
    assert.ok('_status_override' in result);
    assert.equal(result._status_override.notes,           'Scheduled');
    assert.equal(result._status_override.updated_by_name, 'Manager');
  });

  it('does not mutate the original truck object', () => {
    const truck = { ...mockTruck };
    const override = { status: 'garage', maintenance_flag: 'critical', notes: null,
                       updated_by_name: 'X', updated_at: new Date().toISOString() };
    fs.applyOverride(truck, override);
    assert.equal(truck.status,           'active');
    assert.equal(truck.maintenance_flag, null);
  });
});
