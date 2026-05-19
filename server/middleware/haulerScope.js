'use strict';

/**
 * LP-21: Hauler data isolation.
 *
 * When the authenticated user is a `hauler_admin`, overwrite
 * req.query.hauler_id with their own hauler_id so they can never
 * retrieve another hauler's data by crafting a different query param.
 *
 * Must be mounted after `attachUser` (which sets req.user). Routes
 * that require authentication should also mount `requireAuth` first so
 * unauthenticated requests are rejected before this middleware runs.
 *
 * Usage:
 *   const { enforceHaulerScope } = require('../middleware/haulerScope');
 *   router.get('/', requireAuth, enforceHaulerScope, handler);
 */

function enforceHaulerScope(req, res, next) {
  if (!req.user) return next(); // unauthenticated — let requireAuth reject it

  if (req.user.role === 'hauler_admin') {
    if (!req.user.hauler_id) {
      return res.status(403).json({ error: 'hauler_admin account has no hauler assigned' });
    }
    // Overwrite both query and params so every downstream read is scoped.
    req.query.hauler_id  = req.user.hauler_id;
    req.params.hauler_id = req.user.hauler_id;
  }

  next();
}

module.exports = { enforceHaulerScope };
