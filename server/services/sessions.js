'use strict';

/*
 * Session store — opaque bearer tokens mapped to user_id.
 *
 * Demonstration-grade only: in-memory, no signing, no rotation. Phase 11
 * replaces this with a signed JWT + refresh flow behind an identity
 * provider. Tokens are 32 bytes of crypto-random hex so they're
 * unguessable; that's the only security property we care about today.
 */

const crypto = require('crypto');

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const sessions = new Map(); // token -> { user_id, issued_at, expires_at }

function issue(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now   = Date.now();
  sessions.set(token, {
    user_id:    user.id,
    issued_at:  new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  });
  return { token, expires_at: new Date(now + TTL_MS).toISOString() };
}

function resolve(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.parse(s.expires_at) < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function revoke(token) {
  if (!token) return false;
  return sessions.delete(token);
}

module.exports = { issue, resolve, revoke };
