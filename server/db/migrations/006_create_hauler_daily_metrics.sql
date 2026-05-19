-- Migration 006 — LP-15
-- Pre-computed per-hauler daily metrics (nightly aggregation).

CREATE TABLE IF NOT EXISTS hauler_daily_metrics (
  hauler_id       TEXT NOT NULL,
  date            TEXT NOT NULL,
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
