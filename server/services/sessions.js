'use strict';

/*
 * LP-1 — Session store backed by SQLite.
 *
 * Opaque 32-byte hex bearer tokens, now persisted to the `sessions` table
 * so active sessions survive server restarts. TTL is 12 hours; a background
 * sweep prunes expired rows hourly.
 *
 * Token resolution order (unchanged from demo version):
 *   1. Authorization: Bearer <token>  header
 *   2. ?token= query param (SSE endpoints only — EventSource can't set headers)
 */

const crypto = require('crypto');
const db     = require('../db');

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const stmts = {
  insert:  db.prepare(`
    INSERT INTO sessions (token, user_id, issued_at, expires_at, ip, user_agent)
    VALUES (@token, @user_id, @issued_at, @expires_at, @ip, @user_agent)
  `),
  get:        db.prepare('SELECT * FROM sessions WHERE token = ?'),
  delete:     db.prepare('DELETE FROM sessions WHERE token = ?'),
  purge:      db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
  byUser:     db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  listUser:        db.prepare("SELECT token, user_id, issued_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at >= datetime('now') ORDER BY issued_at DESC"),
  listAll:         db.prepare("SELECT token, user_id, issued_at, expires_at, ip, user_agent FROM sessions WHERE expires_at >= datetime('now') ORDER BY issued_at DESC"),
  deleteByToken:   db.prepare('DELETE FROM sessions WHERE token = ?'),
  getByPrefix:     db.prepare("SELECT * FROM sessions WHERE token LIKE ? LIMIT 1"),
  purgeResets:     db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < datetime('now')"),
};

/* Purge expired sessions + reset tokens on boot and then every hour. */
stmts.purge.run();
try { stmts.purgeResets.run(); } catch (_) {} // table may not exist yet on first boot
setInterval(() => {
  stmts.purge.run();
  try { stmts.purgeResets.run(); } catch (_) {}
}, 60 * 60 * 1000).unref();

/**
 * Issue a new session token for a user.
 * @param {object} user   — full user row from state/users.js
 * @param {object} [meta] — optional { ip, user_agent }
 * @returns {{ token: string, expires_at: string }}
 */
function issue(user, meta = {}) {
  const token      = crypto.randomBytes(32).toString('hex');
  const now        = new Date();
  const expires_at = new Date(now.getTime() + TTL_MS).toISOString();

  stmts.insert.run({
    token,
    user_id:    user.id,
    issued_at:  now.toISOString(),
    expires_at,
    ip:         meta.ip || null,
    user_agent: meta.user_agent || null,
  });

  return { token, expires_at };
}

/**
 * Resolve a token → session object ({ user_id, issued_at, expires_at }) or null.
 * Returns null if the token is unknown or expired.
 */
function resolve(token) {
  if (!token) return null;
  const s = stmts.get.get(token);
  if (!s) return null;
  if (Date.parse(s.expires_at) < Date.now()) {
    stmts.delete.run(token); // clean up expired token on access
    return null;
  }
  return s;
}

/**
 * Revoke a specific token (logout).
 */
function revoke(token) {
  if (!token) return false;
  const info = stmts.delete.run(token);
  return info.changes > 0;
}

/**
 * Revoke ALL sessions for a user (force logout everywhere — e.g. after
 * password change or account deactivation).
 */
function revokeAll(userId) {
  stmts.byUser.run(userId);
}

/**
 * List all active (non-expired) sessions for one user.
 * Returns rows with token prefix only (never the full token).
 */
function list(userId) {
  return stmts.listUser.all(userId).map(maskToken);
}

/**
 * List all active sessions across all users (admin view).
 */
function listAll() {
  return stmts.listAll.all().map(maskToken);
}

/**
 * Revoke a session by token prefix (first 8 chars).
 * Returns { ok, user_id } — caller must verify user_id matches before acting.
 */
function revokeByPrefix(prefix) {
  const row = stmts.getByPrefix.get(`${prefix}%`);
  if (!row) return { ok: false, user_id: null };
  stmts.deleteByToken.run(row.token);
  return { ok: true, user_id: row.user_id };
}

/** Mask full token — expose only first 8 chars for UI display. */
function maskToken(s) {
  return { ...s, token_prefix: s.token.slice(0, 8), token: undefined };
}

module.exports = { issue, resolve, revoke, revokeAll, list, listAll, revokeByPrefix };
