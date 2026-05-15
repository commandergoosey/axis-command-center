'use strict';

/*
 * driverStatus — Phase 103.
 *
 * Availability + compliance overlay for the mock driver roster.  Mock data in
 * server/mock/drivers.js gives every driver deterministic rest_status and flag
 * values.  This module records operator-driven overrides as SQLite rows merged
 * on top of the mock record at read time — same pattern as fleetStatus (102).
 *
 * Covered fields:
 *   availability  — available | on_leave | sick | suspended
 *   rest_status   — compliant | warning | breach
 *   flag          — null | rest_breach | psv_expiring | licence_expiring | coaching_due
 *   notes         — free-form context
 *
 * PRIMARY KEY on driver_id → one override row per driver; each PATCH is an
 * UPSERT replacing the previous entry.
 *
 * When no override exists, `availability` is derived from the mock shift:
 *   shift === 'rest' → 'on_leave'   (scheduled rest day)
 *   otherwise        → 'available'
 *
 * Role gate (enforced in the route, not here):
 *   axis_admin / axis_ops — any driver
 *   hauler_admin          — own hauler's drivers only
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS driver_status_overrides (
    driver_id        TEXT PRIMARY KEY,
    availability     TEXT NOT NULL,
    rest_status      TEXT NOT NULL,
    flag             TEXT,
    notes            TEXT,
    updated_by_id    TEXT NOT NULL,
    updated_by_name  TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
`);

const VALID_AVAILABILITY = ['available', 'on_leave', 'sick', 'suspended'];
const VALID_REST         = ['compliant', 'warning', 'breach'];
const VALID_FLAGS        = [null, 'rest_breach', 'psv_expiring', 'licence_expiring', 'coaching_due'];

const upsertStmt = db.prepare(`
  INSERT INTO driver_status_overrides
    (driver_id, availability, rest_status, flag, notes, updated_by_id, updated_by_name, updated_at)
  VALUES
    (@driver_id, @availability, @rest_status, @flag, @notes, @updated_by_id, @updated_by_name, @updated_at)
  ON CONFLICT(driver_id) DO UPDATE SET
    availability     = excluded.availability,
    rest_status      = excluded.rest_status,
    flag             = excluded.flag,
    notes            = excluded.notes,
    updated_by_id    = excluded.updated_by_id,
    updated_by_name  = excluded.updated_by_name,
    updated_at       = excluded.updated_at
`);

const allStmt = db.prepare('SELECT * FROM driver_status_overrides');
const oneStmt = db.prepare('SELECT * FROM driver_status_overrides WHERE driver_id = ?');

/**
 * Return the default availability for a driver when no override exists.
 * Derived from mock shift field.
 */
function defaultAvailability(driver) {
  return driver.shift === 'rest' ? 'on_leave' : 'available';
}

/**
 * Record a status change for a driver. Validates inputs.
 * Returns the saved override row.
 */
function setStatus({ driver_id, availability, rest_status, flag, notes, updated_by_id, updated_by_name }) {
  if (!driver_id)                              throw new Error('driver_id required');
  if (!VALID_AVAILABILITY.includes(availability))
    throw new Error(`availability must be one of: ${VALID_AVAILABILITY.join(', ')}`);
  if (!VALID_REST.includes(rest_status))
    throw new Error(`rest_status must be one of: ${VALID_REST.join(', ')}`);
  const f = flag === '' ? null : (flag ?? null);
  if (!VALID_FLAGS.includes(f))
    throw new Error(`flag must be one of: ${VALID_FLAGS.filter(Boolean).join(', ')} or null`);

  upsertStmt.run({
    driver_id,
    availability,
    rest_status,
    flag:             f,
    notes:            notes?.trim() || null,
    updated_by_id,
    updated_by_name,
    updated_at:       new Date().toISOString(),
  });

  return oneStmt.get(driver_id);
}

/**
 * Return all overrides as a Map<driverId, overrideRow> for efficient bulk merge.
 */
function getAllOverrides() {
  const rows = allStmt.all();
  const m = new Map();
  for (const r of rows) m.set(r.driver_id, r);
  return m;
}

/**
 * Return the single override for a driver, or null.
 */
function getOverride(driver_id) {
  return oneStmt.get(driver_id) ?? null;
}

/**
 * Merge an override row onto a mock driver record.
 * Always adds `availability` — either from the override or derived from shift.
 * Returns a new object; does not mutate either argument.
 */
function applyOverride(driver, override) {
  if (!override) {
    return { ...driver, availability: defaultAvailability(driver) };
  }
  return {
    ...driver,
    availability: override.availability,
    rest_status:  override.rest_status,
    flag:         override.flag,
    _status_override: {
      notes:           override.notes,
      updated_by_name: override.updated_by_name,
      updated_at:      override.updated_at,
    },
  };
}

module.exports = {
  setStatus,
  getAllOverrides,
  getOverride,
  applyOverride,
  VALID_AVAILABILITY,
  VALID_REST,
  VALID_FLAGS,
};
