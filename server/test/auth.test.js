'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB — must happen before any app module ─────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// Insert test users with cost=1 hashes BEFORE requiring users.js.
// seed() checks row count and skips if > 0, avoiding the expensive
// cost=12 hashing that would make the test suite take ~800ms to start.
const NOW = new Date().toISOString();
const ADMIN_PASS  = 'admin-secret-99';
const HAULER_PASS = 'hauler-secret-99';

const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm', 'admin@test.gh',  bcrypt.hashSync(ADMIN_PASS,  1), 'Test Admin',  'axis_admin',   null,     'TestOrg',    NOW, NOW);
insertUser.run('u-hau', 'hauler@test.gh', bcrypt.hashSync(HAULER_PASS, 1), 'Test Hauler', 'hauler_admin', 'haul-01','TestHauler', NOW, NOW);
insertUser.run('u-len', 'lender@test.gh', bcrypt.hashSync('lender-pw',  1), 'Test Lender', 'lender',       null,     'TestLender', NOW, NOW);

// ── Stub mailer — prevents real email / SMTP calls ────────────────────
const mailerKey = require.resolve('../services/mailer');
require.cache[mailerKey] = {
  id: mailerKey, filename: mailerKey, loaded: true,
  exports: { sendPasswordReset: async () => {} },
};

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth', require('../routes/auth'));

let server, base;

