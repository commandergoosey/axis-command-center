'use strict';

/*
 * Tests for state/riskComments.js —
 *   add, remove, findById, forRisk, recentForRisk, countsByRisk
 *
 * Uses an in-memory SQLite DB. riskRegister.js creates the risk_register
 * table (idempotent); riskComments.js creates risk_comments with a FK
 * ON DELETE CASCADE reference to risk_register. foreign_keys = ON in
 * db/index.js, so we create real risk_register rows as fixtures.
 *
 * No seed function — tables start empty.
 *
 * Covers:
 *   - add: empty/whitespace body throws; body > 2000 chars throws;
 *     trims leading/trailing whitespace; stores body; created_at is a
 *     recent ISO string; author fields (user_id/display_name/role);
 *     author fields null when omitted; shape has id, risk_id, body,
 *     created_at, author
 *   - findById: null for unknown id; returns shaped row for known id
 *   - remove: findById null after remove; no-op on unknown id
 *   - forRisk: empty array for unknown risk_id; returns all comments
 *     for a risk; ordered ASC by created_at/id (oldest first)
 *   - recentForRisk: empty for unknown; returns latest N in descending
 *     order (newest first); limit param respected; default limit = 3
 *   - countsByRisk: empty object when no comments; keyed by risk_id;
 *     value is count of comments for that risk
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

// riskRegister creates risk_register table (FK target)
delete require.cache[require.resolve('../state/riskRegister')];
const rr = require('../state/riskRegister');

// riskComments creates risk_comments table (FK referencing risk_register)
delete require.cache[require.resolve('../state/riskComments')];
const rc = require('../state/riskComments');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

// Build a minimal valid risk and return its id
function makeRisk(overrides = {}) {
  const risk = rr.add({
    title:      `Risk ${++_seq}`,
    category:   'financial',
    severity:   'medium',
    likelihood: 'possible',
    ...overrides,
  });
  return risk.id;
}

function baseComment(risk_id, overrides = {}) {
  return {
    risk_id,
    body:       'This is a test comment.',
    by_user_id: 'u-rc-01',
    by_display: 'RC Author',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('riskComments — add', () => {
  it('throws when body is empty string', () => {
    const rid = makeRisk();
    assert.throws(
      () => rc.add({ risk_id: rid, body: '' }),
      /body required/i,
    );
  });

  it('throws when body is only whitespace', () => {
    const rid = makeRisk();
    assert.throws(
      () => rc.add({ risk_id: rid, body: '   ' }),
      /body required/i,
    );
  });

  it('throws when body is missing', () => {
    const rid = makeRisk();
    assert.throws(
      () => rc.add({ risk_id: rid }),
      /body required/i,
    );
  });

  it('throws when body exceeds 2000 characters', () => {
    const rid = makeRisk();
    assert.throws(
      () => rc.add({ risk_id: rid, body: 'x'.repeat(2001) }),
      /too long/i,
    );
  });

  it('accepts body of exactly 2000 characters', () => {
    const rid = makeRisk();
    const comment = rc.add({ risk_id: rid, body: 'a'.repeat(2000) });
    assert.equal(comment.body.length, 2000);
  });

  it('trims leading and trailing whitespace from body', () => {
    const rid = makeRisk();
    const comment = rc.add({ risk_id: rid, body: '  trimmed  ' });
    assert.equal(comment.body, 'trimmed');
  });

  it('stores the body text', () => {
    const rid = makeRisk();
    const comment = rc.add(baseComment(rid, { body: 'Specific comment text' }));
    assert.equal(comment.body, 'Specific comment text');
  });

  it('created_at is a recent ISO string', () => {
    const rid = makeRisk();
    const before = Date.now();
    const comment = rc.add(baseComment(rid));
    const after = Date.now();
    const ts = new Date(comment.created_at).getTime();
    assert.ok(ts >= before && ts <= after, 'created_at should be within test window');
  });

  it('author has user_id, display_name, role', () => {
    const rid = makeRisk();
    const comment = rc.add(baseComment(rid, {
      by_user_id: 'u-author',
      by_display: 'Comment Author',
      by_role:    'lender',
    }));
    assert.deepEqual(comment.author, {
      user_id:      'u-author',
      display_name: 'Comment Author',
      role:         'lender',
    });
  });

  it('author fields are null when omitted', () => {
    const rid = makeRisk();
    const comment = rc.add({ risk_id: rid, body: 'Anonymous comment' });
    assert.equal(comment.author.user_id,      null);
    assert.equal(comment.author.display_name, null);
    assert.equal(comment.author.role,         null);
  });

  it('return shape has id, risk_id, body, created_at, author', () => {
    const rid = makeRisk();
    const comment = rc.add(baseComment(rid));
    assert.ok('id'         in comment);
    assert.ok('risk_id'    in comment);
    assert.ok('body'       in comment);
    assert.ok('created_at' in comment);
    assert.ok('author'     in comment);
    assert.equal(comment.risk_id, rid);
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('riskComments — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(rc.findById(999999), null);
  });

  it('returns the shaped row for a known id', () => {
    const rid = makeRisk();
    const c = rc.add(baseComment(rid));
    const found = rc.findById(c.id);
    assert.ok(found !== null);
    assert.equal(found.id,      c.id);
    assert.equal(found.risk_id, rid);
    assert.equal(found.body,    c.body);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('riskComments — remove', () => {
  it('findById returns null after remove', () => {
    const rid = makeRisk();
    const c = rc.add(baseComment(rid));
    rc.remove(c.id);
    assert.equal(rc.findById(c.id), null);
  });

  it('does not throw when removing an unknown id', () => {
    assert.doesNotThrow(() => rc.remove(999999));
  });
});

// ── forRisk ───────────────────────────────────────────────────────

describe('riskComments — forRisk', () => {
  it('returns an empty array for an unknown risk_id', () => {
    assert.deepEqual(rc.forRisk(999999), []);
  });

  it('returns all comments for a risk', () => {
    const rid = makeRisk();
    rc.add(baseComment(rid, { body: 'First' }));
    rc.add(baseComment(rid, { body: 'Second' }));
    const comments = rc.forRisk(rid);
    assert.equal(comments.length, 2);
  });

  it('all comments belong to the requested risk_id', () => {
    const rid = makeRisk();
    rc.add(baseComment(rid));
    const comments = rc.forRisk(rid);
    assert.ok(comments.every((c) => c.risk_id === rid));
  });

  it('comments are ordered oldest first (ASC by created_at/id)', () => {
    const rid = makeRisk();
    const c1 = rc.add(baseComment(rid, { body: 'Older' }));
    const c2 = rc.add(baseComment(rid, { body: 'Newer' }));
    const comments = rc.forRisk(rid);
    // The one with the lower autoincrement id was inserted first
    const ids = comments.filter((c) => c.id === c1.id || c.id === c2.id).map((c) => c.id);
    assert.equal(ids[0], c1.id, 'first inserted comment should appear first');
    assert.equal(ids[1], c2.id);
  });

  it('does not include comments from other risks', () => {
    const ridA = makeRisk();
    const ridB = makeRisk();
    rc.add(baseComment(ridA, { body: 'Only for A' }));
    const comments = rc.forRisk(ridB);
    assert.ok(!comments.some((c) => c.risk_id === ridA));
  });
});

// ── recentForRisk ─────────────────────────────────────────────────

describe('riskComments — recentForRisk', () => {
  it('returns an empty array for an unknown risk_id', () => {
    assert.deepEqual(rc.recentForRisk(999999), []);
  });

  it('returns comments in descending order (newest first)', () => {
    const rid = makeRisk();
    const c1 = rc.add(baseComment(rid, { body: 'First inserted' }));
    const c2 = rc.add(baseComment(rid, { body: 'Second inserted' }));
    const c3 = rc.add(baseComment(rid, { body: 'Third inserted' }));
    const recent = rc.recentForRisk(rid, 3);
    // Newest (highest id) should be first
    assert.equal(recent[0].id, c3.id);
    assert.equal(recent[1].id, c2.id);
    assert.equal(recent[2].id, c1.id);
  });

  it('respects the limit parameter', () => {
    const rid = makeRisk();
    rc.add(baseComment(rid, { body: 'A' }));
    rc.add(baseComment(rid, { body: 'B' }));
    rc.add(baseComment(rid, { body: 'C' }));
    rc.add(baseComment(rid, { body: 'D' }));
    const recent = rc.recentForRisk(rid, 2);
    assert.equal(recent.length, 2);
  });

  it('default limit is 3', () => {
    const rid = makeRisk();
    for (let i = 0; i < 5; i++) {
      rc.add(baseComment(rid, { body: `Comment ${i}` }));
    }
    const recent = rc.recentForRisk(rid);
    assert.equal(recent.length, 3);
  });

  it('returns all comments when count is below limit', () => {
    const rid = makeRisk();
    rc.add(baseComment(rid, { body: 'Solo' }));
    const recent = rc.recentForRisk(rid, 10);
    assert.equal(recent.length, 1);
  });
});

// ── countsByRisk ──────────────────────────────────────────────────

describe('riskComments — countsByRisk', () => {
  it('returns an object', () => {
    assert.ok(typeof rc.countsByRisk() === 'object');
  });

  it('count for a risk increments with each add', () => {
    const rid = makeRisk();
    const before = rc.countsByRisk()[rid] || 0;
    rc.add(baseComment(rid));
    rc.add(baseComment(rid));
    assert.equal(rc.countsByRisk()[rid], before + 2);
  });

  it('different risk_ids have independent counts', () => {
    const ridA = makeRisk();
    const ridB = makeRisk();
    rc.add(baseComment(ridA));
    rc.add(baseComment(ridA));
    rc.add(baseComment(ridB));
    const counts = rc.countsByRisk();
    assert.ok(counts[ridA] >= 2);
    assert.ok(counts[ridB] >= 1);
    assert.ok(counts[ridA] !== counts[ridB] || counts[ridA] >= 1);
  });

  it('removed comment decrements count', () => {
    const rid = makeRisk();
    const c = rc.add(baseComment(rid));
    const before = rc.countsByRisk()[rid];
    rc.remove(c.id);
    const after = rc.countsByRisk()[rid] || 0;
    assert.equal(after, before - 1);
  });
});
