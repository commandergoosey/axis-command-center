-- Migration 003 — LP-11
-- Trip lifecycle store and latest vehicle position table.
-- Fresh installs already have these tables (db/index.js includes them).

CREATE TABLE IF NOT EXISTS trips (
  id              TEXT PRIMARY KEY,
  hauler_id       TEXT NOT NULL,
  vehicle_id      TEXT,
  driver_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'in_progress',
  direction       TEXT DEFAULT 'laden',
  origin          TEXT,
  destination     TEXT,
  route_id        TEXT,
  departed_at     TEXT,
  arrived_at      TEXT,
  duration_min    INTEGER,
  distance_km     REAL,
  tonnage_t       REAL,
  axle_load_pct   REAL,
  source          TEXT NOT NULL DEFAULT 'webhook',
  raw_event_id    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trips_hauler  ON trips (hauler_id, departed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips (vehicle_id, departed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_status  ON trips (status, departed_at DESC);

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
