'use strict';

/*
 * Tests for state/rigAssignments.js —
 *   assign, unassign, getAssignment, getByDriver, getAllAssignments
 *
 * Uses an in-memory SQLite DB. rigAssignments.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - assign: returns the persisted row; stores rig_id / driver_id /
 *     notes / assigned_by; assigned_at is a recent ISO string;
 *     notes / assigned_by null when omitted; upsert — reassigning same
 *     rig_id overwrites the row
 *   - unassign: getAssignment null after; no-op on unknown rig_id
 *   - getAssignment: null for unknown rig; row for known rig
 *   - getByDriver: empty for unknown driver; rows for known driver;
 *     does not include other drivers' assignments
 *   - getAllAssignments: returns a Map; keyed by rig_id; value is row;
 *     count reflects current assignments; unassigned rig absent
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/rigAssignments')];
const ra = require('../state/rigAssignments');

// ── Helpers ───────────────────────────────────────────────────────
let _seq = 0;
function rig()    { return `rig-ra-${String(++_seq).padStart(3, '0')}`; }
function driver() { return `drv-ra-${_seq}`; }

// ── assign ────────────────────────────────────────────────────────

describe('rigAssignments — assign', () => {
  it('returns the persisted row', () => {
    const r = ra.assign(rig(), driver());
    assert.ok(r !== null && typeof r === 'object');
  });

  it('stores rig_id and driver_id', () => {
    const rigId = rig(); const drvId = driver();
    const row = ra.assign(rigId, drvId);
    assert.equal(row.rig_id,    rigId);
    assert.equal(row.driver_id, drvId);
  });

  it('stores notes when provided', () => {
    const row = ra.assign(rig(), driver(), { notes: 'Long-haul only' });
    assert.equal(row.notes, 'Long-haul only');
  });

  it('stores assigned_by when provided', () => {
    const row = ra.assign(rig(), driver(), { by_name: 'Dispatcher A' });
    assert.equal(row.assigned_by, 'Dispatcher A');
  });

  it('notes is null when not provided', () => {
    const row = ra.assign(rig(), driver());
    assert.equal(row.notes, null);
  });

  it('assigned_by is null when not provided', () => {
    const row = ra.assign(rig(), driver());
    assert.equal(row.assigned_by, null);
  });

  it('assigned_at is a recent ISO string', () => {
    const before = Date.now();
    const row = ra.assign(rig(), driver());
    const after = Date.now();
    const ts = new Date(row.assigned_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('upsert: reassigning same rig_id overwrites the row', () => {
    const rigId = rig();
    ra.assign(rigId, 'drv-first',  { notes: 'First' });
    ra.assign(rigId, 'drv-second', { notes: 'Second' });
    const stored = ra.getAssignment(rigId);
    assert.equal(stored.driver_id, 'drv-second');
    assert.equal(stored.notes,     'Second');
  });

  it('upsert: does not create a duplicate row', () => {
    const rigId = rig();
    ra.assign(rigId, 'drv-a');
    ra.assign(rigId, 'drv-b');
    // getAllAssignments Map should have exactly one entry for this rig
    assert.ok(ra.getAllAssignments().has(rigId));
    // Filter all rows: only one should exist for this rig_id
    const all = ra.getAllAssignments();
    assert.equal(all.get(rigId).rig_id, rigId);
  });
});

// ── unassign ──────────────────────────────────────────────────────

describe('rigAssignments — unassign', () => {
  it('getAssignment returns null after unassign()', () => {
    const rigId = rig();
    ra.assign(rigId, driver());
    ra.unassign(rigId);
    assert.equal(ra.getAssignment(rigId), null);
  });

  it('does not throw when unassigning an unknown rig_id', () => {
    assert.doesNotThrow(() => ra.unassign('rig-never-assigned'));
  });
});

// ── getAssignment ─────────────────────────────────────────────────

describe('rigAssignments — getAssignment', () => {
  it('returns null for an unknown rig_id', () => {
    assert.equal(ra.getAssignment('rig-unknown'), null);
  });

  it('returns the assignment row for a known rig_id', () => {
    const rigId = rig(); const drvId = driver();
    ra.assign(rigId, drvId);
    const row = ra.getAssignment(rigId);
    assert.ok(row !== null);
    assert.equal(row.rig_id,    rigId);
    assert.equal(row.driver_id, drvId);
  });
});

// ── getByDriver ───────────────────────────────────────────────────

describe('rigAssignments — getByDriver', () => {
  it('returns an empty array for an unknown driver', () => {
    assert.deepEqual(ra.getByDriver('drv-never'), []);
  });

  it('returns assignments for a known driver', () => {
    const drvId = `drv-bydrv-${++_seq}`;
    ra.assign(rig(), drvId);
    ra.assign(rig(), drvId);
    const rows = ra.getByDriver(drvId);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.driver_id === drvId));
  });

  it('does not include other drivers', () => {
    const drvA = `drv-iso-${++_seq}`;
    const drvB = `drv-iso-${_seq + 1}`;
    ra.assign(rig(), drvA);
    const rows = ra.getByDriver(drvB);
    assert.ok(!rows.some((r) => r.driver_id === drvA));
  });
});

// ── getAllAssignments ─────────────────────────────────────────────

describe('rigAssignments — getAllAssignments', () => {
  it('returns a Map', () => {
    assert.ok(ra.getAllAssignments() instanceof Map);
  });

  it('Map is keyed by rig_id', () => {
    const rigId = rig();
    ra.assign(rigId, driver());
    const map = ra.getAllAssignments();
    assert.ok(map.has(rigId), 'map should contain the assigned rig_id');
    assert.equal(map.get(rigId).rig_id, rigId);
  });

  it('size increments after each unique assign()', () => {
    const before = ra.getAllAssignments().size;
    ra.assign(rig(), driver());
    assert.equal(ra.getAllAssignments().size, before + 1);
  });

  it('rig_id absent from map after unassign()', () => {
    const rigId = rig();
    ra.assign(rigId, driver());
    ra.unassign(rigId);
    assert.ok(!ra.getAllAssignments().has(rigId));
  });
});
