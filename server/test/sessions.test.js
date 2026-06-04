'use strict';

/*
 * Tests for services/sessions.js —
 *   issue, resolve, revoke, revokeAll, list, listAll, revokeByPrefix
 *
 * Uses an in-memory SQLite DB (DB_PATH=:memory:) so no production data
 * is touched. Must be set BEFORE requiring db so the inline CREATE TABLE
 * statements run against the in-memory instance.
 *
 * Covers:
 *   - Token issuance: shape, length, TTL, metadata
 *   - Resolution: valid / unknown / expired / null input
 *   - Revocation: single token, all-user, by prefix
 *   - Listing: per-user masked list, all-user list, token masking
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must happen before any app module ──────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

// ── Fresh sessions module bound to the in-memory DB ───────────────
delete require.cache[require.resolve('../services/sessions')];
const sessions = require('../services/sessions');

// ── Fixtures ──────────────────────────────────────────────────────

// All test user IDs used anywhere in this file (sessions has FK → users)
const ALL_TEST_USERS = [
  { id: 'user-a',          display_name: 'Alice'   },
  { id: 'user-b',          display_name: 'Bob'     },
  { id: 'user-revoke-all', display_name: 'RevokeAll' },
  { id: 'user-rvk-a',      display_name: 'RvkA'   },
  { id: 'user-rvk-b',      display_name: 'RvkB'   },
  { id: 'user-list-1',     display_name: 'List1'   },
  { id: 'user-list-2',     display_name: 'List2'   },
  { id: 'user-list-3',     display_name: 'List3'   },
  { id: 'user-listall-1',  display_name: 'ListAll1'},
  { id: 'user-prefix-1',   display_name: 'Pfx1'   },
  { id: 'user-prefix-2',   display_name: 'Pfx2'   },
];

const USER_A = ALL_TEST_USERS[0];
const USER_B = ALL_TEST_USERS[1];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users
    (id, email, password_hash, display_name, role, active, created_at, updated_at)
  VALUES (@id, @email, @password_hash, @display_name, @role, 1, @ts, @ts)
`);

before(() => {
  const ts = new Date().toISOString();
  for (const u of ALL_TEST_USERS) {
    insertUser.run({
      id: u.id, email: `${u.id}@axis-test.local`,
      password_hash: 'testhash', display_name: u.display_name,
      role: 'axis_admin', ts,
    });
  }
});

// Insert a session directly with an already-expired expires_at so we
// can test the expiry-check branch without mocking Date.now().
function insertExpired(token, userId) {
  db.prepare(`
    INSERT INTO sessions (token, user_id, issued_at, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, null, null)
  `).run(token, userId, '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
}

// ── issue ─────────────────────────────────────────────────────────

describe('sessions — issue', () => {
  it('returns an object with token and expires_at', () => {
    const result = sessions.issue(USER_A);
    assert.ok('token'      in result, 'missing token');
    assert.ok('expires_at' in result, 'missing expires_at');
  });

  it('token is a 64-character hex string', () => {
    const { token } = sessions.issue(USER_A);
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(token), 'token should be lowercase hex');
  });

  it('expires_at is an ISO string in the future', () => {
    const { expires_at } = sessions.issue(USER_A);
    assert.ok(typeof expires_at === 'string');
    assert.ok(new Date(expires_at).getTime() > Date.now(),
      'expires_at should be in the future');
  });

  it('expires_at is approximately 12 hours from now', () => {
    const { expires_at } = sessions.issue(USER_A);
    const diffMs = new Date(expires_at).getTime() - Date.now();
    const diffH  = diffMs / (60 * 60 * 1000);
    assert.ok(diffH > 11.9 && diffH < 12.1,
      `expected ~12h TTL, got ${diffH.toFixed(2)}h`);
  });

  it('each call produces a unique token', () => {
    const t1 = sessions.issue(USER_A).token;
    const t2 = sessions.issue(USER_A).token;
    assert.notEqual(t1, t2);
  });

  it('optional meta ip and user_agent are stored', () => {
    const { token } = sessions.issue(USER_A, { ip: '10.0.0.1', user_agent: 'TestClient/1.0' });
    const row = db.prepare('SELECT ip, user_agent FROM sessions WHERE token = ?').get(token);
    assert.equal(row.ip, '10.0.0.1');
    assert.equal(row.user_agent, 'TestClient/1.0');
  });
});

// ── resolve ───────────────────────────────────────────────────────

describe('sessions — resolve', () => {
  it('returns session row for a valid token', () => {
    const { token } = sessions.issue(USER_A);
    const s = sessions.resolve(token);
    assert.ok(s !== null, 'expected non-null session');
    assert.equal(s.user_id, USER_A.id);
  });

  it('returned session has user_id, issued_at, expires_at', () => {
    const { token } = sessions.issue(USER_A);
    const s = sessions.resolve(token);
    for (const k of ['user_id', 'issued_at', 'expires_at']) {
      assert.ok(k in s, `session missing field: ${k}`);
    }
  });

  it('returns null for an unknown token', () => {
    assert.equal(sessions.resolve('0'.repeat(64)), null);
  });

  it('returns null for null input', () => {
    assert.equal(sessions.resolve(null), null);
  });

  it('returns null for an empty string', () => {
    assert.equal(sessions.resolve(''), null);
  });

  it('returns null for an expired token and cleans it up', () => {
    const expiredToken = 'b'.repeat(64);
    insertExpired(expiredToken, USER_A.id);
    assert.equal(sessions.resolve(expiredToken), null,
      'expired token should resolve to null');
    // Confirm the row was deleted as part of the expiry cleanup
    const row = db.prepare('SELECT token FROM sessions WHERE token = ?').get(expiredToken);
    assert.equal(row, undefined, 'expired token should be deleted from DB on access');
  });
});

// ── revoke ────────────────────────────────────────────────────────

describe('sessions — revoke', () => {
  it('returns true when the token exists and is revoked', () => {
    const { token } = sessions.issue(USER_A);
    assert.equal(sessions.revoke(token), true);
  });

  it('returns false for an unknown token', () => {
    assert.equal(sessions.revoke('c'.repeat(64)), false);
  });

  it('returns false for null', () => {
    assert.equal(sessions.revoke(null), false);
  });

  it('resolve returns null after revoke', () => {
    const { token } = sessions.issue(USER_A);
    sessions.revoke(token);
    assert.equal(sessions.resolve(token), null);
  });
});

// ── revokeAll ─────────────────────────────────────────────────────

describe('sessions — revokeAll', () => {
  it('removes all sessions for the specified user', () => {
    const u = 'user-revoke-all';
    sessions.issue({ id: u });
    sessions.issue({ id: u });
    sessions.revokeAll(u);
    const rows = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(u);
    assert.equal(rows.length, 0, 'all sessions should be gone after revokeAll');
  });

  it('does not remove sessions for other users', () => {
    const uA = 'user-rvk-a';
    const uB = 'user-rvk-b';
    const { token: tB } = sessions.issue({ id: uB });
    sessions.issue({ id: uA });
    sessions.revokeAll(uA);
    assert.ok(sessions.resolve(tB) !== null, 'user B token should survive revokeAll of user A');
  });
});

// ── list ──────────────────────────────────────────────────────────

describe('sessions — list', () => {
  it('returns active sessions for the user', () => {
    const u = 'user-list-1';
    sessions.issue({ id: u });
    const rows = sessions.list(u);
    assert.ok(rows.length >= 1, 'expected at least one session in list');
  });

  it('each row has token_prefix (first 8 chars) and no full token', () => {
    const u = 'user-list-2';
    const { token } = sessions.issue({ id: u });
    const rows = sessions.list(u);
    const row = rows.find((r) => r.token_prefix === token.slice(0, 8));
    assert.ok(row, 'expected row with matching token_prefix');
    assert.equal(row.token, undefined, 'full token must not be exposed in list');
  });

  it('expired sessions do not appear in list', () => {
    const u = 'user-list-3';
    const expiredToken = 'd'.repeat(64);
    insertExpired(expiredToken, u);
    const rows = sessions.list(u);
    assert.ok(
      !rows.some((r) => r.token_prefix === expiredToken.slice(0, 8)),
      'expired session should not appear in list',
    );
  });
});

// ── listAll ───────────────────────────────────────────────────────

describe('sessions — listAll', () => {
  it('returns an array of active sessions across all users', () => {
    const result = sessions.listAll();
    assert.ok(Array.isArray(result));
  });

  it('each row has token_prefix and user_id', () => {
    const u = 'user-listall-1';
    const { token } = sessions.issue({ id: u });
    const rows = sessions.listAll();
    const row = rows.find((r) => r.user_id === u && r.token_prefix === token.slice(0, 8));
    assert.ok(row, 'expected listAll to include just-issued session');
  });
});

// ── revokeByPrefix ────────────────────────────────────────────────

describe('sessions — revokeByPrefix', () => {
  it('returns { ok: true, user_id } when prefix matches', () => {
    const u = 'user-prefix-1';
    const { token } = sessions.issue({ id: u });
    const prefix = token.slice(0, 8);
    const result = sessions.revokeByPrefix(prefix);
    assert.equal(result.ok, true);
    assert.equal(result.user_id, u);
  });

  it('session is gone after revokeByPrefix', () => {
    const u = 'user-prefix-2';
    const { token } = sessions.issue({ id: u });
    sessions.revokeByPrefix(token.slice(0, 8));
    assert.equal(sessions.resolve(token), null,
      'session should be gone after revokeByPrefix');
  });

  it('returns { ok: false, user_id: null } when prefix not found', () => {
    const result = sessions.revokeByPrefix('00000000');
    assert.equal(result.ok, false);
    assert.equal(result.user_id, null);
  });
});
