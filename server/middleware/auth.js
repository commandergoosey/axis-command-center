'use strict';

/*
 * Auth middleware — resolves a bearer token to the current user.
 *
 * attachUser: permissive. Populates req.user if the Authorization header
 *             carries a valid token; continues either way. Read-mostly
 *             routes use this so unauthenticated demo traffic still renders.
 *
 * requireAuth: strict. 401 if no user is attached.
 *
 * requireRole(...roles): strict role gate. 401 if no user, 403 if the
 *                        user's role is not in the allowlist. Used on
 *                        write endpoints (onboard, probe, generate).
 *
 * Token resolution order:
 *   1. Authorization: Bearer <token>  header (all standard endpoints)
 *   2. ?token= query param (Phase 100 — SSE stream endpoint only, because
 *      the EventSource API cannot set custom request headers)
 */

const sessions = require('../services/sessions');
const users    = require('../state/users');

function readToken(req) {
  const h = req.headers.authorization || '';
  const [scheme, token] = h.split(' ');
  if (scheme === 'Bearer' && token) return token;
  // Fallback: query-string token for SSE (EventSource can't set headers).
  if (req.query?.token) return String(req.query.token);
  return null;
}

function attachUser(req, _res, next) {
  const token = readToken(req);
  const session = sessions.resolve(token);
  if (session) {
    const u = users.findById(session.user_id);
    if (u) req.user = users.publicShape(u);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Role '${req.user.role}' cannot access this resource` });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireRole };
