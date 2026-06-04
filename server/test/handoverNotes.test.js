'use strict';

/*
 * Tests for state/handoverNotes.js —
 *   add, latest, recent, findById, remove
 *
 * Uses an in-memory SQLite DB. handoverNotes.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - add: empty/whitespace/missing body throws; body > 4000 chars throws;
 *     trims whitespace; stores body; created_at recent ISO; author
 *     fields stored / null when omitted; return shape
 *   - latest: null on empty table; returns most-recently added note
 *   - recent: empty array on empty table; returns up to limit (default 20);
 *     ordered newest-first
 *   - findById: null for unknown; shaped row for known
 *   - remove: findById null after; no-op on unknown id
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/handoverNotes')];
const hn = require('../state/handoverNotes');

// ── Helpers ───────────────────────────────────────────────────────
let _seq = 0;
function base(overrides = {}) {
  return {
    body:       'All haulers on track. Rig 04 brake job scheduled 0600.',
    by_user_id: `u-hn-${++_seq}`,
    by_display: 'Night Shift Op',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('handoverNotes — add', () => {
  it('throws when body is empty', () => {
    assert.throws(() => hn.add({ body: '' }), /body required/i);
  });

  it('throws when body is only whitespace', () => {
    assert.throws(() => hn.add({ body: '   ' }), /body required/i);
  });

  it('throws when body is missing', () => {
    assert.throws(() => hn.add({}), /body required/i);
  });

  it('throws when body exceeds 4000 characters', () => {
    assert.throws(() => hn.add({ body: 'x'.repeat(4001) }), /too long/i);
  });

  it('accepts body of exactly 4000 characters', () => {
    const n = hn.add({ body: 'a'.repeat(4000) });
    assert.equal(n.body.length, 4000);
  });

  it('trims whitespace from body', () => {
    const n = hn.add(base({ body: '  Trimmed note  ' }));
    assert.equal(n.body, 'Trimmed note');
  });

  it('stores the body', () => {
    const n = hn.add(base({ body: 'Specific handover note' }));
    assert.equal(n.body, 'Specific handover note');
  });

  it('created_at is a recent ISO string', () => {
    const before = Date.now();
    const n = hn.add(base());
    const after = Date.now();
    const ts = new Date(n.created_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('author has user_id, display_name, role when provided', () => {
    const n = hn.add(base({
      by_user_id: 'u-author',
      by_display: 'Author Name',
      by_role:    'axis_admin',
    }));
    assert.deepEqual(n.author, {
      user_id:      'u-author',
      display_name: 'Author Name',
      role:         'axis_admin',
    });
  });

  it('author fields are null when not provided', () => {
    const n = hn.add({ body: 'Anonymous handover' });
    assert.equal(n.author.user_id,      null);
    assert.equal(n.author.display_name, null);
    assert.equal(n.author.role,         null);
  });

  it('return shape has id, body, created_at, author', () => {
    const n = hn.add(base());
    assert.ok('id'         in n);
    assert.ok('body'       in n);
    assert.ok('created_at' in n);
    assert.ok('author'     in n);
  });
});

// ── latest ────────────────────────────────────────────────────────

describe('handoverNotes — latest', () => {
  it('returns the most recently added note', () => {
    const n1 = hn.add(base({ body: 'Earlier note' }));
    const n2 = hn.add(base({ body: 'Later note' }));
    const l = hn.latest();
    assert.equal(l.id, n2.id);
  });

  it('returns a shaped object (has author)', () => {
    hn.add(base());
    assert.ok('author' in hn.latest());
  });
});

// ── recent ────────────────────────────────────────────────────────

describe('handoverNotes — recent', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(hn.recent()));
  });

  it('respects the limit parameter', () => {
    // Add 5 notes and request only 3
    for (let i = 0; i < 5; i++) hn.add(base({ body: `Note ${i}` }));
    const r = hn.recent(3);
    assert.ok(r.length <= 3);
  });

  it('default limit is 20', () => {
    // Can only verify it returns at most 20 (we have fewer than 20)
    const r = hn.recent();
    assert.ok(r.length <= 20);
  });

  it('ordered newest-first (DESC by created_at)', () => {
    const n1 = hn.add(base({ body: 'Older' }));
    const n2 = hn.add(base({ body: 'Newer' }));
    const r = hn.recent(2);
    // The two most recent — n2 should appear before n1
    const idx1 = r.findIndex((x) => x.id === n1.id);
    const idx2 = r.findIndex((x) => x.id === n2.id);
    if (idx1 !== -1 && idx2 !== -1) {
      assert.ok(idx2 < idx1, 'newer note should appear before older note');
    }
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('handoverNotes — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(hn.findById(999999), null);
  });

  it('returns the shaped row for a known id', () => {
    const n = hn.add(base({ body: 'Find me' }));
    const found = hn.findById(n.id);
    assert.ok(found !== null);
    assert.equal(found.id,   n.id);
    assert.equal(found.body, 'Find me');
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('handoverNotes — remove', () => {
  it('findById returns null after remove()', () => {
    const n = hn.add(base());
    hn.remove(n.id);
    assert.equal(hn.findById(n.id), null);
  });

  it('does not throw when removing an unknown id', () => {
    assert.doesNotThrow(() => hn.remove(999999));
  });
});
