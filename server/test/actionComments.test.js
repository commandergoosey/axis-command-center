'use strict';

/*
 * Tests for state/actionComments.js —
 *   add, remove, findById, forItem, countFor, countsByItem
 *
 * Uses an in-memory SQLite DB. actionComments.js creates its own
 * action_item_comments table idempotently — no stubs or migrations required.
 * action_item_id is a free TEXT key (no FK) so no related table needed.
 *
 * Covers:
 *   - add: action_item_id required throws; empty/whitespace body throws;
 *     body > 2000 chars throws; trims body; stores action_item_id and body;
 *     created_at recent ISO; author fields stored / null when omitted;
 *     return shape (id, body, created_at, author — no action_item_id in shape)
 *   - remove: findById null after; no-op on unknown id
 *   - findById: null for unknown; shaped row for known
 *   - forItem: empty for unknown item; returns all comments for item;
 *     ordered oldest-first (ASC created_at/id); isolation between items
 *   - countFor: 0 for unknown item; increments with each add; decrements
 *     after remove
 *   - countsByItem: returns object keyed by action_item_id; counts correct;
 *     independent per item
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/actionComments')];
const ac = require('../state/actionComments');

// ── Helpers ───────────────────────────────────────────────────────
let _seq = 0;
function itemId() { return `act-ac-${String(++_seq).padStart(4, '0')}`; }

function base(action_item_id, overrides = {}) {
  return {
    action_item_id,
    body:       'Following up with hauler on payment.',
    by_user_id: 'u-ac-01',
    by_display: 'Comment Author',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('actionComments — add', () => {
  it('throws when action_item_id is missing', () => {
    assert.throws(
      () => ac.add({ body: 'test' }),
      /action_item_id required/i,
    );
  });

  it('throws when body is empty string', () => {
    assert.throws(
      () => ac.add({ action_item_id: itemId(), body: '' }),
      /body required/i,
    );
  });

  it('throws when body is only whitespace', () => {
    assert.throws(
      () => ac.add({ action_item_id: itemId(), body: '   ' }),
      /body required/i,
    );
  });

  it('throws when body exceeds 2000 characters', () => {
    assert.throws(
      () => ac.add({ action_item_id: itemId(), body: 'x'.repeat(2001) }),
      /too long/i,
    );
  });

  it('accepts body of exactly 2000 characters', () => {
    const id = itemId();
    const c = ac.add({ action_item_id: id, body: 'a'.repeat(2000) });
    assert.equal(c.body.length, 2000);
  });

  it('trims whitespace from body', () => {
    const id = itemId();
    const c = ac.add({ action_item_id: id, body: '  trimmed  ' });
    assert.equal(c.body, 'trimmed');
  });

  it('stores the body text', () => {
    const id = itemId();
    const c = ac.add(base(id, { body: 'Specific body text' }));
    assert.equal(c.body, 'Specific body text');
  });

  it('created_at is a recent ISO string', () => {
    const id = itemId();
    const before = Date.now();
    const c = ac.add(base(id));
    const after = Date.now();
    const ts = new Date(c.created_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('author has user_id, display_name, role when provided', () => {
    const id = itemId();
    const c = ac.add(base(id, {
      by_user_id: 'u-commenter',
      by_display: 'Commenter',
      by_role:    'lender',
    }));
    assert.deepEqual(c.author, {
      user_id:      'u-commenter',
      display_name: 'Commenter',
      role:         'lender',
    });
  });

  it('author fields are null when not provided', () => {
    const id = itemId();
    const c = ac.add({ action_item_id: id, body: 'Anonymous comment' });
    assert.equal(c.author.user_id,      null);
    assert.equal(c.author.display_name, null);
    assert.equal(c.author.role,         null);
  });

  it('return shape has id, body, created_at, author', () => {
    const id = itemId();
    const c = ac.add(base(id));
    assert.ok('id'         in c);
    assert.ok('body'       in c);
    assert.ok('created_at' in c);
    assert.ok('author'     in c);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('actionComments — remove', () => {
  it('findById returns null after remove()', () => {
    const id = itemId();
    const c = ac.add(base(id));
    ac.remove(c.id);
    assert.equal(ac.findById(c.id), null);
  });

  it('does not throw when removing an unknown id', () => {
    assert.doesNotThrow(() => ac.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('actionComments — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(ac.findById(999999), null);
  });

  it('returns the shaped row for a known id', () => {
    const id = itemId();
    const c = ac.add(base(id));
    const found = ac.findById(c.id);
    assert.ok(found !== null);
    assert.equal(found.id,   c.id);
    assert.equal(found.body, c.body);
  });
});

// ── forItem ───────────────────────────────────────────────────────

describe('actionComments — forItem', () => {
  it('returns an empty array for an unknown action_item_id', () => {
    assert.deepEqual(ac.forItem('act-never'), []);
  });

  it('returns all comments for the item', () => {
    const id = itemId();
    ac.add(base(id, { body: 'First' }));
    ac.add(base(id, { body: 'Second' }));
    assert.equal(ac.forItem(id).length, 2);
  });

  it('ordered oldest-first (ASC created_at/id)', () => {
    const id = itemId();
    const c1 = ac.add(base(id, { body: 'Older' }));
    const c2 = ac.add(base(id, { body: 'Newer' }));
    const comments = ac.forItem(id);
    const ours = comments.filter((c) => c.id === c1.id || c.id === c2.id);
    assert.equal(ours[0].id, c1.id, 'first inserted should appear first');
    assert.equal(ours[1].id, c2.id);
  });

  it('does not include comments from other items', () => {
    const idA = itemId();
    const idB = itemId();
    ac.add(base(idA));
    assert.ok(!ac.forItem(idB).some((c) => c.body === 'Only for A'));
  });
});

// ── countFor ─────────────────────────────────────────────────────

describe('actionComments — countFor', () => {
  it('returns 0 for an unknown action_item_id', () => {
    assert.equal(ac.countFor('act-never'), 0);
  });

  it('increments with each add()', () => {
    const id = itemId();
    assert.equal(ac.countFor(id), 0);
    ac.add(base(id));
    assert.equal(ac.countFor(id), 1);
    ac.add(base(id));
    assert.equal(ac.countFor(id), 2);
  });

  it('decrements after remove()', () => {
    const id = itemId();
    const c = ac.add(base(id));
    const before = ac.countFor(id);
    ac.remove(c.id);
    assert.equal(ac.countFor(id), before - 1);
  });
});

// ── countsByItem ──────────────────────────────────────────────────

describe('actionComments — countsByItem', () => {
  it('returns an object', () => {
    assert.ok(typeof ac.countsByItem() === 'object');
  });

  it('count for an item appears in the map', () => {
    const id = itemId();
    ac.add(base(id));
    ac.add(base(id));
    const counts = ac.countsByItem();
    assert.ok(id in counts, 'item should appear in countsByItem');
    assert.ok(counts[id] >= 2);
  });

  it('counts are independent per item', () => {
    const idA = itemId();
    const idB = itemId();
    ac.add(base(idA));
    ac.add(base(idA));
    ac.add(base(idB));
    const counts = ac.countsByItem();
    assert.ok(counts[idA] >= 2);
    assert.ok(counts[idB] >= 1);
  });
});
