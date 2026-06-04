-- LP-51: Add context columns to alert_state so alerts are self-contained.
-- alertEngine now stores severity, rule_id, vehicle_id, and hauler_id on
-- INSERT so the health scorer and alert list don't require a JOIN to
-- alert_rules to filter by severity or scope to a hauler.
ALTER TABLE alert_state ADD COLUMN severity   TEXT NOT NULL DEFAULT 'warning';
ALTER TABLE alert_state ADD COLUMN rule_id    TEXT;
ALTER TABLE alert_state ADD COLUMN vehicle_id TEXT;
ALTER TABLE alert_state ADD COLUMN hauler_id  TEXT;
