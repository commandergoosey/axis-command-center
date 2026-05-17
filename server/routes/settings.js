'use strict';

/*
 * GET /api/settings — axis_admin-only platform posture.
 *
 *   system       — product version, uptime, live vs demo mode, auth stats.
 *   users        — full user directory (no passwords). Use /api/admin/users
 *                  for write operations (LP-2).
 *   integrations — per-hauler integration roster (adapter, last sync,
 *                   error count, credentials present, live status).
 */

const express = require('express');
const router = express.Router();

const users            = require('../state/users');
const roster           = require('../state/roster');
const integrationStore = require('../state/integrationStore');
const { requireRole }  = require('../middleware/auth');

router.get('/', requireRole('axis_admin'), (_req, res) => {
  const haulers = roster.list();
  const integrations = haulers.map((h) => {
    const s = integrationStore.summary(h.id);
    return {
      hauler_id:       h.id,
      display_name:    h.display_name,
      type:            h.integration.type,
      adapter:         h.integration.adapter,
      last_sync:       h.integration.last_sync,
      error_count_24h: h.integration.error_count_24h,
      has_credentials: s.has_credentials,
      live:            s.live,
      csv_rows:        s.csv_rows ?? 0,
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    system: {
      product: 'AXIS Command Center',
      version: '0.1.0',
      mode:    process.env.AXIS_LIVE_MODE ? 'LIVE' : 'DEMONSTRATION',
      uptime_s: Math.floor(process.uptime()),
      auth: {
        scheme:    'opaque bearer',
        token_ttl_hours: 12,
      },
    },
    users: users.list().map((u) => ({
      id:           u.id,
      email:        u.email,
      display_name: u.display_name,
      role:         u.role,
      organisation: u.organisation,
      hauler_id:    u.hauler_id,
      active:       Boolean(u.active),
    })),
    integrations,
  });
});

module.exports = router;
