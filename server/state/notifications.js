'use strict';

/*
 * Notifications — Phase 59.
 *
 * Per-user notification feed. The audit log captures every write
 * platform-wide; this overlay routes the subset that affects a
 * specific user TO that user, with a read/unread state.
 *
 * Trigger sites (Phase 59):
 *   - assignment created / reassigned   → notify assignee
 *   - bulk reassign                     → notify each new assignee
 *   - comment added                     → notify assignee (if author isn't them)
 *   - snooze added on someone else's item → notify assignee
 *
 * Future trigger sites (later phases):
 *   - covenant breach              → notify axis_admin
 *   - forecast verdict transition  → notify axis_admin
 *   - overdue threshold reached    → notify assignee + admin
 *   - external webhook delivery    → fan out to Slack/email
 *
 * Schema lives here, idempotent CREATE so prod migrates without
 * touching db/index.js.
 */

const db         = require('../db');
const notifPush  = require('../services/notifPush');

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    body            TEXT NOT NULL,
    link_path       TEXT,
    link_label      TEXT,
    payload_json    TEXT,
    actor_user_id   TEXT,
    actor_display   TEXT,
    created_at      TEXT NOT NULL,
    read_at         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_notif_user_unread
    ON notifications (user_id, read_at, created_at DESC);

  -- Phase 63 — per-user notification preferences. Absence of a row
  -- means "default", which is enabled. Inserting a row with
  -- enabled=0 opts the user out for that event_type. Compound
  -- primary key so toggle is just an UPSERT.
  CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id         TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, event_type)
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO notifications (
    user_id, event_type, body, link_path, link_label, payload_json,
    actor_user_id, actor_display, created_at
  ) VALUES (
    @user_id, @event_type, @body, @link_path, @link_label, @payload_json,
    @actor_user_id, @actor_display, @created_at
  )
`);
const markReadStmt = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?');
const markAllReadStmt = db.prepare(
  'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
);
const forUserStmt = db.prepare(`
  SELECT * FROM notifications
   WHERE user_id = ?
   ORDER BY created_at DESC, id DESC
   LIMIT ?
