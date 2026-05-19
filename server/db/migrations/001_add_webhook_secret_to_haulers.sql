-- Migration 001 — LP-7
-- Add webhook_secret column to haulers for per-hauler HMAC signing.
-- Fresh installs already have this column (db/index.js CREATE TABLE includes it);
-- this migration runs the ALTER TABLE for existing databases.
ALTER TABLE haulers ADD COLUMN webhook_secret TEXT;
