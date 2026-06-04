'use strict';

/*
 * Tests for state/actionAssignments.js —
 *   assign, unassign, snooze, unsnooze,
 *   markEscalated, acknowledgeEscalation,
 *   findById, all, map, forUser
 *   + deserialise shape
 *
 * Uses an in-memory SQLite DB. actionAssignments.js creates its own
 * table (action_item_assignments) via idempotent db.exec() at load,
 * then adds snooze + escalation columns via addColumnIfMissing().
 * No seed function — table starts empty.
 *
 * Covers:
 *   - assign: missing action_item_id / assignee_user_id throw;
 *     creates new row; upsert overwrites on same action_item_id;
 *     display_name defaults to assignee_user_id; role defaults to
 *     'axis_ops'; due_date / notes stored; returns deserialised shape
 *   - deserialise: assignee / assigned_by nested objects;
 *     snooze null when not snoozed; escalation null when not escalated
 *   - unassign: findById null after; no-op on unknown id
 *   - findById: null for unknown; row for known
 *   - all: returns array; count increments; includes all assignments
 *   - map: object keyed by action_item_id; value is the deserialised row
 *   - forUser: empty for unknown user; returns user's assignments;
 *     ordered by due_date ASC (nulls last per SQLite default)
 *   - snooze: throws when `until` absent; throws when item not found;
 *     snooze envelope present with until/reason/snoozed_at/snoozed_by;
 *     second snooze overwrites the first
 *   - unsnooze: snooze is null after unsnooze
 *   - markEscalated: returns true (first call); returns false (latch —
 *     second call, WHERE escalated_at IS NULL skips); escalation object
 *     present; escalated_at is a recent ISO string
 *   - acknowledgeEscalation: escalation.acknowledged_at set
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/actionAssignments')];
const aa = require('../state/actionAssignments');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;
function aid()  { return `act-${String(++_seq).padStart(4, '0')}`; }
function uid()  { return `u-aa-${_seq}`; }

function baseAssign(overrides = {}) {
  const id = aid();
  return {
    action_item_id:       id,
    assignee_user_id:     uid(),
    assignee_display_name: 'Test User',
    assignee_role:        'axis_ops',
    ...overrides,
  };
}

// ── assign ────────────────────────────────────────────────────────

describe('actionAssignments — assign', () => {
  it('throws when action_item_id is missing', () => {
    assert.throws(
      () => aa.assign({ assignee_user_id: 'u-01' }),
      /action_item_id required/i,
    );
  });

  it('throws when assignee_user_id is missing', () => {
    assert.throws(
      () => aa.assign({ action_item_id: aid() }),
      /assignee_user_id required/i,
    );
  });

  it('creates a new assignment row', () => {
    const a = aa.assign(baseAssign());
    assert.ok(a !== null);
    assert.ok(typeof a.action_item_id === 'string');
  });

  it('upsert: reassigning same ID updates the row without creating a duplicate', () => {
    const id = aid();
    aa.assign({ action_item_id: id, assignee_user_id: 'u-first',  assignee_display_name: 'First' });
    aa.assign({ action_item_id: id, assignee_user_id: 'u-second', assignee_display_name: 'Second' });
    const row = aa.findById(id);
    assert.equal(row.assignee.user_id,      'u-second');
    assert.equal(row.assignee.display_name, 'Second');
    // Only one row for this id
    assert.equal(aa.all().filter((x) => x.action_item_id === id).length, 1);
  });

  it('assignee_display_name defaults to assignee_user_id when not provided', () => {
    const id = aid();
    const userId = 'u-no-display';
    aa.assign({ action_item_id: id, assignee_user_id: userId });
    assert.equal(aa.findById(id).assignee.display_name, userId);
  });

  it('assignee_role defaults to "axis_ops" when not provided', () => {
    const a = aa.assign({ action_item_id: aid(), assignee_user_id: 'u-default-role' });
    assert.equal(a.assignee.role, 'axis_ops');
  });

  it('stores due_date when provided', () => {
    const a = aa.assign(baseAssign({ due_date: '2026-06-30' }));
    assert.equal(a.due_date, '2026-06-30');
  });

  it('stores notes when provided', () => {
    const a = aa.assign(baseAssign({ notes: 'Please resolve by EOD' }));
    assert.equal(a.notes, 'Please resolve by EOD');
  });

  it('due_date is null when not provided', () => {
    const a = aa.assign(baseAssign());
    assert.equal(a.due_date, null);
  });
});

// ── deserialise shape ─────────────────────────────────────────────

describe('actionAssignments — deserialise shape', () => {
  it('assignee has user_id, display_name, role', () => {
    const a = aa.assign(baseAssign({
      assignee_user_id:     'u-shape',
      assignee_display_name:'Shape User',
      assignee_role:        'lender',
    }));
    assert.deepEqual(a.assignee, {
      user_id:      'u-shape',
      display_name: 'Shape User',
      role:         'lender',
    });
  });

  it('assigned_by has user_id and display_name', () => {
    const a = aa.assign(baseAssign({
      assigned_by_user_id: 'u-by',
      assigned_by_display: 'Assigner',
    }));
    assert.equal(a.assigned_by.user_id,      'u-by');
    assert.equal(a.assigned_by.display_name, 'Assigner');
  });

  it('snooze is null on a fresh assignment', () => {
    const a = aa.assign(baseAssign());
    assert.equal(a.snooze, null);
  });

  it('escalation is null on a fresh assignment', () => {
    const a = aa.assign(baseAssign());
    assert.equal(a.escalation, null);
  });
});

// ── unassign ──────────────────────────────────────────────────────

describe('actionAssignments — unassign', () => {
  it('findById returns null after unassign', () => {
    const a = aa.assign(baseAssign());
    aa.unassign(a.action_item_id);
    assert.equal(aa.findById(a.action_item_id), null);
  });

  it('unassigning an unknown id does not throw', () => {
    assert.doesNotThrow(() => aa.unassign('act-does-not-exist'));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('actionAssignments — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(aa.findById('act-unknown'), null);
  });

  it('returns the deserialised row for a known id', () => {
    const a = aa.assign(baseAssign());
    const found = aa.findById(a.action_item_id);
    assert.ok(found !== null);
    assert.equal(found.action_item_id, a.action_item_id);
  });
});

// ── all / map ─────────────────────────────────────────────────────

describe('actionAssignments — all / map', () => {
  it('all() returns an array', () => {
    assert.ok(Array.isArray(aa.all()));
  });

  it('all() length increments after assign', () => {
    const before = aa.all().length;
    aa.assign(baseAssign());
    assert.equal(aa.all().length, before + 1);
  });

  it('map() returns an object keyed by action_item_id', () => {
    const a = aa.assign(baseAssign());
    const m = aa.map();
    assert.ok(a.action_item_id in m, 'map should contain the assigned item id');
    assert.equal(m[a.action_item_id].action_item_id, a.action_item_id);
  });

  it('map() values are deserialised rows (have assignee object)', () => {
    const a = aa.assign(baseAssign());
    const m = aa.map();
    assert.ok(typeof m[a.action_item_id].assignee === 'object');
  });
});

// ── forUser ───────────────────────────────────────────────────────

describe('actionAssignments — forUser', () => {
  it('returns an empty array for an unknown user', () => {
    assert.deepEqual(aa.forUser('u-nobody'), []);
  });

  it('returns assignments for a specific user', () => {
    const userId = `u-fu-${++_seq}`;
    aa.assign(baseAssign({ assignee_user_id: userId }));
    aa.assign(baseAssign({ assignee_user_id: userId }));
    const result = aa.forUser(userId);
    assert.equal(result.length, 2);
    assert.ok(result.every((x) => x.assignee.user_id === userId));
  });

  it('earlier due_date sorts before later due_date', () => {
    const userId = `u-order-${++_seq}`;
    aa.assign(baseAssign({ assignee_user_id: userId, due_date: '2026-08-01' }));
    aa.assign(baseAssign({ assignee_user_id: userId, due_date: '2026-07-01' }));
    const result = aa.forUser(userId);
    assert.equal(result[0].due_date, '2026-07-01',
      'earlier due_date should appear first');
    assert.equal(result[1].due_date, '2026-08-01');
  });
});

// ── snooze ────────────────────────────────────────────────────────

describe('actionAssignments — snooze', () => {
  it('throws when `until` is not provided', () => {
    const a = aa.assign(baseAssign());
    assert.throws(
      () => aa.snooze({ action_item_id: a.action_item_id }),
      /until.*required/i,
    );
  });

  it('throws when the item is not assigned', () => {
    assert.throws(
      () => aa.snooze({ action_item_id: 'act-not-assigned', until: '2026-07-01' }),
      /unassigned/i,
    );
  });

  it('snooze envelope is present after snooze()', () => {
    const a = aa.assign(baseAssign());
    const snoozed = aa.snooze({ action_item_id: a.action_item_id, until: '2026-09-01' });
    assert.ok(snoozed.snooze !== null, 'snooze should be non-null');
    assert.equal(snoozed.snooze.until, '2026-09-01');
  });

  it('snooze.reason is stored', () => {
    const a = aa.assign(baseAssign());
    const snoozed = aa.snooze({
      action_item_id: a.action_item_id,
      until:  '2026-09-15',
      reason: 'Waiting for quarterly review',
    });
    assert.equal(snoozed.snooze.reason, 'Waiting for quarterly review');
  });

  it('snooze.snoozed_by contains by_user_id and by_display', () => {
    const a = aa.assign(baseAssign());
    const snoozed = aa.snooze({
      action_item_id: a.action_item_id,
      until:      '2026-10-01',
      by_user_id: 'u-snoozer',
      by_display: 'The Snoozer',
    });
    assert.equal(snoozed.snooze.snoozed_by.user_id,      'u-snoozer');
    assert.equal(snoozed.snooze.snoozed_by.display_name, 'The Snoozer');
  });

  it('second snooze() overwrites the first', () => {
    const a  = aa.assign(baseAssign());
    aa.snooze({ action_item_id: a.action_item_id, until: '2026-09-01', reason: 'First' });
    aa.snooze({ action_item_id: a.action_item_id, until: '2026-10-01', reason: 'Second' });
    const row = aa.findById(a.action_item_id);
    assert.equal(row.snooze.until,  '2026-10-01');
    assert.equal(row.snooze.reason, 'Second');
  });
});

// ── unsnooze ──────────────────────────────────────────────────────

describe('actionAssignments — unsnooze', () => {
  it('snooze is null after unsnooze()', () => {
    const a = aa.assign(baseAssign());
    aa.snooze({ action_item_id: a.action_item_id, until: '2026-12-01' });
    const unsnoozed = aa.unsnooze(a.action_item_id);
    assert.equal(unsnoozed.snooze, null);
  });
});

// ── markEscalated ─────────────────────────────────────────────────

describe('actionAssignments — markEscalated', () => {
  it('returns true on first call (escalated_at was NULL)', () => {
    const a = aa.assign(baseAssign());
    assert.equal(aa.markEscalated(a.action_item_id), true);
  });

  it('returns false on second call (latch — WHERE escalated_at IS NULL)', () => {
    const a = aa.assign(baseAssign());
    aa.markEscalated(a.action_item_id);
    assert.equal(aa.markEscalated(a.action_item_id), false,
      'markEscalated should be a one-shot latch');
  });

  it('escalation object is present after markEscalated', () => {
    const a = aa.assign(baseAssign());
    aa.markEscalated(a.action_item_id);
    const row = aa.findById(a.action_item_id);
    assert.ok(row.escalation !== null, 'escalation should be non-null');
    assert.ok(row.escalation.escalated_at !== null,
      'escalated_at should be set');
  });

  it('escalated_at is a recent ISO string', () => {
    const a      = aa.assign(baseAssign());
    const before = Date.now();
    aa.markEscalated(a.action_item_id);
    const after  = Date.now();
    const ts = new Date(aa.findById(a.action_item_id).escalation.escalated_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});

// ── acknowledgeEscalation ─────────────────────────────────────────

describe('actionAssignments — acknowledgeEscalation', () => {
  it('sets escalation.acknowledged_at', () => {
    const a = aa.assign(baseAssign());
    aa.markEscalated(a.action_item_id);
    aa.acknowledgeEscalation(a.action_item_id);
    const row = aa.findById(a.action_item_id);
    assert.ok(row.escalation.acknowledged_at !== null,
      'acknowledged_at should be set after acknowledgeEscalation');
  });

  it('acknowledged_at is a recent ISO string', () => {
    const a      = aa.assign(baseAssign());
    aa.markEscalated(a.action_item_id);
    const before = Date.now();
    aa.acknowledgeEscalation(a.action_item_id);
    const after  = Date.now();
    const ts = new Date(aa.findById(a.action_item_id).escalation.acknowledged_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});
