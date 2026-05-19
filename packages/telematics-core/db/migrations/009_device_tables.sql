-- 009_device_tables.sql
-- @axis/telematics-core — device management tables.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

-- Physical GPS/telematics devices — one row per IMEI.
CREATE TABLE IF NOT EXISTS devices (
  imei               TEXT PRIMARY KEY,
  serial             TEXT,
  model              TEXT,
  hauler_id          TEXT,
  vehicle_id         TEXT,
  sim_iccid          TEXT,
  mqtt_password_hash TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  provisioned_at     TEXT    NOT NULL,
  notes              TEXT
);

-- Latest heartbeat snapshot per device — one row per IMEI, upserted on every message.
CREATE TABLE IF NOT EXISTS device_heartbeats (
  imei         TEXT PRIMARY KEY,
  signal       INTEGER,
  battery_mv   INTEGER,
  firmware     TEXT,
  last_seen_at TEXT
);

-- Rolling fuel level readings — ring-buffer (oldest rows trimmed per vehicle).
CREATE TABLE IF NOT EXISTS fuel_readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  imei        TEXT    NOT NULL,
  vehicle_id  TEXT,
  hauler_id   TEXT,
  fuel_mm     INTEGER,
  fuel_litres REAL,
  recorded_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fuel_readings_vehicle
  ON fuel_readings (vehicle_id, recorded_at DESC);

-- Server-side calibration curves — one or more (mm, litres) pairs per vehicle.
-- Linear interpolation is used between adjacent points.
CREATE TABLE IF NOT EXISTS fuel_calibrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id TEXT    NOT NULL,
  mm         INTEGER NOT NULL,
  litres     REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fuel_calibrations_vehicle
  ON fuel_calibrations (vehicle_id, mm);

-- Diagnostic event log — raw device events for debugging and audit.
CREATE TABLE IF NOT EXISTS device_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  imei         TEXT    NOT NULL,
  event_type   TEXT    NOT NULL,
  payload_json TEXT,
  recorded_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_events_imei
  ON device_events (imei, recorded_at DESC);
