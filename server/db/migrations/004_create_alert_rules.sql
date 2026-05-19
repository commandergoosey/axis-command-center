-- Migration 004 — LP-13
-- Alert rules engine schema.

CREATE TABLE IF NOT EXISTS alert_rules (
  id           TEXT PRIMARY KEY,
  hauler_id    TEXT,
  rule_type    TEXT NOT NULL,
  threshold    REAL NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'warning',
  enabled      INTEGER NOT NULL DEFAULT 1,
  label        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_hauler ON alert_rules (hauler_id, enabled);
CREATE INDEX IF NOT EXISTS idx_alert_rules_type   ON alert_rules (rule_type, enabled);
