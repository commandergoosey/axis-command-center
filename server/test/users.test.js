'use strict';

/*
 * Tests for state/users.js —
 *   publicShape, findByCredentials, findById, findByEmail, list,
 *   create, update, setPassword, deactivate, reactivate,
 *   createResetToken, consumeResetToken
 *
 * Uses an in-memory SQLite DB. bcryptjs is stubbed with instant fake
 * hashes so seed() completes without the ~1.2 s real bcrypt cost.
 *
 * Stub strategy:
 *   hashSync(pwd)          → "FAKE:${pwd}"
 *   compareSync(pwd, hash) → hash === "FAKE:${pwd}"
 *
 * This keeps all credential-verification logic exercised while avoiding
 * the slow KDF computation in tests.
 *
 * Covers:
 *   - publicShape: null passthrough, hash removal, field preservation
 *   - findByCredentials: falsy args, unknown user, wrong password,
 *     deactivated account, successful login, raw row includes hash
 *   - findById / findByEmail: null args, unknown, known, case-insensitive
 *   - list: returns array, 4 seeded users, no password_hash exposed
 *   - create: missing required fields throw; email normalisation;
 *     id prefix; public shape; active default; persisted via findByEmail
 *   - update: throws for unknown id; patches individual fields; active flag
 *   - setPassword: short/empty throws; new pwd works; old pwd rejected
 *   - deactivate / reactivate: login blocked & restored; row persists
 *   - createResetToken: 64-char hex; unique per call
 *   - consumeResetToken: unknown / used / expired → null; valid → user_id
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must be set before any require of ../db ────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');   // creates all tables; kept for direct inserts in tests

// ── Stub helper ───────────────────────────────────────────────────
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Stub bcryptjs BEFORE requiring users.js ───────────────────────
// Prevents the ~1.2 s real bcrypt cost during seed() at module load.
stub('bcryptjs', {
  hashSync:    (pwd) => `FAKE:${pwd}`,
  compareSync: (pwd, hash) => hash === `FAKE:${pwd}`,
});

delete require.cache[require.resolve('../state/users')];
const users = require('../state/users');

// ── Fixture helper ────────────────────────────────────────────────
let _seq = 0;

function newUser(overrides = {}) {
  _seq += 1;
  return {
    email:        `testuser${_seq}@axis.test`,
    password:     'password123',
    display_name: `Test User ${_seq}`,
    role:         'axis_ops',
    hauler_id:    null,
    organisation: null,
    ...overrides,
  };
}

// ── publicShape ───────────────────────────────────────────────────

describe('users — publicShape', () => {
  it('returns null for null input', () => {
    assert.equal(users.publicShape(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(users.publicShape(undefined), null);
  });

  it('strips password_hash from the row', () => {
    const row = { id: 'u-1', email: 'a@test.local', password_hash: 'FAKE:secret', role: 'axis_ops' };
    const shaped = users.publicShape(row);
    assert.ok(!('password_hash' in shaped), 'password_hash should not appear in public shape');
  });

  it('preserves all other fields', () => {
    const row = {
      id:            'u-1',
      email:         'a@test.local',
      password_hash: 'FAKE:secret',
      role:          'axis_ops',
      display_name:  'Alice',
      active:        1,
    };
    const shaped = users.publicShape(row);
    assert.equal(shaped.id,           'u-1');
    assert.equal(shaped.email,        'a@test.local');
    assert.equal(shaped.role,         'axis_ops');
    assert.equal(shaped.display_name, 'Alice');
    assert.equal(shaped.active,       1);
  });
});

// ── findByCredentials ─────────────────────────────────────────────

describe('users — findByCredentials', () => {
  it('returns null when email is null', () => {
    assert.equal(users.findByCredentials(null, 'password123'), null);
  });

  it('returns null when email is empty string', () => {
    assert.equal(users.findByCredentials('', 'password123'), null);
  });

  it('returns null when password is null', () => {
    assert.equal(users.findByCredentials('admin@axis.gh', null), null);
  });

  it('returns null when password is empty string', () => {
    assert.equal(users.findByCredentials('admin@axis.gh', ''), null);
  });

  it('returns null for an unknown email', () => {
    assert.equal(users.findByCredentials('nobody@unknown.test', 'password123'), null);
  });

  it('returns null for a wrong password', () => {
    assert.equal(users.findByCredentials('admin@axis.gh', 'wrong-password'), null);
  });

  it('returns null for a deactivated account', () => {
    const u = users.create(newUser({ password: 'pass1234' }));
    users.deactivate(u.id);
    assert.equal(users.findByCredentials(u.email, 'pass1234'), null);
  });

  it('returns the raw user row for valid demo credentials', () => {
    // Demo seed stores FAKE:axis-admin-change-me via stub; compareSync matches
    const result = users.findByCredentials('admin@axis.gh', 'axis-admin-change-me');
    assert.ok(result !== null, 'expected non-null row for valid credentials');
    assert.equal(result.email, 'admin@axis.gh');
  });

  it('returned row includes password_hash (raw — caller must publicShape)', () => {
    const result = users.findByCredentials('admin@axis.gh', 'axis-admin-change-me');
    assert.ok('password_hash' in result,
      'findByCredentials returns raw row; caller should call publicShape()');
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('users — findById', () => {
  it('returns null for null id', () => {
    assert.equal(users.findById(null), null);
  });

  it('returns null for undefined id', () => {
    assert.equal(users.findById(undefined), null);
  });

  it('returns null for an unknown id', () => {
    assert.equal(users.findById('u-does-not-exist'), null);
  });

  it('returns the row for a known id', () => {
    const u = users.create(newUser());
    const result = users.findById(u.id);
    assert.ok(result !== null);
    assert.equal(result.id, u.id);
  });
});

// ── findByEmail ───────────────────────────────────────────────────

describe('users — findByEmail', () => {
  it('returns null for null email', () => {
    assert.equal(users.findByEmail(null), null);
  });

  it('returns null for an unknown email', () => {
    assert.equal(users.findByEmail('nobody@unknown.test'), null);
  });

  it('returns the row for a known email', () => {
    const u = users.create(newUser());
    const result = users.findByEmail(u.email);
    assert.ok(result !== null);
    assert.equal(result.id, u.id);
  });

  it('lookup is case-insensitive (COLLATE NOCASE)', () => {
    // create normalises to lowercase; COLLATE NOCASE in the query handles
    // mixed-case lookups on the stored value
    const u = users.create(newUser({ email: 'casecheck@axis.test' }));
    const result = users.findByEmail('CASECHECK@AXIS.TEST');
    assert.ok(result !== null, 'case-insensitive email lookup should find the row');
    assert.equal(result.id, u.id);
  });
});

// ── list ──────────────────────────────────────────────────────────

describe('users — list', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(users.list()));
  });

  it('includes at least the 4 seeded demo users', () => {
    assert.ok(users.list().length >= 4,
      `expected at least 4 users, got ${users.list().length}`);
  });

  it('no item in the list exposes password_hash', () => {
    for (const u of users.list()) {
      assert.ok(!('password_hash' in u),
        `user ${u.id} should not expose password_hash in list()`);
    }
  });

  it('each item has expected shape fields', () => {
    for (const u of users.list()) {
      for (const k of ['id', 'email', 'display_name', 'role', 'active']) {
        assert.ok(k in u, `list item ${u.id} missing field: ${k}`);
      }
    }
  });
});

// ── create ────────────────────────────────────────────────────────

describe('users — create', () => {
  it('throws when email is missing', () => {
    assert.throws(
      () => users.create({ password: 'pass1234', display_name: 'X', role: 'axis_ops' }),
      /required/i,
    );
  });

  it('throws when password is missing', () => {
    assert.throws(
      () => users.create({ email: 'x@test.local', display_name: 'X', role: 'axis_ops' }),
      /required/i,
    );
  });

  it('throws when display_name is missing', () => {
    assert.throws(
      () => users.create({ email: 'x@test.local', password: 'pass1234', role: 'axis_ops' }),
      /required/i,
    );
  });

  it('throws when role is missing', () => {
    assert.throws(
      () => users.create({ email: 'x@test.local', password: 'pass1234', display_name: 'X' }),
      /required/i,
    );
  });

  it('returns an object with expected shape fields', () => {
    const u = users.create(newUser());
    for (const k of ['id', 'email', 'display_name', 'role', 'active', 'created_at']) {
      assert.ok(k in u, `created user missing field: ${k}`);
    }
  });

  it('does not include password_hash in returned value', () => {
    const u = users.create(newUser());
    assert.ok(!('password_hash' in u),
      'create() should return public shape (no password_hash)');
  });

  it('email is trimmed and lowercased', () => {
    const u = users.create(newUser({ email: '  TRIM_CASE@AXIS.TEST  ' }));
    assert.equal(u.email, 'trim_case@axis.test');
  });

  it('id starts with "u-"', () => {
    const u = users.create(newUser());
    assert.ok(u.id.startsWith('u-'), `expected id to start with "u-", got: ${u.id}`);
  });

  it('active is truthy (1) by default', () => {
    const u = users.create(newUser());
    assert.ok(u.active, 'newly created user should be active by default');
  });

  it('can be retrieved via findByEmail after creation', () => {
    const u = users.create(newUser());
    const found = users.findByEmail(u.email);
    assert.ok(found !== null);
    assert.equal(found.id, u.id);
  });

  it('can log in immediately after creation', () => {
    const pwd = 'pass1234';
    const u = users.create(newUser({ password: pwd }));
    const result = users.findByCredentials(u.email, pwd);
    assert.ok(result !== null, 'new user should be able to log in immediately');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('users — update', () => {
  it('throws for an unknown id', () => {
    assert.throws(
      () => users.update('u-does-not-exist', { display_name: 'X' }),
      /not found/i,
    );
  });

  it('patches display_name without changing other fields', () => {
    const u = users.create(newUser({ role: 'axis_ops' }));
    const patched = users.update(u.id, { display_name: 'Updated Name' });
    assert.equal(patched.display_name, 'Updated Name');
    assert.equal(patched.role,         'axis_ops');  // unchanged
  });

  it('patches role', () => {
    const u = users.create(newUser({ role: 'axis_ops' }));
    const patched = users.update(u.id, { role: 'lender' });
    assert.equal(patched.role, 'lender');
  });

  it('sets active to 0 when active:false is passed', () => {
    const u = users.create(newUser());
    const patched = users.update(u.id, { active: false });
    assert.equal(patched.active, 0);
  });

  it('returns public shape (no password_hash)', () => {
    const u = users.create(newUser());
    const patched = users.update(u.id, { display_name: 'Y' });
    assert.ok(!('password_hash' in patched),
      'update() should return public shape');
  });
});

// ── setPassword ───────────────────────────────────────────────────

describe('users — setPassword', () => {
  it('throws for a password shorter than 8 characters', () => {
    const u = users.create(newUser());
    assert.throws(
      () => users.setPassword(u.id, 'short'),
      /at least 8/i,
    );
  });

  it('throws for an empty string password', () => {
    const u = users.create(newUser());
    assert.throws(
      () => users.setPassword(u.id, ''),
      /at least 8/i,
    );
  });

  it('after setPassword, login succeeds with the new password', () => {
    const u = users.create(newUser({ password: 'old-password-123' }));
    users.setPassword(u.id, 'new-password-456');
    const result = users.findByCredentials(u.email, 'new-password-456');
    assert.ok(result !== null, 'new password should enable login');
  });

  it('after setPassword, old password no longer works', () => {
    const u = users.create(newUser({ password: 'old-password-123' }));
    users.setPassword(u.id, 'new-password-456');
    const result = users.findByCredentials(u.email, 'old-password-123');
    assert.equal(result, null, 'old password should be rejected after setPassword');
  });
});

// ── deactivate / reactivate ───────────────────────────────────────

describe('users — deactivate / reactivate', () => {
  it('deactivate blocks login via findByCredentials', () => {
    const u = users.create(newUser({ password: 'pass1234' }));
    users.deactivate(u.id);
    assert.equal(users.findByCredentials(u.email, 'pass1234'), null);
  });

  it('deactivate does not delete the row — findById still returns it', () => {
    const u = users.create(newUser());
    users.deactivate(u.id);
    const row = users.findById(u.id);
    assert.ok(row !== null, 'deactivated user row should still exist');
    assert.equal(row.active, 0);
  });

  it('reactivate restores login ability', () => {
    const u = users.create(newUser({ password: 'pass1234' }));
    users.deactivate(u.id);
    users.reactivate(u.id);
    const result = users.findByCredentials(u.email, 'pass1234');
    assert.ok(result !== null, 'login should work after reactivation');
  });

  it('reactivated user has active = 1', () => {
    const u = users.create(newUser());
    users.deactivate(u.id);
    users.reactivate(u.id);
    assert.equal(users.findById(u.id).active, 1);
  });
});

// ── createResetToken ──────────────────────────────────────────────

describe('users — createResetToken', () => {
  it('returns a 64-character lowercase hex string', () => {
    const u = users.create(newUser());
    const token = users.createResetToken(u.id);
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64,
      `expected 64 hex chars, got ${token.length}`);
    assert.ok(/^[0-9a-f]+$/.test(token),
      `token should be lowercase hex, got: ${token}`);
  });

  it('each call returns a unique token', () => {
    const u = users.create(newUser());
    const t1 = users.createResetToken(u.id);
    const t2 = users.createResetToken(u.id);
    assert.notEqual(t1, t2, 'consecutive tokens should differ');
  });
});

// ── consumeResetToken ─────────────────────────────────────────────

describe('users — consumeResetToken', () => {
  it('returns null for an unknown token', () => {
    assert.equal(
      users.consumeResetToken('0'.repeat(64)),
      null,
    );
  });

  it('returns the user_id for a valid unused token', () => {
    const u = users.create(newUser());
    const token = users.createResetToken(u.id);
    assert.equal(users.consumeResetToken(token), u.id);
  });

  it('returns null on a second consume (token marked used)', () => {
    const u = users.create(newUser());
    const token = users.createResetToken(u.id);
    users.consumeResetToken(token);                    // first — valid
    assert.equal(users.consumeResetToken(token), null, // second — used
      'already-consumed token should return null');
  });

  it('returns null for an expired token', () => {
    const u = users.create(newUser());
    const expiredToken = 'f'.repeat(64);
    const now          = new Date();
    const pastExpiry   = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hrs ago
    db.prepare(
      'INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)'
    ).run(expiredToken, u.id, now.toISOString(), pastExpiry.toISOString());
    assert.equal(
      users.consumeResetToken(expiredToken),
      null,
      'expired token should return null',
    );
  });
});