`);
const unreadCountStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
);

function shape(row) {
  if (!row) return null;
  return {
    id:           row.id,
    event_type:   row.event_type,
    body:         row.body,
    link:         row.link_path ? { path: row.link_path, label: row.link_label || 'Open' } : null,
    payload:      row.payload_json ? JSON.parse(row.payload_json) : null,
    actor: {
      user_id:      row.actor_user_id,
      display_name: row.actor_display,
    },
    created_at:   row.created_at,
    read_at:      row.read_at,
    read:         Boolean(row.read_at),
  };
}

// Phase 63 — preferences read. Defaults to enabled when no row exists.
const prefStmt = db.prepare(
  'SELECT enabled FROM notification_prefs WHERE user_id = ? AND event_type = ?',
);
function isEnabledFor(user_id, event_type) {
  const row = prefStmt.get(user_id, event_type);
  if (!row) return true;            // no preference set → enabled (default-on)
  return row.enabled === 1;
}

// Emit a notification. Caller is expected to skip the call when the
// actor IS the recipient — we don't want to notify yourself about
// your own writes (avoids the "you commented on your own item" noise).
function emit({
  user_id, event_type, body, link, payload,
  actor_user_id, actor_display,
}) {
  if (!user_id || !event_type || !body) {
    throw new Error('user_id, event_type, body all required');
  }
  // Self-notification guard: skip when the actor is the recipient.
  // The two empty-string falsy cases are different — explicit null
  // actor (e.g. system-triggered) should still notify.
  if (actor_user_id && actor_user_id === user_id) return null;

  // Phase 63 — preference gate. User opted out of this event_type →
  // no row inserted, no badge, no surface noise.
  if (!isEnabledFor(user_id, event_type)) return null;

  const result = insertStmt.run({
    user_id,
    event_type,
    body,
    link_path:    link?.path  || null,
    link_label:   link?.label || null,
    payload_json: payload ? JSON.stringify(payload) : null,
    actor_user_id: actor_user_id || null,
    actor_display: actor_display || null,
    created_at:   new Date().toISOString(),
  });
  const newId = result.lastInsertRowid;

  // Phase 100 — SSE live push. If the recipient has an open stream,
  // send the updated feed immediately rather than waiting for their
  // next 60-second poll.
  try {
    notifPush.pushToUser(user_id, 'notification', {
      unread_count: unreadCount(user_id),
      items:        forUser(user_id, 50),
    });
  } catch { /* non-fatal — poll fallback covers any failure */ }

  return newId;
}

function forUser(user_id, limit = 50) {
  return forUserStmt.all(user_id, limit).map(shape);
}

// Phase 82 — filtered + paginated history for the Notifications
// inbox page. Supports event_type filter, unread-only filter,
// "since" date floor, "until" date ceiling, and offset for paging.
function historyForUser(user_id, {
  event_type = null,
  unread_only = false,
  since = null,
  until = null,
  limit = 50, offset = 0,
} = {}) {
  // Build WHERE dynamically — small dataset so dynamic SQL is
  // safe + readable; alternative is per-combination prepared
  // statements which is overkill.
  const where = ['user_id = @user_id'];
  const params = { user_id };
  if (event_type) {
    where.push('event_type = @event_type');
    params.event_type = event_type;
  }
  if (unread_only) {
    where.push('read_at IS NULL');
  }
  if (since) {
    where.push('created_at >= @since');
    params.since = since;
  }
  if (until) {
    where.push('created_at <= @until');
    params.until = until;
  }
  const whereClause = where.join(' AND ');
  const rows = db.prepare(`
    SELECT * FROM notifications
     WHERE ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });
  const { n: total } = db.prepare(`
    SELECT COUNT(*) AS n FROM notifications
     WHERE ${whereClause}
  `).get(params);
  // Distinct event types for the filter chip row.
  const types = db.prepare(`
    SELECT event_type, COUNT(*) AS n
      FROM notifications
     WHERE user_id = @user_id
     GROUP BY event_type
     ORDER BY n DESC
  `).all({ user_id });
  return {
    total,
    limit, offset,
    rows: rows.map(shape),
    types_summary: types,
  };
}

function unreadCount(user_id) {
  return unreadCountStmt.get(user_id)?.n ?? 0;
}

function markRead(id, user_id) {
  markReadStmt.run(new Date().toISOString(), id, user_id);
}

function markAllRead(user_id) {
  const result = markAllReadStmt.run(new Date().toISOString(), user_id);
  return result.changes;
}

// Phase 63 — preferences UPSERT and read-all-for-user helpers.
const prefUpsertStmt = db.prepare(`
  INSERT INTO notification_prefs (user_id, event_type, enabled, updated_at)
  VALUES (@user_id, @event_type, @enabled, @updated_at)
  ON CONFLICT(user_id, event_type) DO UPDATE SET
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);
const prefsForUserStmt = db.prepare(
  'SELECT event_type, enabled, updated_at FROM notification_prefs WHERE user_id = ?',
);

function setPref(user_id, event_type, enabled) {
  prefUpsertStmt.run({
    user_id, event_type,
    enabled: enabled ? 1 : 0,
    updated_at: new Date().toISOString(),
  });
}

function prefsFor(user_id) {
  const rows = prefsForUserStmt.all(user_id);
  // Map event_type → enabled. Absent = default true.
  const map = {};
  for (const r of rows) map[r.event_type] = { enabled: r.enabled === 1, updated_at: r.updated_at };
  return map;
}

module.exports = {
  emit, forUser, historyForUser, unreadCount, markRead, markAllRead,
  setPref, prefsFor, isEnabledFor,
};
