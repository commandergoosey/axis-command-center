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
const db               = require('../db');
const { requireRole, requireAuth } = require('../middleware/auth');

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

/* ── LP-48 — Key-value settings store ───────────────────────────── */
//
// GET  /api/settings/kv          — list all kv_settings (axis_admin)
// GET  /api/settings/kv/:key     — get one setting by key (axis_admin)
// PUT  /api/settings/kv/:key     — upsert a setting (axis_admin)
// DELETE /api/settings/kv/:key   — remove a setting (axis_admin)
//
// Uses the kv_settings table added in migration-008.
// Values are stored as JSON-encoded strings so any scalar or object
// can be stored. Returned values are JSON-parsed on read.

let _kvStmts = null;
function kvStmts() {
  if (!_kvStmts) {
    _kvStmts = {
      list:   db.prepare('SELECT * FROM kv_settings ORDER BY key'),
      byKey:  db.prepare('SELECT * FROM kv_settings WHERE key = ?'),
      upsert: db.prepare(`
        INSERT INTO kv_settings (key, value, updated_by, updated_at)
        VALUES (@key, @value, @updated_by, @updated_at)
        ON CONFLICT(key) DO UPDATE SET
          value      = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `),
      delete: db.prepare('DELETE FROM kv_settings WHERE key = ?'),
    };
  }
  return _kvStmts;
}

function parseKvRow(row) {
  if (!row) return null;
  let parsed;
  try { parsed = JSON.parse(row.value); } catch { parsed = row.value; }
  return { key: row.key, value: parsed, updated_by: row.updated_by, updated_at: row.updated_at };
}

router.get('/kv', requireRole('axis_admin'), (_req, res) => {
  try {
    const rows = kvStmts().list.all().map(parseKvRow);
    res.json({ settings: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'kv_settings table not available — run migrations' });
  }
});

router.get('/kv/:key', requireRole('axis_admin'), (req, res) => {
  try {
    const row = kvStmts().byKey.get(req.params.key);
    if (!row) return res.status(404).json({ error: 'Setting not found' });
    res.json({ setting: parseKvRow(row) });
  } catch (err) {
    res.status(500).json({ error: 'kv_settings table not available — run migrations' });
  }
});

router.put('/kv/:key', requireRole('axis_admin'), (req, res) => {
  const { key } = req.params;
  const { value } = req.body ?? {};
  if (value === undefined) return res.status(400).json({ error: 'value is required' });
  if (!/^[a-z][a-z0-9_.-]*$/.test(key)) {
    return res.status(400).json({ error: 'key must be snake_case alphanumeric (a-z, 0-9, _, -, .)' });
  }

  try {
    kvStmts().upsert.run({
      key,
      value:      JSON.stringify(value),
      updated_by: req._user?.display_name ?? req.user?.display_name ?? null,
      updated_at: new Date().toISOString(),
    });
    const row = kvStmts().byKey.get(key);
    res.json({ setting: parseKvRow(row) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/kv/:key', requireRole('axis_admin'), (req, res) => {
  const { key } = req.params;
  try {
    const existing = kvStmts().byKey.get(key);
    if (!existing) return res.status(404).json({ error: 'Setting not found' });
    kvStmts().delete.run(key);
    res.json({ deleted: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
