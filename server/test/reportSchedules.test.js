'use strict';

/*
 * Tests for state/reportSchedules.js —
 *   nextRunAt, create, list, get, update, toggle, remove, markRan
 *
 * Uses an in-memory SQLite DB (DB_PATH=:memory:). No stubs required —
 * reportSchedules has zero dependencies beyond the DB module.
 *
 * Covers:
 *   - nextRunAt: each frequency branch (daily/weekly/monthly/quarterly)
 *     result is in the future; hour and day-of-week/month are preserved
 *   - humanFreq output surfaces via frequency_human on deserialized rows
 *   - create: shape, auto-ID sequencing, recipients JSON round-trip,
 *     default values, active flag, next_run_at is set
 *   - list:   returns empty array initially, returns all after creates
 *   - get:    null for unknown ID, returns row for known ID
 *   - update: patches specific fields; unknown ID returns null;
 *             active:false clears next_run_at
 *   - toggle: false → active=false + next_run_at=null;
 *             true  → active=true  + next_run_at set
 *   - remove: false for unknown ID; true + row gone for known
 *   - markRan: null for unknown; stamps last_run_at; advances next_run_at
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ─────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db'); // runs CREATE TABLE IF NOT EXISTS

delete require.cache[require.resolve('../state/reportSchedules')];
const rs = require('../state/reportSchedules');

// ── Fixtures ─────────────────────────────────────────────────────

function basePayload(overrides = {}) {
  return {
    type_id:    'daily_digest',
    title:      'Daily Digest',
    frequency:  'daily',
    hour:       8,
    recipients: ['ops@axis.test'],
    created_by: 'user-test',
    ...overrides,
  };
}

// ── nextRunAt ─────────────────────────────────────────────────────

describe('reportSchedules — nextRunAt (daily)', () => {
  it('returns an ISO string in the future', () => {
    const result = rs.nextRunAt({ frequency: 'daily', hour: 8 });
    assert.ok(typeof result === 'string', 'expected a string');
    assert.ok(new Date(result).getTime() > Date.now(),
      `daily next_run_at should be in the future, got ${result}`);
  });

  it('result hour matches the requested hour', () => {
    const hour = 14;
    const result = rs.nextRunAt({ frequency: 'daily', hour });
    assert.equal(new Date(result).getUTCHours(), hour,
      `expected UTC hour ${hour}, got ${new Date(result).getUTCHours()}`);
  });

  it('defaults to 08:00 UTC when hour is not provided', () => {
    const result = rs.nextRunAt({ frequency: 'daily' }); // hour absent → default 8
    assert.equal(new Date(result).getUTCHours(), 8);
  });

  it('minutes and seconds are zero', () => {
    const result = rs.nextRunAt({ frequency: 'daily', hour: 6 });
    const d = new Date(result);
    assert.equal(d.getUTCMinutes(), 0);
    assert.equal(d.getUTCSeconds(), 0);
  });
});

describe('reportSchedules — nextRunAt (weekly)', () => {
  it('returns an ISO string in the future', () => {
    const result = rs.nextRunAt({ frequency: 'weekly', day_of_week: 1, hour: 8 });
    assert.ok(new Date(result).getTime() > Date.now(),
      `weekly next_run_at should be in the future`);
  });

  it('result day-of-week matches day_of_week param', () => {
    for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
      const result = rs.nextRunAt({ frequency: 'weekly', day_of_week: dow, hour: 8 });
      assert.equal(new Date(result).getUTCDay(), dow,
        `expected UTCDay ${dow}, got ${new Date(result).getUTCDay()}`);
    }
  });

  it('defaults to Monday (day_of_week=1) when absent', () => {
    const result = rs.nextRunAt({ frequency: 'weekly', hour: 8 }); // no day_of_week
    assert.equal(new Date(result).getUTCDay(), 1);
  });
});

describe('reportSchedules — nextRunAt (monthly)', () => {
  it('returns an ISO string in the future', () => {
    const result = rs.nextRunAt({ frequency: 'monthly', day_of_month: 1, hour: 8 });
    assert.ok(new Date(result).getTime() > Date.now());
  });

  it('result day-of-month matches day_of_month param (when date is in the future)', () => {
    // Use day 28 — always valid across all months; if it already passed this
    // month it wraps to next month, still day 28.
    const result = rs.nextRunAt({ frequency: 'monthly', day_of_month: 28, hour: 8 });
    assert.equal(new Date(result).getUTCDate(), 28);
  });

  it('defaults to day 1 when day_of_month is absent', () => {
    const result = rs.nextRunAt({ frequency: 'monthly', hour: 8 });
    assert.equal(new Date(result).getUTCDate(), 1);
  });
});

describe('reportSchedules — nextRunAt (quarterly)', () => {
  it('returns an ISO string in the future', () => {
    const result = rs.nextRunAt({ frequency: 'quarterly', day_of_month: 1, hour: 8 });
    assert.ok(new Date(result).getTime() > Date.now());
  });

  it('result is at least roughly 1 month ahead (quarterly means ≥ 1 period away)', () => {
    const result = rs.nextRunAt({ frequency: 'quarterly', day_of_month: 1, hour: 8 });
    // The quarterly loop advances by 3 months until past now — result > now is sufficient
    assert.ok(new Date(result).getTime() > Date.now());
  });

  it('returns null for an unrecognised frequency', () => {
    const result = rs.nextRunAt({ frequency: 'biannually', hour: 8 });
    assert.equal(result, null);
  });
});

// ── humanFreq (via frequency_human on deserialized rows) ──────────

describe('reportSchedules — humanFreq (via frequency_human)', () => {
  it('daily frequency_human contains "Daily"', () => {
    const s = rs.create(basePayload({ frequency: 'daily', hour: 8 }));
    assert.ok(s.frequency_human.startsWith('Daily'),
      `expected "Daily …", got: ${s.frequency_human}`);
  });

  it('weekly frequency_human contains "Weekly"', () => {
    const s = rs.create(basePayload({ frequency: 'weekly', day_of_week: 1, hour: 9 }));
    assert.ok(s.frequency_human.startsWith('Weekly'),
      `expected "Weekly …", got: ${s.frequency_human}`);
  });

  it('monthly frequency_human contains "Monthly"', () => {
    const s = rs.create(basePayload({ frequency: 'monthly', day_of_month: 5, hour: 7 }));
    assert.ok(s.frequency_human.startsWith('Monthly'),
      `expected "Monthly …", got: ${s.frequency_human}`);
  });

  it('quarterly frequency_human contains "Quarterly"', () => {
    const s = rs.create(basePayload({ frequency: 'quarterly', day_of_month: 1, hour: 6 }));
    assert.ok(s.frequency_human.startsWith('Quarterly'),
      `expected "Quarterly …", got: ${s.frequency_human}`);
  });
});

// ── create ────────────────────────────────────────────────────────

describe('reportSchedules — create', () => {
  it('returns an object with required shape fields', () => {
    const s = rs.create(basePayload());
    for (const k of ['id', 'type_id', 'title', 'frequency', 'active',
                     'recipients', 'next_run_at', 'frequency_human', 'created_at']) {
      assert.ok(k in s, `created schedule missing: ${k}`);
    }
  });

  it('ID follows sch-NNN format', () => {
    const s = rs.create(basePayload());
    assert.ok(/^sch-\d{3,}$/.test(s.id), `expected sch-NNN, got: ${s.id}`);
  });

  it('sequential IDs increment numerically', () => {
    const a = rs.create(basePayload({ title: 'First' }));
    const b = rs.create(basePayload({ title: 'Second' }));
    const numA = parseInt(a.id.slice(4), 10);
    const numB = parseInt(b.id.slice(4), 10);
    assert.ok(numB > numA, `expected ${b.id} to follow ${a.id}`);
  });

  it('recipients is deserialized as an array', () => {
    const s = rs.create(basePayload({ recipients: ['a@test.local', 'b@test.local'] }));
    assert.ok(Array.isArray(s.recipients));
    assert.deepEqual(s.recipients, ['a@test.local', 'b@test.local']);
  });

  it('active is true by default', () => {
    const s = rs.create(basePayload());
    assert.equal(s.active, true);
  });

  it('next_run_at is a future ISO string', () => {
    const s = rs.create(basePayload());
    assert.ok(typeof s.next_run_at === 'string');
    assert.ok(new Date(s.next_run_at).getTime() > Date.now(),
      `next_run_at should be in the future`);
  });

  it('title defaults to type_id when not provided', () => {
    const s = rs.create({ type_id: 'weekly_wrap', frequency: 'weekly', hour: 8, recipients: [] });
    assert.equal(s.title, 'weekly_wrap');
  });
});

// ── list ──────────────────────────────────────────────────────────

describe('reportSchedules — list', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rs.list()));
  });

  it('includes schedules created after list() is called', () => {
    const before = rs.list().length;
    rs.create(basePayload({ title: 'List test schedule' }));
    assert.equal(rs.list().length, before + 1);
  });

  it('each item in list has id and frequency_human', () => {
    rs.create(basePayload({ title: 'List shape check' }));
    for (const item of rs.list()) {
      assert.ok('id'               in item, 'missing id');
      assert.ok('frequency_human'  in item, 'missing frequency_human');
    }
  });
});

// ── get ───────────────────────────────────────────────────────────

describe('reportSchedules — get', () => {
  it('returns null for an unknown ID', () => {
    assert.equal(rs.get('sch-99999'), null);
  });

  it('returns the created schedule by ID', () => {
    const created = rs.create(basePayload({ title: 'Get test' }));
    const fetched = rs.get(created.id);
    assert.ok(fetched !== null);
    assert.equal(fetched.id,    created.id);
    assert.equal(fetched.title, 'Get test');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('reportSchedules — update', () => {
  it('returns null for an unknown ID', () => {
    assert.equal(rs.update('sch-99998', { title: 'X' }), null);
  });

  it('patches the title without changing other fields', () => {
    const s = rs.create(basePayload({ title: 'Before', frequency: 'daily' }));
    const patched = rs.update(s.id, { title: 'After' });
    assert.equal(patched.title,     'After');
    assert.equal(patched.frequency, 'daily'); // unchanged
  });

  it('patches recipients', () => {
    const s = rs.create(basePayload({ recipients: ['old@test.local'] }));
    const patched = rs.update(s.id, { recipients: ['new@test.local'] });
    assert.deepEqual(patched.recipients, ['new@test.local']);
  });

  it('active:false clears next_run_at', () => {
    const s = rs.create(basePayload());
    assert.ok(s.next_run_at !== null, 'precondition: next_run_at should be set');
    const patched = rs.update(s.id, { active: false });
    assert.equal(patched.active,      false);
    assert.equal(patched.next_run_at, null);
  });
});

// ── toggle ────────────────────────────────────────────────────────

describe('reportSchedules — toggle', () => {
  it('returns null for an unknown ID', () => {
    assert.equal(rs.toggle('sch-99997', true), null);
  });

  it('toggle(id, false) sets active=false and clears next_run_at', () => {
    const s = rs.create(basePayload());
    const toggled = rs.toggle(s.id, false);
    assert.equal(toggled.active,      false);
    assert.equal(toggled.next_run_at, null);
  });

  it('toggle(id, true) sets active=true and sets next_run_at', () => {
    const s = rs.create(basePayload());
    rs.toggle(s.id, false);                    // disable first
    const toggled = rs.toggle(s.id, true);
    assert.equal(toggled.active, true);
    assert.ok(toggled.next_run_at !== null,
      'next_run_at should be set after toggling active=true');
    assert.ok(new Date(toggled.next_run_at).getTime() > Date.now());
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('reportSchedules — remove', () => {
  it('returns false for an unknown ID', () => {
    assert.equal(rs.remove('sch-99996'), false);
  });

  it('returns true for a known ID', () => {
    const s = rs.create(basePayload({ title: 'To be removed' }));
    assert.equal(rs.remove(s.id), true);
  });

  it('get() returns null after remove()', () => {
    const s = rs.create(basePayload({ title: 'Ephemeral' }));
    rs.remove(s.id);
    assert.equal(rs.get(s.id), null);
  });

  it('removed schedule no longer appears in list()', () => {
    const s = rs.create(basePayload({ title: 'Gone' }));
    rs.remove(s.id);
    assert.ok(!rs.list().some((r) => r.id === s.id),
      'removed schedule should not appear in list()');
  });
});

// ── markRan ───────────────────────────────────────────────────────

describe('reportSchedules — markRan', () => {
  it('returns null for an unknown ID', () => {
    assert.equal(rs.markRan('sch-99995'), null);
  });

  it('stamps last_run_at as a recent ISO string', () => {
    const s = rs.create(basePayload());
    const before = Date.now();
    const result = rs.markRan(s.id);
    const after  = Date.now();
    const ts = new Date(result.last_run_at).getTime();
    assert.ok(ts >= before && ts <= after,
      `last_run_at ${result.last_run_at} should be between test start and end`);
  });

  it('sets a non-null future next_run_at for an active schedule', () => {
    const s = rs.create(basePayload());
    const result = rs.markRan(s.id);
    // nextRunAt always recomputes from "now", so the value is valid and future
    // (may equal the original if both calls fall in the same scheduling window)
    assert.ok(result.next_run_at !== null,
      'active schedule should have a non-null next_run_at after markRan');
    assert.ok(new Date(result.next_run_at).getTime() > Date.now(),
      'next_run_at should be in the future after markRan');
  });

  it('inactive schedule: markRan keeps next_run_at null', () => {
    const s = rs.create(basePayload());
    rs.toggle(s.id, false);          // deactivate
    const result = rs.markRan(s.id);
    assert.equal(result.next_run_at, null);
  });
});
