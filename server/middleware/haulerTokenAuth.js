'use strict';

/*
 * Hauler API token authentication — LP-36.
 *
 * Middleware that checks the X-Hauler-Token request header against
 * the api_token column on the haulers table (added in migration-008).
 *
 * On match: attaches req.haulerToken = { hauler_id, display_name }
 *           and sets req.user if not already set (so webhook routes
 *           get a synthetic hauler identity without a bearer token).
 *
 * On mismatch / missing header: calls next() with no side effect —
 *   routes that require token auth must guard themselves.
 *
 * requireHaulerToken() is a standalone middleware that returns 401
 * if req.haulerToken is not set after this middleware runs.
 *
 * Usage:
 *   const { haulerTokenAuth, requireHaulerToken } = require('../middleware/haulerTokenAuth');
 *   router.post('/data', haulerTokenAuth, requireHaulerToken, handler);
 */

const db  = require('../db');
const log = require('../services/logger');

let _stmt = null;
function getStmt() {
  if (!_stmt) {
    try {
      _stmt = db.prepare('SELECT id, display_name FROM haulers WHERE api_token = ? AND active = 1 LIMIT 1');
    } catch (_) {
      // api_token column not yet available (migration pending). Ignore.
    }
  }
  return _stmt;
}

function haulerTokenAuth(req, res, next) {
  const token = req.headers['x-hauler-token'];
  if (!token) return next();

  try {
    const stmt = getStmt();
    if (!stmt) return next();
    const hauler = stmt.get(token);
    if (hauler) {
      req.haulerToken = { hauler_id: hauler.id, display_name: hauler.display_name };
      // Provide a synthetic user identity if none is set yet.
      if (!req.user) {
        req.user = {
          id:           `hauler:${hauler.id}`,
          role:         'hauler_admin',
          hauler_id:    hauler.id,
          display_name: hauler.display_name,
          organisation: hauler.display_name,
        };
      }
    }
  } catch (err) {
    log.warn('Hauler token auth error', { err: err.message });
  }

  next();
}

function requireHaulerToken(req, res, next) {
  if (!req.haulerToken) {
    return res.status(401).json({ error: 'Valid X-Hauler-Token header is required' });
  }
  next();
}

module.exports = { haulerTokenAuth, requireHaulerToken };
