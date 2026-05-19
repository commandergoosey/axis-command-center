-- LP-34: estimated fuel burn and trip cost columns.
ALTER TABLE trips ADD COLUMN estimated_fuel_l    REAL;
ALTER TABLE trips ADD COLUMN estimated_cost_usd  REAL;

-- LP-45: convoy linkage on DB trips.
ALTER TABLE trips ADD COLUMN convoy_id TEXT;

-- LP-36: per-hauler API token for integration auth.
ALTER TABLE haulers ADD COLUMN api_token TEXT;

-- LP-43: mark notifications as read (NULL = unread).
ALTER TABLE notification_log ADD COLUMN read_at TEXT;

-- LP-41: corridor KPI benchmark targets (one row per metric key).
CREATE TABLE IF NOT EXISTS corridor_benchmarks (
  key          TEXT PRIMARY KEY,  -- e.g. 'cycle_time_max_h', 'on_time_rate_min'
  value        REAL NOT NULL,
  unit         TEXT,
  label        TEXT,
  updated_at   TEXT NOT NULL
);

-- LP-48: generic key-value settings for operator configuration.
CREATE TABLE IF NOT EXISTS kv_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,       -- JSON-encoded
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
