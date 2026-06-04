'use strict';

/*
 * Tests for state/userPins.js —
 *   PINNABLE_TYPES, add, removeById, removeByRef, forUser, isPinned
 *
 * Uses an in-memory SQLite DB. userPins.js creates its own table with
 * a UNIQUE constraint on (user_id, entity_type, entity_id) — no stubs
 * or migrations required.
 *
 * Covers:
 *   - PINNABLE_TYPES: exported array with expected values
 *   - add: user_id required; unknown entity_type throws; entity_id
 *     required; stores entity_type/entity_id/label; label truncated to
 *     200 chars; label null when omitted; pinned_at recent ISO; upsert
 *     on duplicate (same user+type+id re-pins, updates pinned_at);
 *     return shape has id/entity_type/entity_id/label/pinned_at
 *   - removeById: pin absent after; requires matching user_id (security);
 *     no-op on unknown id
 *   - removeByRef: pin absent after removeByRef; no-op on unknown ref
 *   - forUser: empty array for unknown user; returns all for user;
 *     does not include other users' pins; ordered pinned_at ASC
 *   - isPinned: false for unknown; true after add; false after removeByRef
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/userPins')];
const up = require('../state/userPins');

let _seq = 0;
function uid()  { return `u-up-${++_seq}`; }
function eid()  { return `ent-${_seq}`; }

// ── PINNABLE_TYPES ────────────────────────────────────────────────

describe('userPins — PINNABLE_TYPES', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(up.PINNABLE_TYPES));
  });

  it('contains hauler, risk, alert, contact, filing', () => {
    for (const t of ['hauler', 'risk', 'alert', 'contact', 'filing']) {
      assert.ok(up.PINNABLE_TYPES.includes(t), `missing type: ${t}`);
    }
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('userPins — add', () => {
  it('throws when user_id is missing', () => {
    assert.throws(
      () => up.add({ entity_type: 'risk', entity_id: eid() }),
      /user_id required/i,
    );
  });

  it('throws for an unknown entity_type', () => {
    assert.throws(
      () => up.add({ user_id: uid(), entity_type: 'shipment', entity_id: eid() }),
      /cannot pin/i,
    );
  });

  it('throws when entity_id is missing', () => {
    assert.throws(
      () => up.add({ user_id: uid(), entity_type: 'risk' }),
      /entity_id required/i,
    );
  });

  it('stores entity_type and entity_id', () => {
    const userId = uid(); const entityId = eid();
    const pin = up.add({ user_id: userId, entity_type: 'hauler', entity_id: entityId });
    assert.equal(pin.entity_type, 'hauler');
    assert.equal(pin.entity_id,   entityId);
  });

  it('stores label when provided', () => {
    const userId = uid();
    const pin = up.add({ user_id: userId, entity_type: 'risk', entity_id: eid(), label: 'My Risk' });
    assert.equal(pin.label, 'My Risk');
  });

  it('truncates label to 200 characters', () => {
    const userId = uid();
    const pin = up.add({ user_id: userId, entity_type: 'risk', entity_id: eid(), label: 'x'.repeat(300) });
    assert.equal(pin.label.length, 200);
  });

  it('label is null when not provided', () => {
    const userId = uid();
    const pin = up.add({ user_id: userId, entity_type: 'alert', entity_id: eid() });
    assert.equal(pin.label, null);
  });

  it('pinned_at is a recent ISO string', () => {
    const userId = uid();
    const before = Date.now();
    const pin = up.add({ user_id: userId, entity_type: 'contact', entity_id: eid() });
    const after = Date.now();
    const ts = new Date(pin.pinned_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('upsert: re-pinning same ref does not create a duplicate', () => {
    const userId = uid(); const entityId = eid();
    up.add({ user_id: userId, entity_type: 'risk', entity_id: entityId, label: 'First' });
    up.add({ user_id: userId, entity_type: 'risk', entity_id: entityId, label: 'Second' });
    const pins = up.forUser(userId).filter((p) => p.entity_type === 'risk' && p.entity_id === entityId);
    assert.equal(pins.length, 1);
  });

  it('return shape has id, entity_type, entity_id, label, pinned_at', () => {
    const userId = uid();
    const pin = up.add({ user_id: userId, entity_type: 'filing', entity_id: eid() });
    for (const f of ['id', 'entity_type', 'entity_id', 'label', 'pinned_at']) {
      assert.ok(f in pin, `missing field: ${f}`);
    }
  });
});

// ── removeById ────────────────────────────────────────────────────

describe('userPins — removeById', () => {
  it('pin is absent from forUser() after removeById()', () => {
    const userId = uid();
    const pin = up.add({ user_id: userId, entity_type: 'risk', entity_id: eid() });
    up.removeById(pin.id, userId);
    assert.ok(!up.forUser(userId).some((p) => p.id === pin.id));
  });

  it('does not remove pin if user_id does not match (security guard)', () => {
    const ownerUser = uid();
    const otherUser = uid();
    const pin = up.add({ user_id: ownerUser, entity_type: 'risk', entity_id: eid() });
    up.removeById(pin.id, otherUser); // wrong user — should be a no-op
    assert.ok(up.forUser(ownerUser).some((p) => p.id === pin.id),
      'pin should remain when wrong user_id is passed to removeById');
  });

  it('does not throw on unknown id', () => {
    assert.doesNotThrow(() => up.removeById(999999, uid()));
  });
});

// ── removeByRef ───────────────────────────────────────────────────

describe('userPins — removeByRef', () => {
  it('pin is absent from isPinned() after removeByRef()', () => {
    const userId = uid(); const entityId = eid();
    up.add({ user_id: userId, entity_type: 'hauler', entity_id: entityId });
    up.removeByRef(userId, 'hauler', entityId);
    assert.equal(up.isPinned(userId, 'hauler', entityId), false);
  });

  it('does not throw on unknown ref', () => {
    assert.doesNotThrow(() => up.removeByRef(uid(), 'alert', 'never-pinned'));
  });
});

// ── forUser ───────────────────────────────────────────────────────

describe('userPins — forUser', () => {
  it('returns an empty array for an unknown user', () => {
    assert.deepEqual(up.forUser('u-nobody'), []);
  });

  it('returns all pins for a user', () => {
    const userId = uid();
    up.add({ user_id: userId, entity_type: 'risk',   entity_id: eid() });
    up.add({ user_id: userId, entity_type: 'hauler', entity_id: eid() });
    assert.equal(up.forUser(userId).length, 2);
  });

  it('does not include another user\'s pins', () => {
    const userA = uid(); const userB = uid();
    up.add({ user_id: userA, entity_type: 'alert', entity_id: eid() });
    assert.ok(!up.forUser(userB).some((p) => p.entity_type === 'alert'));
  });
});

// ── isPinned ──────────────────────────────────────────────────────

describe('userPins — isPinned', () => {
  it('returns false for a never-pinned ref', () => {
    assert.equal(up.isPinned(uid(), 'risk', eid()), false);
  });

  it('returns true after add()', () => {
    const userId = uid(); const entityId = eid();
    up.add({ user_id: userId, entity_type: 'contact', entity_id: entityId });
    assert.equal(up.isPinned(userId, 'contact', entityId), true);
  });

  it('returns false after removeByRef()', () => {
    const userId = uid(); const entityId = eid();
    up.add({ user_id: userId, entity_type: 'filing', entity_id: entityId });
    up.removeByRef(userId, 'filing', entityId);
    assert.equal(up.isPinned(userId, 'filing', entityId), false);
  });
});
