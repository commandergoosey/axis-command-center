-- Migration 002 — LP-7
-- Webhook event store: raw payloads from Loconav and custom adapters.
-- Fresh installs already have this table (db/index.js includes it);
-- this migration creates it on existing databases that pre-date LP-7.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  hauler_id   TEXT NOT NULL,
  source      TEXT NOT NULL,
  event_type  TEXT,
  raw_json    TEXT NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_hauler ON webhook_events (hauler_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type   ON webhook_events (event_type, processed);
