-- LP-24: corridor health score history.
-- One row per calendar date; scored 0–100 from real operational data.
-- Replaces the seeded mock values in the corridor snapshot once scores
-- have been computed.

CREATE TABLE IF NOT EXISTS corridor_health (
  date          TEXT PRIMARY KEY,   -- YYYY-MM-DD UTC
  score         INTEGER NOT NULL,   -- 0–100
  on_time_rate  REAL,               -- 0–1 (component)
  alert_load    REAL,               -- 0–1 (inverted; 0 = many alerts)
  pos_freshness REAL,               -- 0–1 (fraction of vehicles with fresh position)
  components    TEXT,               -- JSON blob of raw inputs for debugging
  computed_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_corridor_health_date ON corridor_health (date DESC);
