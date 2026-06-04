'use strict';

/*
 * Tests for state/riskSteps.js —
 *   STATUSES, add, update, complete, reopen, remove,
 *   findById, forRisk, openWithDueDate, countsByRisk
 *
 * Uses an in-memory SQLite DB. riskRegister.js creates the risk_register
 * table (FK target); riskSteps.js creates risk_steps with a FK ON DELETE
 * CASCADE. foreign_keys = ON in db/index.js, so real risk rows are created
 * via rr.add() as fixtures.
 *
 * Covers:
 *   - STATUSES: exported array with expected values
 *   - add: empty/whitespace/missing title throws; title > 200 throws;
 *     invalid due_date throws; title trimmed; status defaults to 'open';
 *     created_at recent ISO; owner null when omitted / object when provided;
 *     created_by null when omitted / object when provided; due_date stored
 *     or null; full return shape
 *   - update: null for unknown id; invalid status throws; invalid due_date
 *     throws; patches individual fields; clear_due (due_date: null explicitly
 *     clears); unpatched fields preserved (COALESCE)
 *   - complete: status → 'done'; completed_at recent ISO; completed_by set;
 *     idempotent — second call WHERE status != 'done' is no-op
 *   - reopen: status → 'open'; completed_at / completed_by cleared
 *   - remove: findById null after; no-op on unknown id
 *   - findById: null for unknown; shaped row for known
 *   - forRisk: empty for unknown; all steps returned; isolation; ordering:
 *     open before done → due_date ASC (nulls last) → created_at ASC
 *   - openWithDueDate: only open steps with non-null due_date; done excluded;
 *     no-due-date excluded
 *   - countsByRisk: keyed by risk_id; done_count / total_count / open_count;
 *     independent per risk; changes reflect complete()
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

// riskRegister creates risk_register table (FK target)
delete require.cache[require.resolve('../state/riskRegister')];
const rr = require('../state/riskRegister');

// riskSteps creates risk_steps table (FK referencing risk_register)
delete require.cache[require.resolve('../state/riskSteps')];
const rs = require('../state/riskSteps');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

function makeRisk(overrides = {}) {
  const risk = rr.add({
    title:      `Risk ${++_seq}`,
    category:   'operational',
    severity:   'low',
    likelihood: 'unlikely',
    ...overrides,
  });
  return risk.id;
}

function baseStep(risk_id, overrides = {}) {
  return {
    risk_id,
    title:      'Verify supplier commitment',
    by_user_id: 'u-rs-01',
    by_display: 'Step Author',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── STATUSES ──────────────────────────────────────────────────────

describe('riskSteps — STATUSES', () => {
  it('exports STATUSES array', () => {
    assert.ok(Array.isArray(rs.STATUSES));
  });

  it('contains "open" and "done"', () => {
    assert.ok(rs.STATUSES.includes('open'));
    assert.ok(rs.STATUSES.includes('done'));
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('riskSteps — add', () => {
  it('throws when title is empty string', () => {
    const rid = makeRisk();
    assert.throws(
      () => rs.add({ risk_id: rid, title: '' }),
      /title required/i,
    );
  });

  it('throws when title is only whitespace', () => {
    const rid = makeRisk();
    assert.throws(
      () => rs.add({ risk_id: rid, title: '   ' }),
      /title required/i,
    );
  });

  it('throws when title is missing', () => {
    const rid = makeRisk();
    assert.throws(
      () => rs.add({ risk_id: rid }),
      /title required/i,
    );
  });

  it('throws when title exceeds 200 characters', () => {
    const rid = makeRisk();
    assert.throws(
      () => rs.add({ risk_id: rid, title: 'x'.repeat(201) }),
      /too long/i,
    );
  });

  it('accepts title of exactly 200 characters', () => {
    const rid = makeRisk();
    const step = rs.add({ risk_id: rid, title: 'a'.repeat(200) });
    assert.equal(step.title.length, 200);
  });

  it('throws when due_date is not a valid ISO date', () => {
    const rid = makeRisk();
    assert.throws(
      () => rs.add({ risk_id: rid, title: 'Step', due_date: 'not-a-date' }),
      /iso date/i,
    );
  });

  it('trims leading and trailing whitespace from title', () => {
    const rid = makeRisk();
    const step = rs.add({ risk_id: rid, title: '  trimmed title  ' });
    assert.equal(step.title, 'trimmed title');
  });

  it('status defaults to "open"', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    assert.equal(step.status, 'open');
  });

  it('created_at is a recent ISO string', () => {
    const rid = makeRisk();
    const before = Date.now();
    const step = rs.add(baseStep(rid));
    const after = Date.now();
    const ts = new Date(step.created_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('owner is null when owner_user_id is not provided', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    assert.equal(step.owner, null);
  });

  it('owner has user_id and display_name when provided', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, {
      owner_user_id: 'u-owner',
      owner_display: 'Step Owner',
    }));
    assert.deepEqual(step.owner, {
      user_id:      'u-owner',
      display_name: 'Step Owner',
    });
  });

  it('created_by is null when by fields are not provided', () => {
    const rid = makeRisk();
    const step = rs.add({ risk_id: rid, title: 'Anonymous step' });
    assert.equal(step.created_by, null);
  });

  it('created_by has user_id, display_name, role when provided', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, {
      by_user_id: 'u-creator',
      by_display: 'Creator Name',
      by_role:    'lender',
    }));
    assert.deepEqual(step.created_by, {
      user_id:      'u-creator',
      display_name: 'Creator Name',
      role:         'lender',
    });
  });

  it('stores due_date when provided', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, { due_date: '2026-09-30' }));
    assert.equal(step.due_date, '2026-09-30');
  });

  it('due_date is null when not provided', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    assert.equal(step.due_date, null);
  });

  it('completed_at and completed_by are null on a fresh step', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    assert.equal(step.completed_at, null);
    assert.equal(step.completed_by, null);
  });

  it('return shape has expected top-level fields', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    for (const f of ['id', 'risk_id', 'title', 'owner', 'due_date',
                     'status', 'completed_at', 'completed_by',
                     'created_at', 'created_by']) {
      assert.ok(f in step, `missing field: ${f}`);
    }
    assert.equal(step.risk_id, rid);
  });
});

// ── update ────────────────────────────────────────────────────────

describe('riskSteps — update', () => {
  it('returns null for an unknown id', () => {
    assert.equal(rs.update(999999, { title: 'New' }), null);
  });

  it('throws for an unknown status value', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    assert.throws(
      () => rs.update(step.id, { status: 'invalid' }),
      /unknown status/i,
    );
  });

  it('throws for an invalid due_date in patch', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    assert.throws(
      () => rs.update(step.id, { due_date: 'bad-date' }),
      /iso date/i,
    );
  });

  it('patches title', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const updated = rs.update(step.id, { title: 'Updated title' });
    assert.equal(updated.title, 'Updated title');
  });

  it('patches due_date', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const updated = rs.update(step.id, { due_date: '2026-12-31' });
    assert.equal(updated.due_date, '2026-12-31');
  });

  it('clears due_date when patch passes due_date: null', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, { due_date: '2026-09-01' }));
    const updated = rs.update(step.id, { due_date: null });
    assert.equal(updated.due_date, null);
  });

  it('patches owner_user_id and owner_display', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const updated = rs.update(step.id, {
      owner_user_id: 'u-new-owner',
      owner_display: 'New Owner',
    });
    assert.equal(updated.owner.user_id,      'u-new-owner');
    assert.equal(updated.owner.display_name, 'New Owner');
  });

  it('patches status to "done"', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const updated = rs.update(step.id, { status: 'done' });
    assert.equal(updated.status, 'done');
  });

  it('unpatched fields are preserved (COALESCE)', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, {
      title:    'Original title',
      due_date: '2026-10-01',
    }));
    const updated = rs.update(step.id, { status: 'done' });
    assert.equal(updated.title,    'Original title');
    assert.equal(updated.due_date, '2026-10-01');
  });
});

// ── complete ──────────────────────────────────────────────────────

describe('riskSteps — complete', () => {
  it('status changes to "done" after complete()', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const completed = rs.complete(step.id, 'Closer Name');
    assert.equal(completed.status, 'done');
  });

  it('completed_at is a recent ISO string', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const before = Date.now();
    const completed = rs.complete(step.id);
    const after = Date.now();
    const ts = new Date(completed.completed_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('completed_by is stored', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const completed = rs.complete(step.id, 'Verifier A');
    assert.equal(completed.completed_by, 'Verifier A');
  });

  it('completed_by is null when not provided', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const completed = rs.complete(step.id);
    assert.equal(completed.completed_by, null);
  });

  it('second complete() is a no-op (WHERE status != "done" guard)', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    rs.complete(step.id, 'First');
    const firstCompletedAt = rs.findById(step.id).completed_at;
    // Brief pause is impossible in sync code — the guard prevents re-write
    rs.complete(step.id, 'Second');
    const secondCompletedAt = rs.findById(step.id).completed_at;
    assert.equal(secondCompletedAt, firstCompletedAt,
      'completed_at should not change on second complete()');
  });
});

// ── reopen ────────────────────────────────────────────────────────

describe('riskSteps — reopen', () => {
  it('status returns to "open" after reopen()', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    rs.complete(step.id);
    const reopened = rs.reopen(step.id);
    assert.equal(reopened.status, 'open');
  });

  it('completed_at is null after reopen()', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    rs.complete(step.id, 'Someone');
    const reopened = rs.reopen(step.id);
    assert.equal(reopened.completed_at, null);
  });

  it('completed_by is null after reopen()', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    rs.complete(step.id, 'Someone');
    const reopened = rs.reopen(step.id);
    assert.equal(reopened.completed_by, null);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('riskSteps — remove', () => {
  it('findById returns null after remove()', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    rs.remove(step.id);
    assert.equal(rs.findById(step.id), null);
  });

  it('does not throw when removing an unknown id', () => {
    assert.doesNotThrow(() => rs.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('riskSteps — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(rs.findById(999999), null);
  });

  it('returns the shaped row for a known id', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid));
    const found = rs.findById(step.id);
    assert.ok(found !== null);
    assert.equal(found.id,      step.id);
    assert.equal(found.risk_id, rid);
    assert.equal(found.title,   step.title);
  });
});

// ── forRisk ───────────────────────────────────────────────────────

describe('riskSteps — forRisk', () => {
  it('returns an empty array for an unknown risk_id', () => {
    assert.deepEqual(rs.forRisk(999999), []);
  });

  it('returns all steps for a risk', () => {
    const rid = makeRisk();
    rs.add(baseStep(rid, { title: 'Step A' }));
    rs.add(baseStep(rid, { title: 'Step B' }));
    const steps = rs.forRisk(rid);
    assert.equal(steps.length, 2);
  });

  it('all returned steps belong to the requested risk_id', () => {
    const rid = makeRisk();
    rs.add(baseStep(rid));
    const steps = rs.forRisk(rid);
    assert.ok(steps.every((s) => s.risk_id === rid));
  });

  it('does not include steps from other risks', () => {
    const ridA = makeRisk();
    const ridB = makeRisk();
    rs.add(baseStep(ridA, { title: 'Only for A' }));
    const steps = rs.forRisk(ridB);
    assert.ok(!steps.some((s) => s.risk_id === ridA));
  });

  it('open steps sort before done steps', () => {
    const rid = makeRisk();
    const s1 = rs.add(baseStep(rid, { title: 'Open step' }));
    const s2 = rs.add(baseStep(rid, { title: 'Done step' }));
    rs.complete(s2.id);
    const steps = rs.forRisk(rid);
    const ourSteps = steps.filter((s) => s.id === s1.id || s.id === s2.id);
    assert.equal(ourSteps[0].id, s1.id, 'open step should come first');
    assert.equal(ourSteps[1].id, s2.id, 'done step should come second');
  });

  it('among open steps, earlier due_date sorts before later', () => {
    const rid = makeRisk();
    rs.add(baseStep(rid, { title: 'Later',  due_date: '2027-06-01' }));
    rs.add(baseStep(rid, { title: 'Earlier', due_date: '2027-01-01' }));
    const steps = rs.forRisk(rid);
    const ours = steps.filter((s) => s.due_date === '2027-01-01' || s.due_date === '2027-06-01');
    assert.equal(ours[0].due_date, '2027-01-01');
    assert.equal(ours[1].due_date, '2027-06-01');
  });
});

// ── openWithDueDate ───────────────────────────────────────────────

describe('riskSteps — openWithDueDate', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rs.openWithDueDate()));
  });

  it('includes open steps that have a due_date', () => {
    const rid = makeRisk();
    rs.add(baseStep(rid, { title: 'Has due', due_date: '2026-11-01' }));
    const results = rs.openWithDueDate();
    assert.ok(results.some((s) => s.due_date === '2026-11-01' && s.status === 'open'));
  });

  it('excludes done steps even when they have a due_date', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, { title: 'Done with due', due_date: '2026-10-15' }));
    rs.complete(step.id);
    const results = rs.openWithDueDate();
    assert.ok(!results.some((s) => s.id === step.id),
      'completed step should not appear in openWithDueDate');
  });

  it('excludes open steps that have no due_date', () => {
    const rid = makeRisk();
    const step = rs.add(baseStep(rid, { title: 'Open no due' })); // due_date omitted
    const results = rs.openWithDueDate();
    assert.ok(!results.some((s) => s.id === step.id),
      'open step without due_date should not appear in openWithDueDate');
  });
});

// ── countsByRisk ──────────────────────────────────────────────────

describe('riskSteps — countsByRisk', () => {
  it('returns an object', () => {
    assert.ok(typeof rs.countsByRisk() === 'object');
  });

  it('each entry has done_count, total_count, open_count', () => {
    const rid = makeRisk();
    rs.add(baseStep(rid));
    const counts = rs.countsByRisk();
    assert.ok(rid in counts, 'risk should appear in countsByRisk');
    const c = counts[rid];
    assert.ok('done_count'  in c);
    assert.ok('total_count' in c);
    assert.ok('open_count'  in c);
  });

  it('open_count = total_count when no steps are complete', () => {
    const rid = makeRisk();
    rs.add(baseStep(rid));
    rs.add(baseStep(rid));
    const c = rs.countsByRisk()[rid];
    assert.equal(c.done_count,  0);
    assert.equal(c.open_count,  c.total_count);
  });

  it('done_count increments after complete()', () => {
    const rid = makeRisk();
    const s1 = rs.add(baseStep(rid));
    rs.add(baseStep(rid));
    const before = rs.countsByRisk()[rid];
    rs.complete(s1.id);
    const after = rs.countsByRisk()[rid];
    assert.equal(after.done_count, before.done_count + 1);
    assert.equal(after.open_count, before.open_count - 1);
    assert.equal(after.total_count, before.total_count);
  });

  it('counts are independent per risk', () => {
    const ridA = makeRisk();
    const ridB = makeRisk();
    rs.add(baseStep(ridA));
    rs.add(baseStep(ridA));
    rs.add(baseStep(ridB));
    const counts = rs.countsByRisk();
    assert.ok(counts[ridA].total_count >= 2);
    assert.ok(counts[ridB].total_count >= 1);
  });
});
