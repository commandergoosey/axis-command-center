'use strict';

/*
 * Tests for state/receivableFollowups.js —
 *   BAND_IDS, OUTCOMES, add, remove, findById, all, forBand, countsByBand
 *
 * Uses in-memory SQLite. receivableFollowups.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - BAND_IDS: array with band_0_30/band_31_60/band_61_90/band_90p
 *   - OUTCOMES: array with committed/partial/no_response/disputed/collected
 *   - add: unknown band_id throws; unknown outcome throws; empty notes
 *     throws; notes > 1000 chars throws; stores band_id/notes/outcome;
 *     author shape; created_at recent ISO
 *   - remove: findById null after remove
 *   - findById: null for unknown; shaped row for known
 *   - all: returns array; includes all followups
 *   - forBand: empty for unknown band; returns rows for known band;
 *     does not include other bands
 *   - countsByBand: object keyed by band_id; count increments after add
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/receivableFollowups')];
const rf = require('../state/receivableFollowups');

function base(overrides = {}) {
  return {
    band_id:    'band_0_30',
    notes:      'Called AP manager — committed to pay by Friday',
    outcome:    'committed',
    by_user_id: 'u-rf-01',
    by_display: 'Finance Lead',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── BAND_IDS ──────────────────────────────────────────────────────

describe('receivableFollowups — BAND_IDS', () => {
  it('contains the four standard bands', () => {
    for (const b of ['band_0_30', 'band_31_60', 'band_61_90', 'band_90p']) {
      assert.ok(rf.BAND_IDS.includes(b), `missing: ${b}`);
    }
  });
});

// ── OUTCOMES ──────────────────────────────────────────────────────

describe('receivableFollowups — OUTCOMES', () => {
  it('contains expected outcomes', () => {
    for (const o of ['committed', 'partial', 'no_response', 'disputed', 'collected']) {
      assert.ok(rf.OUTCOMES.includes(o), `missing: ${o}`);
    }
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('receivableFollowups — add', () => {
  it('throws for unknown band_id', () => {
    assert.throws(() => rf.add(base({ band_id: 'band_999' })), /unknown band_id/i);
  });

  it('throws for unknown outcome', () => {
    assert.throws(() => rf.add(base({ outcome: 'maybe' })), /unknown outcome/i);
  });

  it('throws when notes is empty', () => {
    assert.throws(() => rf.add(base({ notes: '' })), /notes required/i);
  });

  it('throws when notes exceeds 1000 characters', () => {
    assert.throws(() => rf.add(base({ notes: 'x'.repeat(1001) })), /too long/i);
  });

  it('stores band_id, notes, outcome', () => {
    const row = rf.add(base({ band_id: 'band_61_90', notes: 'Dispute raised', outcome: 'disputed' }));
    assert.equal(row.band_id,  'band_61_90');
    assert.equal(row.notes,    'Dispute raised');
    assert.equal(row.outcome,  'disputed');
  });

  it('author has user_id, display_name, role when provided', () => {
    const row = rf.add(base({ by_user_id: 'u-x', by_display: 'X User', by_role: 'axis_admin' }));
    assert.deepEqual(row.author, { user_id: 'u-x', display_name: 'X User', role: 'axis_admin' });
  });

  it('author fields are null when not provided', () => {
    const row = rf.add({ band_id: 'band_0_30', notes: 'Anon note', outcome: 'no_response' });
    assert.equal(row.author.user_id, null);
  });

  it('created_at is a recent ISO string', () => {
    const before = Date.now();
    const row = rf.add(base());
    const after = Date.now();
    const ts = new Date(row.created_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('id is a positive integer', () => {
    const row = rf.add(base());
    assert.ok(Number.isInteger(row.id) && row.id > 0);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('receivableFollowups — remove', () => {
  it('findById returns null after remove', () => {
    const row = rf.add(base());
    rf.remove(row.id);
    assert.equal(rf.findById(row.id), null);
  });

  it('no-op on unknown id', () => {
    assert.doesNotThrow(() => rf.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('receivableFollowups — findById', () => {
  it('returns null for unknown id', () => {
    assert.equal(rf.findById(999999), null);
  });

  it('returns shaped row for known id', () => {
    const row = rf.add(base({ notes: 'Find me' }));
    const found = rf.findById(row.id);
    assert.ok(found !== null);
    assert.equal(found.notes, 'Find me');
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('receivableFollowups — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rf.all()));
  });

  it('includes all followups', () => {
    const r1 = rf.add(base({ notes: 'All test A' }));
    const r2 = rf.add(base({ notes: 'All test B' }));
    const all = rf.all();
    assert.ok(all.some((r) => r.id === r1.id));
    assert.ok(all.some((r) => r.id === r2.id));
  });
});

// ── forBand ───────────────────────────────────────────────────────

describe('receivableFollowups — forBand', () => {
  it('returns empty array for a band with no entries', () => {
    assert.deepEqual(rf.forBand('band_90p'), []);
  });

  it('returns rows for the specified band', () => {
    rf.add(base({ band_id: 'band_31_60', notes: 'Band 31-60 A' }));
    rf.add(base({ band_id: 'band_31_60', notes: 'Band 31-60 B' }));
    const rows = rf.forBand('band_31_60');
    assert.ok(rows.length >= 2);
  });

  it('does not include rows from other bands', () => {
    rf.add(base({ band_id: 'band_0_30', notes: 'Other band' }));
    const rows = rf.forBand('band_61_90');
    assert.ok(!rows.some((r) => r.notes === 'Other band'));
  });
});

// ── countsByBand ──────────────────────────────────────────────────

describe('receivableFollowups — countsByBand', () => {
  it('returns an object', () => {
    assert.ok(typeof rf.countsByBand() === 'object');
  });

  it('count for a band increments after add', () => {
    const before = rf.countsByBand()['band_0_30'] ?? 0;
    rf.add(base({ band_id: 'band_0_30', notes: 'Increment test' }));
    const after = rf.countsByBand()['band_0_30'] ?? 0;
    assert.equal(after, before + 1);
  });
});
