-- Migration 005 — LP-14
-- Notification preferences and delivery log.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT '*',
  via_email  INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_prefs_user_type ON notification_preferences (user_id, alert_type);

CREATE TABLE IF NOT EXISTS notification_log (
  id         TEXT PRIMARY KEY,
  alert_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'email',
  sent_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_log_alert ON notification_log (alert_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_user  ON notification_log (user_id, sent_at DESC);
