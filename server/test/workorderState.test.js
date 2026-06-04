'use strict';

/*
 * Tests for state/workorderState.js —
 *   STATUSES, open, progress, resolve,
 *   findById, forRig, openForRig, allOpen, all,
 *   rigsInRemediation
 *
 * Uses an in-memory SQLite DB. The workorders table is part of the base
 * schema in db/index.js — no migrations required.
 *
 * No shape() function in the module — all queries return raw DB rows.
 *
 * Covers:
 *   - STATUSES: array with OPEN / IN_PROGRESS / RESOLVED
 *   - open: id generated (starts with 'wo-'); status = 'OPEN';
 *     opened_at recent ISO; rig_id / title / hauler_id stored;
 *     hauler_id null when omitted; opened_by fields null when omitted
 *   - progress: status → 'IN_PROGRESS'; progress_note / progress_at /
 *     progress_by_display stored
 *   - resolve: status → 'RESOLVED'; resolution_note / resolved_at /
 *     resolved_by_display / cost_usd / hours stored
 *   - findById: null for unknown; row for known
 *   - forRig: empty for unknown; all workorders (including RESOLVED);
 *     ordered by opened_at DESC
 *   - openForRig: excludes RESOLVED; returns OPEN and IN_PROGRESS
 *   - allOpen: returns all non-RESOLVED across rigs; excludes RESOLVED
 *   - all: returns every workorder regardless of status
 *   - rigsInRemediation: returns a Set; contains rig with open workorder;
 *     excludes rig whose workorders are all RESOLVED
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/workorderState')];
const wo = require('../state/workorderState');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;
function rig()    { return `rig-wo-${String(++_seq).padStart(3, '0')}`; }
function hauler() { return `haul-wo-${_seq}`; }

function baseOpen(overrides = {}) {
  return {
    rig_id:             rig(),
    hauler_id:          hauler(),
    title:              'Replace brake pads',
    opened_by_user_id:  'u-wo-01',
    opened_by_display:  'Mechanic One',
    ...overrides,
  };
}

// ── STATUSES ──────────────────────────────────────────────────────

describe('workorderState — STATUSES', () => {
  it('exports STATUSES as an array', () => {
    assert.ok(Array.isArray(wo.STATUSES));
  });

  it('contains OPEN, IN_PROGRESS, RESOLVED', () => {
    assert.ok(wo.STATUSES.includes('OPEN'));
    assert.ok(wo.STATUSES.includes('IN_PROGRESS'));
    assert.ok(wo.STATUSES.includes('RESOLVED'));
  });
});

// ── open ──────────────────────────────────────────────────────────

describe('workorderState — open', () => {
  it('returns a row with a generated id starting with "wo-"', () => {
    const w = wo.open(baseOpen());
    assert.ok(typeof w.id === 'string');
    assert.ok(w.id.startsWith('wo-'), `expected id to start with "wo-", got: ${w.id}`);
  });

  it('status is "OPEN" on creation', () => {
    const w = wo.open(baseOpen());
    assert.equal(w.status, 'OPEN');
  });

  it('opened_at is a recent ISO string', () => {
    const before = Date.now();
    const w = wo.open(baseOpen());
    const after = Date.now();
    const ts = new Date(w.opened_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('stores rig_id', () => {
    const rigId = rig();
    const w = wo.open(baseOpen({ rig_id: rigId }));
    assert.equal(w.rig_id, rigId);
  });

  it('stores title', () => {
    const w = wo.open(baseOpen({ title: 'Tyre rotation' }));
    assert.equal(w.title, 'Tyre rotation');
  });

  it('stores hauler_id when provided', () => {
    const hid = hauler();
    const w = wo.open(baseOpen({ hauler_id: hid }));
    assert.equal(w.hauler_id, hid);
  });

  it('hauler_id is null when not provided', () => {
    const w = wo.open({ rig_id: rig(), title: 'No hauler' });
    assert.equal(w.hauler_id, null);
  });

  it('opened_by_user_id and opened_by_display are null when not provided', () => {
    const w = wo.open({ rig_id: rig(), title: 'Anonymous open' });
    assert.equal(w.opened_by_user_id, null);
    assert.equal(w.opened_by_display, null);
  });

  it('findById returns the workorder after open()', () => {
    const w = wo.open(baseOpen());
    const found = wo.findById(w.id);
    assert.ok(found !== null);
    assert.equal(found.id, w.id);
  });
});

// ── progress ──────────────────────────────────────────────────────

describe('workorderState — progress', () => {
  it('status changes to "IN_PROGRESS"', () => {
    const w = wo.open(baseOpen());
    const updated = wo.progress(w.id, { note: 'Started disassembly', by_display: 'Wrench Guy' });
    assert.equal(updated.status, 'IN_PROGRESS');
  });

  it('progress_note is stored', () => {
    const w = wo.open(baseOpen());
    const updated = wo.progress(w.id, { note: 'Awaiting parts' });
    assert.equal(updated.progress_note, 'Awaiting parts');
  });

  it('progress_at is a recent ISO string', () => {
    const w = wo.open(baseOpen());
    const before = Date.now();
    const updated = wo.progress(w.id, {});
    const after = Date.now();
    const ts = new Date(updated.progress_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('progress_by_display is stored', () => {
    const w = wo.open(baseOpen());
    const updated = wo.progress(w.id, { by_display: 'Senior Tech' });
    assert.equal(updated.progress_by_display, 'Senior Tech');
  });
});

// ── resolve ───────────────────────────────────────────────────────

describe('workorderState — resolve', () => {
  it('status changes to "RESOLVED"', () => {
    const w = wo.open(baseOpen());
    const resolved = wo.resolve(w.id, { note: 'Fixed', by_display: 'Closer' });
    assert.equal(resolved.status, 'RESOLVED');
  });

  it('resolution_note is stored', () => {
    const w = wo.open(baseOpen());
    const resolved = wo.resolve(w.id, { note: 'Brake pads replaced' });
    assert.equal(resolved.resolution_note, 'Brake pads replaced');
  });

  it('resolved_at is a recent ISO string', () => {
    const w = wo.open(baseOpen());
    const before = Date.now();
    const resolved = wo.resolve(w.id, {});
    const after = Date.now();
    const ts = new Date(resolved.resolved_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('resolved_by_display is stored', () => {
    const w = wo.open(baseOpen());
    const resolved = wo.resolve(w.id, { by_display: 'Lead Tech' });
    assert.equal(resolved.resolved_by_display, 'Lead Tech');
  });

  it('cost_usd is stored', () => {
    const w = wo.open(baseOpen());
    const resolved = wo.resolve(w.id, { cost_usd: 350.75 });
    assert.equal(resolved.cost_usd, 350.75);
  });

  it('hours is stored', () => {
    const w = wo.open(baseOpen());
    const resolved = wo.resolve(w.id, { hours: 4.5 });
    assert.equal(resolved.hours, 4.5);
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('workorderState — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(wo.findById('wo-does-not-exist'), null);
  });

  it('returns the row for a known id', () => {
    const w = wo.open(baseOpen());
    const found = wo.findById(w.id);
    assert.ok(found !== null);
    assert.equal(found.id, w.id);
  });
});

// ── forRig ────────────────────────────────────────────────────────

describe('workorderState — forRig', () => {
  it('returns an empty array for an unknown rig', () => {
    assert.deepEqual(wo.forRig('rig-never-seen'), []);
  });

  it('returns all workorders for a rig including RESOLVED', () => {
    const rigId = rig();
    const w1 = wo.open(baseOpen({ rig_id: rigId, title: 'First' }));
    const w2 = wo.open(baseOpen({ rig_id: rigId, title: 'Second' }));
    wo.resolve(w1.id, { note: 'done' });
    const results = wo.forRig(rigId);
    assert.equal(results.length, 2);
    assert.ok(results.some((r) => r.id === w1.id));
    assert.ok(results.some((r) => r.id === w2.id));
  });

  it('does not return workorders from other rigs', () => {
    const rigA = rig();
    const rigB = rig();
    wo.open(baseOpen({ rig_id: rigA }));
    const results = wo.forRig(rigB);
    assert.ok(!results.some((r) => r.rig_id === rigA));
  });
});

// ── openForRig ────────────────────────────────────────────────────

describe('workorderState — openForRig', () => {
  it('returns an empty array for an unknown rig', () => {
    assert.deepEqual(wo.openForRig('rig-never-seen'), []);
  });

  it('returns OPEN and IN_PROGRESS workorders for a rig', () => {
    const rigId = rig();
    const wOpen = wo.open(baseOpen({ rig_id: rigId, title: 'Open WO' }));
    const wProg = wo.open(baseOpen({ rig_id: rigId, title: 'Progress WO' }));
    wo.progress(wProg.id, {});
    const results = wo.openForRig(rigId);
    assert.ok(results.some((r) => r.id === wOpen.id), 'OPEN should be included');
    assert.ok(results.some((r) => r.id === wProg.id), 'IN_PROGRESS should be included');
  });

  it('excludes RESOLVED workorders', () => {
    const rigId = rig();
    const w = wo.open(baseOpen({ rig_id: rigId }));
    wo.resolve(w.id, {});
    const results = wo.openForRig(rigId);
    assert.ok(!results.some((r) => r.id === w.id), 'RESOLVED should be excluded');
  });
});

// ── allOpen ───────────────────────────────────────────────────────

describe('workorderState — allOpen', () => {
  it('includes OPEN workorders from any rig', () => {
    const w = wo.open(baseOpen());
    const results = wo.allOpen();
    assert.ok(results.some((r) => r.id === w.id));
  });

  it('excludes RESOLVED workorders', () => {
    const w = wo.open(baseOpen());
    wo.resolve(w.id, {});
    const results = wo.allOpen();
    assert.ok(!results.some((r) => r.id === w.id), 'RESOLVED should not appear in allOpen');
  });

  it('includes IN_PROGRESS workorders', () => {
    const w = wo.open(baseOpen());
    wo.progress(w.id, {});
    const results = wo.allOpen();
    assert.ok(results.some((r) => r.id === w.id), 'IN_PROGRESS should appear in allOpen');
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('workorderState — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(wo.all()));
  });

  it('includes RESOLVED workorders', () => {
    const w = wo.open(baseOpen());
    wo.resolve(w.id, {});
    const results = wo.all();
    assert.ok(results.some((r) => r.id === w.id), 'RESOLVED should appear in all()');
  });

  it('count increments with each open()', () => {
    const before = wo.all().length;
    wo.open(baseOpen());
    assert.equal(wo.all().length, before + 1);
  });
});

// ── rigsInRemediation ─────────────────────────────────────────────

describe('workorderState — rigsInRemediation', () => {
  it('returns a Set', () => {
    assert.ok(wo.rigsInRemediation() instanceof Set);
  });

  it('contains a rig_id that has an open workorder', () => {
    const rigId = rig();
    wo.open(baseOpen({ rig_id: rigId }));
    assert.ok(wo.rigsInRemediation().has(rigId),
      'rig with open workorder should be in remediation set');
  });

  it('does not contain a rig whose only workorder is RESOLVED', () => {
    const rigId = rig();
    const w = wo.open(baseOpen({ rig_id: rigId }));
    wo.resolve(w.id, {});
    assert.ok(!wo.rigsInRemediation().has(rigId),
      'rig with only RESOLVED workorders should not be in remediation set');
  });

  it('contains rig after progress() — IN_PROGRESS counts as open', () => {
    const rigId = rig();
    const w = wo.open(baseOpen({ rig_id: rigId }));
    wo.progress(w.id, {});
    assert.ok(wo.rigsInRemediation().has(rigId),
      'IN_PROGRESS workorder should keep rig in remediation');
  });
});
