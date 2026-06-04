'use strict';

/*
 * Tests for state/alertState.js —
 *   getState, setState, addNote,
 *   resolve, snooze, reopen, assign, reset
 *
 * Uses an in-memory SQLite DB. The alert_state table is part of the base
 * schema in db/index.js — no stubs or migrations required.
 *
 * Covers:
 *   - getState: returns blank() for unknown alertId (all nulls, notes:[]);
 *     returns persisted state for known alertId
 *   - blank shape: all null scalar fields; notes is an empty array
 *   - setState: creates state when none exists; merges patch with previous
 *     state (COALESCE-style via ...spread); second call overwrites (upsert);
 *     returns the new state object
 *   - addNote: appends note to notes array; note has id/body/created_at_iso/
 *     by_user_id/by_display/by_role; returns the note (not the full state);
 *     multiple notes accumulate; other state fields unaffected
 *   - resolve: status_override → 'RESOLVED'; resolved_at_iso recent ISO;
 *     resolved_by_display and resolution_note stored; snooze_until_iso
 *     cleared to null
 *   - snooze: status_override → 'SNOOZED'; snooze_until_iso stored
 *   - reopen: status_override cleared; resolved_at_iso / resolved_by_display /
 *     resolution_note / snooze_until_iso all nulled
 *   - assign: assignee_user_id / assignee_display / assignee_role stored;
 *     other fields unaffected
 *   - reset: clears all rows; getState returns blank after reset
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/alertState')];
const as = require('../state/alertState');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;
function aid() { return `alert-as-${String(++_seq).padStart(4, '0')}`; }

// ── getState / blank shape ─────────────────────────────────────────

describe('alertState — getState (unknown)', () => {
  it('returns an object for an unknown alertId (no throw)', () => {
    assert.ok(typeof as.getState('alert-never-seen') === 'object');
  });

  it('status_override is null for unknown alertId', () => {
    assert.equal(as.getState(aid()).status_override, null);
  });

  it('all assignee fields are null for unknown alertId', () => {
    const s = as.getState(aid());
    assert.equal(s.assignee_user_id, null);
    assert.equal(s.assignee_display, null);
    assert.equal(s.assignee_role,    null);
  });

  it('snooze_until_iso is null for unknown alertId', () => {
    assert.equal(as.getState(aid()).snooze_until_iso, null);
  });

  it('resolved fields are null for unknown alertId', () => {
    const s = as.getState(aid());
    assert.equal(s.resolved_at_iso,     null);
    assert.equal(s.resolved_by_display, null);
    assert.equal(s.resolution_note,     null);
  });

  it('notes is an empty array for unknown alertId', () => {
    assert.deepEqual(as.getState(aid()).notes, []);
  });
});

// ── setState ──────────────────────────────────────────────────────

describe('alertState — setState', () => {
  it('creates state when none exists', () => {
    const id = aid();
    as.setState(id, { status_override: 'ACKNOWLEDGED' });
    assert.equal(as.getState(id).status_override, 'ACKNOWLEDGED');
  });

  it('returns the new state object', () => {
    const id = aid();
    const result = as.setState(id, { status_override: 'ACKNOWLEDGED' });
    assert.ok(typeof result === 'object');
    assert.equal(result.status_override, 'ACKNOWLEDGED');
  });

  it('second setState overwrites via upsert', () => {
    const id = aid();
    as.setState(id, { status_override: 'ACKNOWLEDGED' });
    as.setState(id, { status_override: 'RESOLVED' });
    assert.equal(as.getState(id).status_override, 'RESOLVED');
  });

  it('merges patch — unspecified fields from previous state are preserved', () => {
    const id = aid();
    as.setState(id, {
      status_override:  'ACKNOWLEDGED',
      assignee_user_id: 'u-assigned',
    });
    as.setState(id, { status_override: 'RESOLVED' });
    // assignee_user_id should survive the second patch
    assert.equal(as.getState(id).assignee_user_id, 'u-assigned');
  });

  it('can explicitly null out a field by patching it to null', () => {
    const id = aid();
    as.setState(id, { assignee_user_id: 'u-temp' });
    as.setState(id, { assignee_user_id: null });
    assert.equal(as.getState(id).assignee_user_id, null);
  });

  it('notes array survives a setState patch (JSON round-trip)', () => {
    const id = aid();
    as.addNote(id, { body: 'First note', by_user_id: 'u-01' });
    as.setState(id, { status_override: 'ACKNOWLEDGED' });
    assert.equal(as.getState(id).notes.length, 1);
    assert.equal(as.getState(id).notes[0].body, 'First note');
  });
});

// ── addNote ───────────────────────────────────────────────────────

describe('alertState — addNote', () => {
  it('returns the new note object (not the full state)', () => {
    const id = aid();
    const note = as.addNote(id, { body: 'Check engine' });
    assert.ok(typeof note === 'object');
    assert.equal(note.body, 'Check engine');
  });

  it('note has an id that starts with "note-"', () => {
    const note = as.addNote(aid(), { body: 'Hello' });
    assert.ok(typeof note.id === 'string');
    assert.ok(note.id.startsWith('note-'));
  });

  it('note has a recent created_at_iso', () => {
    const before = Date.now();
    const note = as.addNote(aid(), { body: 'Timestamp test' });
    const after = Date.now();
    const ts = new Date(note.created_at_iso).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('note stores by_user_id, by_display, by_role', () => {
    const note = as.addNote(aid(), {
      body:       'Author test',
      by_user_id: 'u-noter',
      by_display: 'Note Writer',
      by_role:    'axis_ops',
    });
    assert.equal(note.by_user_id, 'u-noter');
    assert.equal(note.by_display, 'Note Writer');
    assert.equal(note.by_role,    'axis_ops');
  });

  it('note appears in getState().notes after addNote', () => {
    const id = aid();
    const note = as.addNote(id, { body: 'Persisted note' });
    const notes = as.getState(id).notes;
    assert.ok(notes.some((n) => n.id === note.id));
  });

  it('multiple notes accumulate (append, not replace)', () => {
    const id = aid();
    as.addNote(id, { body: 'First' });
    as.addNote(id, { body: 'Second' });
    as.addNote(id, { body: 'Third' });
    assert.equal(as.getState(id).notes.length, 3);
  });

  it('other state fields are unaffected by addNote', () => {
    const id = aid();
    as.setState(id, { assignee_user_id: 'u-x', status_override: 'ACKNOWLEDGED' });
    as.addNote(id, { body: 'Note after assign' });
    const s = as.getState(id);
    assert.equal(s.assignee_user_id, 'u-x');
    assert.equal(s.status_override,  'ACKNOWLEDGED');
  });
});

// ── resolve ───────────────────────────────────────────────────────

describe('alertState — resolve', () => {
  it('status_override is "RESOLVED" after resolve()', () => {
    const id = aid();
    const result = as.resolve(id, { by_display: 'Resolver', note: 'All clear' });
    assert.equal(result.status_override, 'RESOLVED');
  });

  it('resolved_at_iso is a recent ISO string', () => {
    const id = aid();
    const before = Date.now();
    as.resolve(id, {});
    const after = Date.now();
    const ts = new Date(as.getState(id).resolved_at_iso).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('resolved_by_display is stored', () => {
    const id = aid();
    as.resolve(id, { by_display: 'Lead Op' });
    assert.equal(as.getState(id).resolved_by_display, 'Lead Op');
  });

  it('resolution_note is stored', () => {
    const id = aid();
    as.resolve(id, { note: 'Resolved after inspection' });
    assert.equal(as.getState(id).resolution_note, 'Resolved after inspection');
  });

  it('snooze_until_iso is cleared to null when resolved', () => {
    const id = aid();
    as.snooze(id, { until_iso: '2026-12-01T00:00:00.000Z' });
    as.resolve(id, {});
    assert.equal(as.getState(id).snooze_until_iso, null);
  });
});

// ── snooze ────────────────────────────────────────────────────────

describe('alertState — snooze', () => {
  it('status_override is "SNOOZED" after snooze()', () => {
    const id = aid();
    as.snooze(id, { until_iso: '2026-09-01T00:00:00.000Z' });
    assert.equal(as.getState(id).status_override, 'SNOOZED');
  });

  it('snooze_until_iso is stored', () => {
    const id = aid();
    as.snooze(id, { until_iso: '2026-09-01T00:00:00.000Z' });
    assert.equal(as.getState(id).snooze_until_iso, '2026-09-01T00:00:00.000Z');
  });

  it('snooze can be overwritten with a new until_iso', () => {
    const id = aid();
    as.snooze(id, { until_iso: '2026-09-01T00:00:00.000Z' });
    as.snooze(id, { until_iso: '2026-10-01T00:00:00.000Z' });
    assert.equal(as.getState(id).snooze_until_iso, '2026-10-01T00:00:00.000Z');
  });
});

// ── reopen ────────────────────────────────────────────────────────

describe('alertState — reopen', () => {
  it('status_override is null after reopen()', () => {
    const id = aid();
    as.resolve(id, { by_display: 'Someone' });
    as.reopen(id);
    assert.equal(as.getState(id).status_override, null);
  });

  it('resolved_at_iso is cleared after reopen()', () => {
    const id = aid();
    as.resolve(id, {});
    as.reopen(id);
    assert.equal(as.getState(id).resolved_at_iso, null);
  });

  it('resolved_by_display is cleared after reopen()', () => {
    const id = aid();
    as.resolve(id, { by_display: 'Closer' });
    as.reopen(id);
    assert.equal(as.getState(id).resolved_by_display, null);
  });

  it('resolution_note is cleared after reopen()', () => {
    const id = aid();
    as.resolve(id, { note: 'Done' });
    as.reopen(id);
    assert.equal(as.getState(id).resolution_note, null);
  });

  it('snooze_until_iso is cleared after reopen()', () => {
    const id = aid();
    as.snooze(id, { until_iso: '2026-11-01T00:00:00.000Z' });
    as.reopen(id);
    assert.equal(as.getState(id).snooze_until_iso, null);
  });

  it('notes are preserved through reopen()', () => {
    const id = aid();
    as.addNote(id, { body: 'Note before resolve' });
    as.resolve(id, {});
    as.reopen(id);
    assert.equal(as.getState(id).notes.length, 1);
  });
});

// ── assign ────────────────────────────────────────────────────────

describe('alertState — assign', () => {
  it('stores assignee_user_id, assignee_display, assignee_role', () => {
    const id = aid();
    as.assign(id, { user_id: 'u-asn', display_name: 'Assigned Op', role: 'axis_ops' });
    const s = as.getState(id);
    assert.equal(s.assignee_user_id, 'u-asn');
    assert.equal(s.assignee_display, 'Assigned Op');
    assert.equal(s.assignee_role,    'axis_ops');
  });

  it('other state fields are unaffected by assign()', () => {
    const id = aid();
    as.setState(id, { status_override: 'ACKNOWLEDGED' });
    as.assign(id, { user_id: 'u-asn2', display_name: 'Op 2', role: 'hauler_rep' });
    assert.equal(as.getState(id).status_override, 'ACKNOWLEDGED');
  });

  it('assignment can be overwritten', () => {
    const id = aid();
    as.assign(id, { user_id: 'u-first',  display_name: 'First',  role: 'axis_ops' });
    as.assign(id, { user_id: 'u-second', display_name: 'Second', role: 'lender' });
    const s = as.getState(id);
    assert.equal(s.assignee_user_id, 'u-second');
    assert.equal(s.assignee_role,    'lender');
  });
});

// ── reset ─────────────────────────────────────────────────────────

describe('alertState — reset', () => {
  it('getState returns blank for a previously set alertId after reset()', () => {
    const id = aid();
    as.setState(id, { status_override: 'RESOLVED', assignee_user_id: 'u-x' });
    as.reset();
    const s = as.getState(id);
    assert.equal(s.status_override,  null);
    assert.equal(s.assignee_user_id, null);
    assert.deepEqual(s.notes, []);
  });

  it('does not throw when resetting an already-empty table', () => {
    as.reset();
    assert.doesNotThrow(() => as.reset());
  });
});
