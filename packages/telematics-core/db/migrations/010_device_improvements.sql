-- 010_device_improvements.sql
-- Schema improvements: firmware column, vehicle lookup index,
-- and unique active-device-per-vehicle constraint.

-- Firmware string stored on device row (populated by normaliser via device_heartbeats).
ALTER TABLE devices ADD COLUMN firmware TEXT;

-- Fast lookup of active device by vehicle — common on every inbound message.
CREATE INDEX IF NOT EXISTS idx_devices_vehicle
  ON devices (vehicle_id)
  WHERE vehicle_id IS NOT NULL;

-- Prevent two active devices being mapped to the same vehicle simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_vehicle_active
  ON devices (vehicle_id)
  WHERE active = 1 AND vehicle_id IS NOT NULL;
