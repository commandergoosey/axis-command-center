'use strict';

/*
 * SQLite-backed persistence for triage state + audit log. Single file at
 * data/axis.db, opened once on boot. Schema is idempotent (CREATE IF NOT
 * EXISTS); no migration framework — for v1 every schema change is additive.
 *
 * Tables:
 *   alert_state   — per-alert triage overlay (status, assignee, snooze, notes JSON)
 *   filing_state  — per-filing overlay (mark-filed submissions)
 *   workorders    — maintenance workorder lifecycle per rig
 *   coaching_sessions — dispatcher coaching against axle-load patterns
 *   report_runs   — every /api/reports/generate invocation
 *   audit_log     — unified row-per-write across all entity types
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DB_PATH env var lets Railway (or any host) point the database at a mounted
// persistent volume. Example: DB_PATH=/data/axis.db with a volume at /data.
// Defaults to server/data/axis.db for local development.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'axis.db');
const DB_DIR  = path.dirname(DB_PATH);

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  /* ── Auth ──────────────────────────────────────────────────────────────
   * users    — all platform accounts; password_hash is bcrypt.
   * sessions — opaque 32-byte hex tokens, persisted so they survive restarts.
   */
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('axis_admin','axis_ops','hauler_admin','lender')),
    hauler_id     TEXT,
    organisation  TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at   TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

  /* ── Password reset tokens ──────────────────────────────────────────── */
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS alert_state (
    alert_id             TEXT PRIMARY KEY,
    status_override      TEXT,
    assignee_user_id     TEXT,
    assignee_display     TEXT,
    assignee_role        TEXT,
    snooze_until_iso     TEXT,
    resolved_at_iso      TEXT,
    resolved_by_display  TEXT,
    resolution_note      TEXT,
    notes_json           TEXT NOT NULL DEFAULT '[]',
    updated_at           TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS filing_state (
    filing_id       TEXT PRIMARY KEY,
    status          TEXT NOT NULL,
    submitted_at    TEXT,
    submitted_by    TEXT,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workorders (
    id                   TEXT PRIMARY KEY,
    rig_id               TEXT NOT NULL,
    hauler_id            TEXT,
    title                TEXT NOT NULL,
    opened_at            TEXT NOT NULL,
    opened_by_user_id    TEXT,
    opened_by_display    TEXT,
    status               TEXT NOT NULL,             -- OPEN | IN_PROGRESS | RESOLVED
    progress_note        TEXT,
    progress_at          TEXT,
    progress_by_display  TEXT,
    resolution_note      TEXT,
    resolved_at          TEXT,
    resolved_by_display  TEXT,
    cost_usd             REAL,
    hours                REAL,
    updated_at           TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workorders_rig    ON workorders (rig_id, opened_at DESC);
  CREATE INDEX IF NOT EXISTS idx_workorders_status ON workorders (status, opened_at DESC);

  CREATE TABLE IF NOT EXISTS coaching_sessions (
    id                    TEXT PRIMARY KEY,
    hauler_id             TEXT NOT NULL,
    held_at               TEXT NOT NULL,
    topic                 TEXT NOT NULL,         -- free-text (e.g. 'Pre-departure axle verification')
    dispatcher_name       TEXT,
    attendees_count       INTEGER,
    expected_delta_pct    REAL,                  -- expected hold-rate drop over next 7d, e.g. -40.0
    notes                 TEXT,
    linked_alert_ids_json TEXT NOT NULL DEFAULT '[]',
    created_by_user_id    TEXT,
    created_by_display    TEXT,
    created_at            TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coaching_hauler ON coaching_sessions (hauler_id, held_at DESC);
  CREATE INDEX IF NOT EXISTS idx_coaching_held   ON coaching_sessions (held_at DESC);

  CREATE TABLE IF NOT EXISTS report_runs (
    id              TEXT PRIMARY KEY,
    type_id         TEXT NOT NULL,
    title           TEXT NOT NULL,
    period_label    TEXT,
    period_from     TEXT,
    period_to       TEXT,
    status          TEXT NOT NULL,
    generated_at    TEXT NOT NULL,
    generated_by    TEXT,
    recipients_json TEXT NOT NULL DEFAULT '[]',
    size_kb         INTEGER,
    pages           INTEGER,
    filename        TEXT
  );

  CREATE TABLE IF NOT EXISTS report_schedules (
    id              TEXT PRIMARY KEY,
    type_id         TEXT NOT NULL,
    title           TEXT NOT NULL,
    label_template  TEXT,
    frequency       TEXT NOT NULL,
    day_of_week     INTEGER,
    day_of_month    INTEGER,
    hour            INTEGER NOT NULL DEFAULT 8,
    recipients_json TEXT NOT NULL DEFAULT '[]',
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    last_run_at     TEXT,
    next_run_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT NOT NULL,
    actor_user_id   TEXT,
    actor_email     TEXT,
    actor_display   TEXT,
    actor_role      TEXT,
    actor_org       TEXT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    action          TEXT NOT NULL,
    summary         TEXT,
    payload_json    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_ts          ON audit_log (ts DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_entity_type ON audit_log (entity_type, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_entity_id   ON audit_log (entity_type, entity_id, ts DESC);
`);

module.exports = db;