before(() => new Promise((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

// ── Helpers ───────────────────────────────────────────────────────────
async function loginAs(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

async function getReq(path, token) {
  return fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function postReq(path, body, token) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────

describe('auth — login', () => {
  it('returns 400 when email is missing', async () => {
    const res = await postReq('/api/auth/login', { password: 'x' });
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('returns 400 when password is missing', async () => {
    const res = await postReq('/api/auth/login', { email: 'admin@test.gh' });
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('returns 401 for an unknown email', async () => {
    const { status } = await loginAs('nobody@test.gh', 'whatever');
    assert.strictEqual(status, 401);
  });

  it('returns 401 for a wrong password', async () => {
    const { status } = await loginAs('admin@test.gh', 'wrong-password');
    assert.strictEqual(status, 401);
  });

  it('returns 200 with user + token for valid credentials', async () => {
    const { status, user, token, expires_at } = await loginAs('admin@test.gh', ADMIN_PASS);
    assert.strictEqual(status, 200);
    assert.strictEqual(user.email, 'admin@test.gh');
    assert.strictEqual(user.role, 'axis_admin');
    assert.ok(token, 'token should be present');
    assert.ok(expires_at, 'expires_at should be present');
  });

  it('response never includes password_hash', async () => {
    const { user } = await loginAs('admin@test.gh', ADMIN_PASS);
    assert.ok(!('password_hash' in user), 'password_hash must not appear in login response');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('auth — requireAuth / GET /me', () => {
  it('returns 401 with no token', async () => {
    const res = await getReq('/api/auth/me');
    assert.strictEqual(res.status, 401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await getReq('/api/auth/me', 'not-a-real-token');
    assert.strictEqual(res.status, 401);
  });

  it('returns 200 with the correct user for a valid token', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const res = await getReq('/api/auth/me', token);
    assert.strictEqual(res.status, 200);
    const { user } = await res.json();
    assert.strictEqual(user.email, 'admin@test.gh');
    assert.strictEqual(user.id,    'u-adm');
    assert.ok(!('password_hash' in user), 'password_hash must not appear in /me response');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('auth — logout', () => {
  it('returns { ok: true }', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const res = await postReq('/api/auth/logout', {}, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);
  });

  it('revoked token is rejected on subsequent authenticated request', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    await postReq('/api/auth/logout', {}, token);
    const meRes = await getReq('/api/auth/me', token);
    assert.strictEqual(meRes.status, 401, 'revoked token must return 401');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('auth — change-password', () => {
  it('returns 400 when new_password is too short', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const res = await postReq('/api/auth/change-password',
      { current_password: ADMIN_PASS, new_password: 'short' }, token);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('returns 401 when current_password is wrong', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const res = await postReq('/api/auth/change-password',
      { current_password: 'bad-password', new_password: 'new-valid-pass-123' }, token);
    assert.strictEqual(res.status, 401);
  });

  it('changes password, revokes old sessions, and returns a new token', async () => {
    const { token: oldToken } = await loginAs('hauler@test.gh', HAULER_PASS);
    const newPass = 'new-hauler-pass-456';

    const changeRes = await postReq('/api/auth/change-password',
      { current_password: HAULER_PASS, new_password: newPass }, oldToken);
    assert.strictEqual(changeRes.status, 200);
    const { ok, token: newToken, expires_at } = await changeRes.json();
    assert.strictEqual(ok, true);
    assert.ok(newToken, 'new token should be returned');
    assert.ok(expires_at, 'expires_at should be returned');
    assert.notStrictEqual(newToken, oldToken, 'new token must differ from old');

    // Old token no longer works
    assert.strictEqual(
      (await getReq('/api/auth/me', oldToken)).status, 401,
      'old token must be revoked after password change'
    );

    // New token works
    assert.strictEqual(
      (await getReq('/api/auth/me', newToken)).status, 200,
      'new token must be valid immediately'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('auth — password reset flow', () => {
  it('request-reset returns 200 for an unknown email (no enumeration)', async () => {
    const res = await postReq('/api/auth/request-reset', { email: 'nobody@test.gh' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);
  });

  it('request-reset returns 200 for a known email', async () => {
    const res = await postReq('/api/auth/request-reset', { email: 'admin@test.gh' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);
  });

  it('reset-password returns 400 when new_password is too short', async () => {
    const res = await postReq('/api/auth/reset-password',
      { token: 'any', new_password: 'short' });
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('reset-password returns 400 for an invalid/unknown token', async () => {
    const res = await postReq('/api/auth/reset-password',
      { token: 'not-a-valid-reset-token-xyz', new_password: 'newpass-123' });
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('reset-password succeeds with a valid token and revokes all prior sessions', async () => {
    // Log in to create a live session that should be killed by the reset.
    const { token: liveSession } = await loginAs('admin@test.gh', ADMIN_PASS);

    // Generate a reset token directly (simulates the email-link flow).
    const resetToken = require('../state/users').createResetToken('u-adm');

    const resetRes = await postReq('/api/auth/reset-password',
      { token: resetToken, new_password: ADMIN_PASS }); // keep same password for subsequent tests
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual((await resetRes.json()).ok, true);

    // The live session that existed before the reset must be revoked.
    assert.strictEqual(
      (await getReq('/api/auth/me', liveSession)).status, 401,
      'all sessions should be invalidated after a password reset'
    );
  });

  it('reset-password returns 400 for a previously used token', async () => {
    const resetToken = require('../state/users').createResetToken('u-adm');
    await postReq('/api/auth/reset-password', { token: resetToken, new_password: ADMIN_PASS });
    const res2 = await postReq('/api/auth/reset-password', { token: resetToken, new_password: ADMIN_PASS });
    assert.strictEqual(res2.status, 400, 'used reset token must be rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('auth — session management', () => {
  it('GET /sessions returns active sessions for the current user', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const res = await getReq('/api/auth/sessions', token);
    assert.strictEqual(res.status, 200);
    const { sessions } = await res.json();
    assert.ok(Array.isArray(sessions));
    assert.ok(sessions.length >= 1, 'at least one active session should exist');
    assert.ok(sessions.every((s) => !s.token),         'full token must never be exposed');
    assert.ok(sessions.every((s) => s.token_prefix),   'token_prefix must be present');
  });

  it('DELETE /sessions/:prefix revokes that session', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const prefix = token.slice(0, 8);

    const delRes = await fetch(`${base}/api/auth/sessions/${prefix}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual((await delRes.json()).ok, true);

    // Token should now be invalid.
    assert.strictEqual(
      (await getReq('/api/auth/me', token)).status, 401,
      'session must be gone after DELETE'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('auth — user directory', () => {
  it('GET /users requires authentication', async () => {
    const res = await getReq('/api/auth/users');
    assert.strictEqual(res.status, 401);
  });

  it('GET /users excludes lender-role accounts', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const res = await getReq('/api/auth/users', token);
    assert.strictEqual(res.status, 200);
    const { users } = await res.json();
    assert.ok(Array.isArray(users));
    assert.ok(!users.find((u) => u.role === 'lender'), 'lender role must be excluded');
    assert.ok( users.find((u) => u.role === 'axis_admin'), 'axis_admin must be included');
  });

  it('GET /users never exposes password_hash', async () => {
    const { token } = await loginAs('admin@test.gh', ADMIN_PASS);
    const { users } = await (await getReq('/api/auth/users', token)).json();
    assert.ok(users.every((u) => !('password_hash' in u)), 'password_hash must not appear');
  });
});
