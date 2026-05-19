'use strict';

/*
 * SQLite-backed persistence for triage state + audit log. Single file at
 * data/axis.db, opened once on boot. Schema is idempotent (CREATE IF NOT
 * EXISTS); additive schema changes for existing databases run via the
 * migration runner in db/migrate.js.
 *
 * Tables:
 *   users / sessions / password_reset_tokens — auth
 *   fleet_trucks / fleet_drivers             — fleet management
 *   haulers                                  — hauler registry
 *   webhook_events                           — LP-7 inbound telematics push events
 *   alert_state   — per-alert triage overlay (status, assignee, snooze, notes JSON)
 *   filing_state  — per-filing overlay (mark-filed submissions)
 *   workorders    — maintenance workorder lifecycle per rig
 *   coaching_sessions — dispatcher coaching against axle-load patterns
 *   report_runs   — every /api/reports/generate invocation
 *   audit_log     — unified row-per-write across all entity types
 *   schema_migrations — migration tracking (db/migrate.js)
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

  /* ── Fleet ──────────────────────────────────────────────────────────────
   * fleet_trucks  — one row per vehicle. Seeded from mock/fleet.js on first boot.
   * fleet_drivers — one row per driver.  Seeded from mock/drivers.js on first boot.
   * archived = 1 means soft-deleted; it is excluded from all normal reads.
   */
  CREATE TABLE IF NOT EXISTS fleet_trucks (
    id                      TEXT PRIMARY KEY,
    plate                   TEXT NOT NULL,
    hauler_id               TEXT NOT NULL,
    hauler_display          TEXT,
    make                    TEXT,
    model                   TEXT,
    axle_config             TEXT DEFAULT '6x4',
    year_of_manufacture     INTEGER,
    empty_weight_t          REAL,
    gross_weight_t          REAL DEFAULT 40,
    payload_capacity_t      REAL,
    status                  TEXT NOT NULL DEFAULT 'idle',
    total_km                INTEGER DEFAULT 0,
    last_service_km         INTEGER DEFAULT 0,
    next_service_km_due     INTEGER DEFAULT 0,
    efficiency_l_per_100km  REAL DEFAULT 38.0,
    trips_this_week         INTEGER DEFAULT 0,
    maintenance_flag        TEXT,
    road_worthy_expiry_days INTEGER DEFAULT 365,
    last_position_ping_iso  TEXT,
    archived                INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_fleet_trucks_hauler ON fleet_trucks (hauler_id, archived);
  CREATE INDEX IF NOT EXISTS idx_fleet_trucks_status ON fleet_trucks (status, archived);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_trucks_plate ON fleet_trucks (plate) WHERE archived = 0;

  CREATE TABLE IF NOT EXISTS fleet_drivers (
    id                   TEXT PRIMARY KEY,
    hauler_id            TEXT NOT NULL,
    hauler_display       TEXT,
    full_name            TEXT NOT NULL,
    licence_number       TEXT,
    licence_class        TEXT DEFAULT 'E',
    licence_expiry_iso   TEXT,
    psv_expiry_days      INTEGER DEFAULT 365,
    phone                TEXT,
    years_experience     INTEGER DEFAULT 0,
    assigned_rig_id      TEXT,
    assigned_plate       TEXT,
    shift                TEXT DEFAULT 'day',
    hours_this_week      REAL DEFAULT 0,
    rest_status          TEXT DEFAULT 'compliant',
    trips_this_week      INTEGER DEFAULT 0,
    safety_score         INTEGER DEFAULT 80,
    harsh_events_7d      INTEGER DEFAULT 0,
    flag                 TEXT,
    archived             INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_fleet_drivers_hauler  ON fleet_drivers (hauler_id, archived);
  CREATE INDEX IF NOT EXISTS idx_fleet_drivers_rig     ON fleet_drivers (assigned_rig_id) WHERE assigned_rig_id IS NOT NULL;

  /* ── Haulers ────────────────────────────────────────────────────────────────
   * Single source of truth for every onboarded hauler. Seeded from
   * mock/haulers.js on first boot (same pattern as fleet_trucks / fleet_drivers).
   * Supersedes hauler_records + hauler_field_overrides from Phases 109/128.
   * deactivated = 1 means the hauler is suspended; excluded from normal reads.
   */
  CREATE TABLE IF NOT EXISTS haulers (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    onboarded_date      TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    integration_type    TEXT NOT NULL DEFAULT 'manual',
    integration_adapter TEXT,
    last_sync           TEXT,
    error_count_24h     INTEGER,
    contracted_trucks   INTEGER NOT NULL DEFAULT 0,
    active_trucks       INTEGER NOT NULL DEFAULT 0,
    on_time_pct         REAL DEFAULT 0,
    sla_attainment_pct  REAL DEFAULT 0,
    safety_score        INTEGER DEFAULT 0,
    run_rate            REAL DEFAULT 0,
    contact_name        TEXT,
    contact_email       TEXT,
    contract_share_pct  REAL,
    planned_start_date  TEXT,
    activated_at        TEXT,
    deactivated         INTEGER NOT NULL DEFAULT 0,
    deactivated_at      TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_haulers_status      ON haulers (status, deactivated);
  CREATE INDEX IF NOT EXISTS idx_haulers_deactivated ON haulers (deactivated);

  /* ── Webhook events — LP-7 ──────────────────────────────────────────────────
   * Raw inbound push events from telematics integrations (Loconav, custom, etc.).
   * processed = 0 until a downstream job normalises the event into trips/positions.
   */
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

  /* ── Trips — LP-11 ──────────────────────────────────────────────────────────
   * One row per trip leg. Populated by the event processor (webhook_events →
   * trip lifecycle) and by the Loconav polling adapter.
   */
  CREATE TABLE IF NOT EXISTS trips (
    id              TEXT PRIMARY KEY,
    hauler_id       TEXT NOT NULL,
    vehicle_id      TEXT,
    driver_id       TEXT,
    status          TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | cancelled
    direction       TEXT DEFAULT 'laden',                 -- laden | empty
    origin          TEXT,
    destination     TEXT,
    route_id        TEXT,
    departed_at     TEXT,
    arrived_at      TEXT,
    duration_min    INTEGER,
    distance_km     REAL,
    tonnage_t       REAL,
    axle_load_pct   REAL,
    source          TEXT NOT NULL DEFAULT 'webhook',      -- webhook | loconav | csv | manual
    raw_event_id    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trips_hauler  ON trips (hauler_id, departed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips (vehicle_id, departed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trips_status  ON trips (status, departed_at DESC);

  /* ── Vehicle positions — LP-11 ──────────────────────────────────────────────
   * Latest known position for each vehicle (upserted on every position event).
   */
  CREATE TABLE IF NOT EXISTS vehicle_positions (
    vehicle_id   TEXT PRIMARY KEY,
    hauler_id    TEXT NOT NULL,
    latitude     REAL,
    longitude    REAL,
    speed_kmh    REAL,
    heading_deg  REAL,
    position_at  TEXT,
    updated_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_positions_hauler ON vehicle_positions (hauler_id);

  /* ── Alert rules — LP-13 ────────────────────────────────────────────────────
   * Configurable thresholds evaluated against incoming events.
   * hauler_id = NULL means the rule applies to all haulers.
   */
  CREATE TABLE IF NOT EXISTS alert_rules (
    id           TEXT PRIMARY KEY,
    hauler_id    TEXT,
    rule_type    TEXT NOT NULL,   -- speed | axle_overload | hours_driving | geofence
    threshold    REAL NOT NULL,
    severity     TEXT NOT NULL DEFAULT 'warning',  -- info | warning | critical
    enabled      INTEGER NOT NULL DEFAULT 1,
    label        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_alert_rules_hauler ON alert_rules (hauler_id, enabled);
  CREATE INDEX IF NOT EXISTS idx_alert_rules_type   ON alert_rules (rule_type, enabled);

  /* ── Notification preferences — LP-14 ──────────────────────────────────────
   * Per-user opt-in to email alerts for specific rule types.
   * alert_type = '*' means subscribe to all types.
   */
  CREATE TABLE IF NOT EXISTS notification_preferences (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL DEFAULT '*',
    via_email  INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_prefs_user_type ON notification_preferences (user_id, alert_type);

  /* ── Notification log — LP-14 ───────────────────────────────────────────────
   * Record of every delivered notification (dedup + audit).
   */
  CREATE TABLE IF NOT EXISTS notification_log (
    id         TEXT PRIMARY KEY,
    alert_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    channel    TEXT NOT NULL DEFAULT 'email',
    sent_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notif_log_alert ON notification_log (alert_id);
  CREATE INDEX IF NOT EXISTS idx_notif_log_user  ON notification_log (user_id, sent_at DESC);

  /* ── Hauler daily metrics — LP-15 ───────────────────────────────────────────
   * Pre-computed per-hauler metrics for a given calendar date.
   * Populated nightly by the metrics aggregator.
   */
  CREATE TABLE IF NOT EXISTS hauler_daily_metrics (
    hauler_id       TEXT NOT NULL,
    date            TEXT NOT NULL,   -- YYYY-MM-DD
    trips_total     INTEGER NOT NULL DEFAULT 0,
    trips_laden     INTEGER NOT NULL DEFAULT 0,
    trips_empty     INTEGER NOT NULL DEFAULT 0,
    tonnes_total    REAL    NOT NULL DEFAULT 0,
    distance_km     REAL    NOT NULL DEFAULT 0,
    on_time_count   INTEGER NOT NULL DEFAULT 0,
    late_count      INTEGER NOT NULL DEFAULT 0,
    computed_at     TEXT NOT NULL,
    PRIMARY KEY (hauler_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON hauler_daily_metrics (date DESC);

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
