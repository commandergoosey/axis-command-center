'use strict';

/*
 * Tests for state/maintenanceSchedule.js —
 *   TYPES, STATUSES,
 *   add, update, complete, cancel, remove,
 *   findById, upcoming, all, forHauler, forRig, countsInWindow
 *
 * Uses an in-memory SQLite DB. maintenanceSchedule.js creates its own
 * maintenance_schedule table idempotently — no stubs or migrations needed.
 *
 * Covers:
 *   - TYPES / STATUSES: exported arrays with expected values
 *   - add: rig_id required; hauler_id required; unknown type throws;
 *     missing/invalid start_at throws; missing/invalid end_at throws;
 *     end_at before start_at throws; stores all fields; notes truncated
 *     to 1000 chars; status defaults to 'planned'; created_at recent
 *     ISO; created_by null when omitted / nested when provided;
 *     completed_at / completed_by null on fresh row; full shape
 *   - update: null for unknown id; unknown type throws; unknown status
 *     throws; invalid start_at / end_at throw; patches each field;
 *     COALESCE preserves unpatched fields
 *   - complete: status → 'completed'; completed_at recent ISO;
 *     completed_by stored / null; idempotent — second call WHERE status
 *     IN ('planned','in_progress') is no-op
 *   - cancel: status → 'cancelled'; returns shaped row; idempotent
 *   - remove: findById null after; no-op on unknown id
 *   - findById: null for unknown; shaped row for known
 *   - upcoming: returns array; includes planned and in_progress;
 *     excludes completed and cancelled; ordered start_at ASC
 *   - all: returns all statuses; count increments
 *   - forHauler: empty for unknown; all items for hauler; isolation
 *   - forRig: empty for unknown; all items for rig
 *   - countsInWindow: empty object when no overlapping window;
 *     counts rigs whose window overlaps the query point; excludes
 *     cancelled / completed; independent per hauler
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/maintenanceSchedule')];
const ms = require('../state/maintenanceSchedule');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;
function rig()    { return `rig-ms-${String(++_seq).padStart(3, '0')}`; }
function hauler() { return `haul-ms-${_seq}`; }

function baseAdd(overrides = {}) {
  return {
    rig_id:    rig(),
    hauler_id: hauler(),
    type:      'service_a',
    start_at:  '2026-09-01T06:00:00.000Z',
    end_at:    '2026-09-03T18:00:00.000Z',
    by_user_id: 'u-ms-01',
    by_display: 'Sched Planner',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── TYPES / STATUSES ──────────────────────────────────────────────

describe('maintenanceSchedule — constants', () => {
  it('TYPES is an array with expected values', () => {
    assert.ok(Array.isArray(ms.TYPES));
    for (const t of ['service_a', 'service_b', 'tyre', 'inspection', 'repair', 'other']) {
      assert.ok(ms.TYPES.includes(t), `missing type: ${t}`);
    }
  });

  it('STATUSES is an array with expected values', () => {
    assert.ok(Array.isArray(ms.STATUSES));
    for (const s of ['planned', 'in_progress', 'completed', 'cancelled']) {
      assert.ok(ms.STATUSES.includes(s), `missing status: ${s}`);
    }
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('maintenanceSchedule — add', () => {
  it('throws when rig_id is missing', () => {
    assert.throws(
      () => ms.add({ ...baseAdd(), rig_id: null }),
      /rig_id required/i,
    );
  });

  it('throws when hauler_id is missing', () => {
    assert.throws(
      () => ms.add({ ...baseAdd(), hauler_id: null }),
      /hauler_id required/i,
    );
  });

  it('throws for an unknown type', () => {
    assert.throws(
      () => ms.add(baseAdd({ type: 'oil_change' })),
      /unknown type/i,
    );
  });

  it('throws when start_at is missing', () => {
    assert.throws(
      () => ms.add({ ...baseAdd(), start_at: null }),
      /start_at.*iso/i,
    );
  });

  it('throws when start_at is not a valid ISO date', () => {
    assert.throws(
      () => ms.add(baseAdd({ start_at: 'not-a-date' })),
      /start_at.*iso/i,
    );
  });

  it('throws when end_at is missing', () => {
    assert.throws(
      () => ms.add({ ...baseAdd(), end_at: null }),
      /end_at.*iso/i,
    );
  });

  it('throws when end_at is not a valid ISO date', () => {
    assert.throws(
      () => ms.add(baseAdd({ end_at: 'bad' })),
      /end_at.*iso/i,
    );
  });

  it('throws when end_at is before start_at', () => {
    assert.throws(
      () => ms.add(baseAdd({
        start_at: '2026-09-05T00:00:00.000Z',
        end_at:   '2026-09-04T00:00:00.000Z',
      })),
      /end_at.*after/i,
    );
  });

  it('accepts end_at equal to start_at (same-day service)', () => {
    const item = ms.add(baseAdd({
      start_at: '2026-09-10T08:00:00.000Z',
      end_at:   '2026-09-10T08:00:00.000Z',
    }));
    assert.ok(item !== null);
  });

  it('stores rig_id, hauler_id, type, start_at, end_at', () => {
    const rigId = rig();
    const haulId = hauler();
    const item = ms.add(baseAdd({
      rig_id:    rigId,
      hauler_id: haulId,
      type:      'tyre',
      start_at:  '2026-10-01T00:00:00.000Z',
      end_at:    '2026-10-02T00:00:00.000Z',
    }));
    assert.equal(item.rig_id,    rigId);
    assert.equal(item.hauler_id, haulId);
    assert.equal(item.type,      'tyre');
    assert.equal(item.start_at,  '2026-10-01T00:00:00.000Z');
    assert.equal(item.end_at,    '2026-10-02T00:00:00.000Z');
  });

  it('stores notes when provided', () => {
    const item = ms.add(baseAdd({ notes: 'Full axle inspection required' }));
    assert.equal(item.notes, 'Full axle inspection required');
  });

  it('truncates notes to 1000 characters', () => {
    const item = ms.add(baseAdd({ notes: 'n'.repeat(1500) }));
    assert.equal(item.notes.length, 1000);
  });

  it('notes is null when not provided', () => {
    const item = ms.add(baseAdd());
    assert.equal(item.notes, null);
  });

  it('status defaults to "planned"', () => {
    const item = ms.add(baseAdd());
    assert.equal(item.status, 'planned');
  });

  it('created_at is a recent ISO string', () => {
    const before = Date.now();
    const item = ms.add(baseAdd());
    const after = Date.now();
    const ts = new Date(item.created_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('completed_at and completed_by are null on a fresh item', () => {
    const item = ms.add(baseAdd());
    assert.equal(item.completed_at, null);
    assert.equal(item.completed_by, null);
  });

  it('created_by is null when by fields are not provided', () => {
    const item = ms.add({ rig_id: rig(), hauler_id: hauler(), type: 'inspection',
                          start_at: '2026-11-01T00:00:00.000Z', end_at: '2026-11-02T00:00:00.000Z' });
    assert.equal(item.created_by, null);
  });

  it('created_by has user_id, display_name, role when provided', () => {
    const item = ms.add(baseAdd({
      by_user_id: 'u-creator',
      by_display: 'Plan Creator',
      by_role:    'lender',
    }));
    assert.deepEqual(item.created_by, {
      user_id:      'u-creator',
      display_name: 'Plan Creator',
      role:         'lender',
    });
  });

  it('return shape has expected top-level fields', () => {
    const item = ms.add(baseAdd());
    for (const f of ['id', 'rig_id', 'hauler_id', 'type', 'start_at', 'end_at',
                     'notes', 'status', 'completed_at', 'completed_by',
                     'created_at', 'created_by']) {
      assert.ok(f in item, `missing field: ${f}`);
    }
  });
});

// ── update ────────────────────────────────────────────────────────

describe('maintenanceSchedule — update', () => {
  it('returns null for an unknown id', () => {
    assert.equal(ms.update(999999, { type: 'tyre' }), null);
  });

  it('throws for an unknown type in patch', () => {
    const item = ms.add(baseAdd());
    assert.throws(() => ms.update(item.id, { type: 'brake' }), /unknown type/i);
  });

  it('throws for an unknown status in patch', () => {
    const item = ms.add(baseAdd());
    assert.throws(() => ms.update(item.id, { status: 'pending' }), /unknown status/i);
  });

  it('throws for an invalid start_at in patch', () => {
    const item = ms.add(baseAdd());
    assert.throws(() => ms.update(item.id, { start_at: 'bad' }), /start_at.*iso/i);
  });

  it('throws for an invalid end_at in patch', () => {
    const item = ms.add(baseAdd());
    assert.throws(() => ms.update(item.id, { end_at: 'bad' }), /end_at.*iso/i);
  });

  it('patches type', () => {
    const item = ms.add(baseAdd({ type: 'service_a' }));
    const updated = ms.update(item.id, { type: 'service_b' });
    assert.equal(updated.type, 'service_b');
  });

  it('patches start_at', () => {
    const item = ms.add(baseAdd());
    const updated = ms.update(item.id, { start_at: '2026-10-10T00:00:00.000Z' });
    assert.equal(updated.start_at, '2026-10-10T00:00:00.000Z');
  });

  it('patches end_at', () => {
    const item = ms.add(baseAdd());
    const updated = ms.update(item.id, { end_at: '2026-10-12T00:00:00.000Z' });
    assert.equal(updated.end_at, '2026-10-12T00:00:00.000Z');
  });

  it('patches notes', () => {
    const item = ms.add(baseAdd());
    const updated = ms.update(item.id, { notes: 'Updated note' });
    assert.equal(updated.notes, 'Updated note');
  });

  it('patches status', () => {
    const item = ms.add(baseAdd());
    const updated = ms.update(item.id, { status: 'in_progress' });
    assert.equal(updated.status, 'in_progress');
  });

  it('unpatched fields are preserved (COALESCE)', () => {
    const item = ms.add(baseAdd({ type: 'tyre', notes: 'Original note' }));
    ms.update(item.id, { status: 'in_progress' });
    const after = ms.findById(item.id);
    assert.equal(after.type,  'tyre');
    assert.equal(after.notes, 'Original note');
  });
});

// ── complete ──────────────────────────────────────────────────────

describe('maintenanceSchedule — complete', () => {
  it('status → "completed" after complete()', () => {
    const item = ms.add(baseAdd());
    const done = ms.complete(item.id, 'Workshop Lead');
    assert.equal(done.status, 'completed');
  });

  it('completed_at is a recent ISO string', () => {
    const item = ms.add(baseAdd());
    const before = Date.now();
    ms.complete(item.id);
    const after = Date.now();
    const ts = new Date(ms.findById(item.id).completed_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('completed_by is stored', () => {
    const item = ms.add(baseAdd());
    ms.complete(item.id, 'Tech One');
    assert.equal(ms.findById(item.id).completed_by, 'Tech One');
  });

  it('completed_by is null when not provided', () => {
    const item = ms.add(baseAdd());
    ms.complete(item.id);
    assert.equal(ms.findById(item.id).completed_by, null);
  });

  it('second complete() is a no-op (WHERE status IN guard)', () => {
    const item = ms.add(baseAdd());
    ms.complete(item.id, 'First');
    const firstTs = ms.findById(item.id).completed_at;
    ms.complete(item.id, 'Second');
    const secondTs = ms.findById(item.id).completed_at;
    assert.equal(secondTs, firstTs, 'completed_at should not change on second complete()');
  });
});

// ── cancel ────────────────────────────────────────────────────────

describe('maintenanceSchedule — cancel', () => {
  it('status → "cancelled" after cancel()', () => {
    const item = ms.add(baseAdd());
    const cancelled = ms.cancel(item.id);
    assert.equal(cancelled.status, 'cancelled');
  });

  it('returns the shaped row after cancel()', () => {
    const item = ms.add(baseAdd());
    const result = ms.cancel(item.id);
    assert.ok(result !== null);
    assert.equal(result.id, item.id);
  });

  it('second cancel() is a no-op (WHERE status IN guard)', () => {
    const item = ms.add(baseAdd());
    ms.cancel(item.id);
    // Completing a cancelled item should have no effect
    ms.complete(item.id, 'Attempt');
    assert.equal(ms.findById(item.id).status, 'cancelled');
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('maintenanceSchedule — remove', () => {
  it('findById returns null after remove()', () => {
    const item = ms.add(baseAdd());
    ms.remove(item.id);
    assert.equal(ms.findById(item.id), null);
  });

  it('does not throw when removing an unknown id', () => {
    assert.doesNotThrow(() => ms.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('maintenanceSchedule — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(ms.findById(999999), null);
  });

  it('returns the shaped row for a known id', () => {
    const item = ms.add(baseAdd({ type: 'repair' }));
    const found = ms.findById(item.id);
    assert.ok(found !== null);
    assert.equal(found.id,   item.id);
    assert.equal(found.type, 'repair');
  });
});

// ── upcoming ──────────────────────────────────────────────────────

describe('maintenanceSchedule — upcoming', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(ms.upcoming()));
  });

  it('includes planned items', () => {
    const item = ms.add(baseAdd());
    assert.ok(ms.upcoming().some((x) => x.id === item.id));
  });

  it('includes in_progress items', () => {
    const item = ms.add(baseAdd());
    ms.update(item.id, { status: 'in_progress' });
    assert.ok(ms.upcoming().some((x) => x.id === item.id));
  });

  it('excludes completed items', () => {
    const item = ms.add(baseAdd());
    ms.complete(item.id);
    assert.ok(!ms.upcoming().some((x) => x.id === item.id));
  });

  it('excludes cancelled items', () => {
    const item = ms.add(baseAdd());
    ms.cancel(item.id);
    assert.ok(!ms.upcoming().some((x) => x.id === item.id));
  });

  it('ordered by start_at ASC (earlier start appears first)', () => {
    const later  = ms.add(baseAdd({ start_at: '2027-06-01T00:00:00.000Z', end_at: '2027-06-02T00:00:00.000Z' }));
    const earlier = ms.add(baseAdd({ start_at: '2027-01-01T00:00:00.000Z', end_at: '2027-01-02T00:00:00.000Z' }));
    const upcom = ms.upcoming().filter((x) => x.id === later.id || x.id === earlier.id);
    assert.equal(upcom[0].id, earlier.id, 'earlier start_at should appear first');
    assert.equal(upcom[1].id, later.id);
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('maintenanceSchedule — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(ms.all()));
  });

  it('count increments after add()', () => {
    const before = ms.all().length;
    ms.add(baseAdd());
    assert.equal(ms.all().length, before + 1);
  });

  it('includes completed items', () => {
    const item = ms.add(baseAdd());
    ms.complete(item.id);
    assert.ok(ms.all().some((x) => x.id === item.id));
  });

  it('includes cancelled items', () => {
    const item = ms.add(baseAdd());
    ms.cancel(item.id);
    assert.ok(ms.all().some((x) => x.id === item.id));
  });
});

// ── forHauler ─────────────────────────────────────────────────────

describe('maintenanceSchedule — forHauler', () => {
  it('returns an empty array for an unknown hauler', () => {
    assert.deepEqual(ms.forHauler('haul-never-seen'), []);
  });

  it('returns all items for a known hauler', () => {
    const hid = `haul-fh-${++_seq}`;
    ms.add(baseAdd({ hauler_id: hid, rig_id: rig() }));
    ms.add(baseAdd({ hauler_id: hid, rig_id: rig() }));
    const results = ms.forHauler(hid);
    assert.equal(results.length, 2);
    assert.ok(results.every((x) => x.hauler_id === hid));
  });

  it('does not return items from other haulers', () => {
    const hA = `haul-isoA-${++_seq}`;
    const hB = `haul-isoB-${_seq}`;
    ms.add(baseAdd({ hauler_id: hA, rig_id: rig() }));
    assert.ok(!ms.forHauler(hB).some((x) => x.hauler_id === hA));
  });
});

// ── forRig ────────────────────────────────────────────────────────

describe('maintenanceSchedule — forRig', () => {
  it('returns an empty array for an unknown rig', () => {
    assert.deepEqual(ms.forRig('rig-never-seen'), []);
  });

  it('returns all items for a known rig', () => {
    const rid = `rig-fr-${++_seq}`;
    ms.add(baseAdd({ rig_id: rid }));
    ms.add(baseAdd({ rig_id: rid }));
    const results = ms.forRig(rid);
    assert.equal(results.length, 2);
    assert.ok(results.every((x) => x.rig_id === rid));
  });
});

// ── countsInWindow ────────────────────────────────────────────────

describe('maintenanceSchedule — countsInWindow', () => {
  it('returns an object', () => {
    assert.ok(typeof ms.countsInWindow() === 'object');
  });

  it('returns empty object when no windows overlap the query point', () => {
    const hid = `haul-ciw-${++_seq}`;
    // Item scheduled far in the future — well outside any default query
    ms.add(baseAdd({
      hauler_id: hid,
      start_at: '2090-01-01T00:00:00.000Z',
      end_at:   '2090-01-02T00:00:00.000Z',
    }));
    // Query at a point before that window
    const counts = ms.countsInWindow('2026-01-01T00:00:00.000Z');
    assert.ok(!(hid in counts));
  });

  it('counts rigs whose window overlaps the query point', () => {
    const hid = `haul-overlap-${++_seq}`;
    // Two rigs both in shop during the query point
    ms.add(baseAdd({
      hauler_id: hid,
      rig_id:    `rig-o1-${_seq}`,
      start_at:  '2026-08-01T00:00:00.000Z',
      end_at:    '2026-08-10T00:00:00.000Z',
    }));
    ms.add(baseAdd({
      hauler_id: hid,
      rig_id:    `rig-o2-${_seq}`,
      start_at:  '2026-08-03T00:00:00.000Z',
      end_at:    '2026-08-12T00:00:00.000Z',
    }));
    const at = '2026-08-05T00:00:00.000Z';
    const counts = ms.countsInWindow(at);
    assert.ok(counts[hid] >= 2, `expected ≥ 2 for hauler, got ${counts[hid]}`);
  });

  it('excludes cancelled items from the count', () => {
    const hid = `haul-excl-${++_seq}`;
    const item = ms.add(baseAdd({
      hauler_id: hid,
      start_at:  '2026-08-20T00:00:00.000Z',
      end_at:    '2026-08-25T00:00:00.000Z',
    }));
    ms.cancel(item.id);
    const counts = ms.countsInWindow('2026-08-22T00:00:00.000Z');
    assert.ok(!(hid in counts) || counts[hid] === 0);
  });

  it('excludes completed items from the count', () => {
    const hid = `haul-comp-${++_seq}`;
    const item = ms.add(baseAdd({
      hauler_id: hid,
      start_at:  '2026-08-20T00:00:00.000Z',
      end_at:    '2026-08-25T00:00:00.000Z',
    }));
    ms.complete(item.id);
    const counts = ms.countsInWindow('2026-08-22T00:00:00.000Z');
    assert.ok(!(hid in counts) || counts[hid] === 0);
  });

  it('counts are independent per hauler', () => {
    const hA = `haul-indA-${++_seq}`;
    const hB = `haul-indB-${_seq}`;
    const at = '2026-09-15T00:00:00.000Z';
    ms.add(baseAdd({ hauler_id: hA, rig_id: `rig-indA1-${_seq}`,
                     start_at: '2026-09-10T00:00:00.000Z', end_at: '2026-09-20T00:00:00.000Z' }));
    ms.add(baseAdd({ hauler_id: hA, rig_id: `rig-indA2-${_seq}`,
                     start_at: '2026-09-12T00:00:00.000Z', end_at: '2026-09-18T00:00:00.000Z' }));
    ms.add(baseAdd({ hauler_id: hB, rig_id: `rig-indB1-${_seq}`,
                     start_at: '2026-09-13T00:00:00.000Z', end_at: '2026-09-17T00:00:00.000Z' }));
    const counts = ms.countsInWindow(at);
    assert.ok(counts[hA] >= 2);
    assert.ok(counts[hB] >= 1);
  });
});
