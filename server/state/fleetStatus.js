'use strict';

/*
 * fleetStatus — Phase 102.
 *
 * Status overlay for the mock fleet. The mock data in server/mock/fleet.js
 * gives every truck a deterministic status from generation time. This module
 * records operator-driven status changes as SQLite overrides, which are
 * merged on top of the mock record at read time.
 *
 * Covered fields:
 *   status           — active | idle | garage | in_transit
 *   maintenance_flag — null | service_due | road_worthy_30d | critical
 *   notes            — free-form context for the change
 *
 * The PRIMARY KEY on rig_id means only one override row per truck;
 * each PATCH is an UPSERT that replaces the previous entry.
 *
 * Role gate (enforced in the route, not here):
 *   axis_admin / axis_ops — any truck
 *   hauler_admin          — own hauler's trucks only
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS fleet_status_overrides (
    rig_id           TEXT PRIMARY KEY,
    status           TEXT NOT NULL,
    maintenance_flag TEXT,
    notes            TEXT,
    updated_by_id    TEXT NOT NULL,
    updated_by_name  TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
`);

const VALID_STATUSES = ['active', 'in_transit', 'idle', 'garage'];
const VALID_FLAGS    = [null, 'service_due', 'road_worthy_30d', 'critical'];

const upsertStmt = db.prepare(`
  INSERT INTO fleet_status_overrides
    (rig_id, status, maintenance_flag, notes, updated_by_id, updated_by_name, updated_at)
  VALUES
    (@rig_id, @status, @maintenance_flag, @notes, @updated_by_id, @updated_by_name, @updated_at)
  ON CONFLICT(rig_id) DO UPDATE SET
    status           = excluded.status,
    maintenance_flag = excluded.maintenance_flag,
    notes            = excluded.notes,
    updated_by_id    = excluded.updated_by_id,
    updated_by_name  = excluded.updated_by_name,
    updated_at       = excluded.updated_at
`);

const allStmt = db.prepare('SELECT * FROM fleet_status_overrides');
const oneStmt = db.prepare('SELECT * FROM fleet_status_overrides WHERE rig_id = ?');

/**
 * Record a status change for a truck. Validates inputs.
 * Returns the saved override row.
 */
function setStatus({ rig_id, status, maintenance_flag, notes, updated_by_id, updated_by_name }) {
  if (!rig_id)                              throw new Error('rig_id required');
  if (!VALID_STATUSES.includes(status))     throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  const flag = maintenance_flag === '' ? null : (maintenance_flag ?? null);
  if (!VALID_FLAGS.includes(flag))          throw new Error(`maintenance_flag must be one of: ${VALID_FLAGS.filter(Boolean).join(', ')} or null`);

  upsertStmt.run({
    rig_id,
    status,
    maintenance_flag: flag,
    notes:            notes?.trim() || null,
    updated_by_id,
    updated_by_name,
    updated_at:       new Date().toISOString(),
  });

  return oneStmt.get(rig_id);
}

/**
 * Return all overrides as a Map<rigId, overrideRow> for efficient bulk merge.
 */
function getAllOverrides() {
  const rows = allStmt.all();
  const m = new Map();
  for (const r of rows) m.set(r.rig_id, r);
  return m;
}

/**
 * Return the single override for a rig, or null.
 */
function getOverride(rig_id) {
  return oneStmt.get(rig_id) ?? null;
}

/**
 * Merge an override row onto a mock truck record.
 * Returns a new object; does not mutate either argument.
 */
function applyOverride(truck, override) {
  if (!override) return truck;
  return {
    ...truck,
    status:           override.status,
    maintenance_flag: override.maintenance_flag,
    _status_override: {
      notes:            override.notes,
      updated_by_name:  override.updated_by_name,
      updated_at:       override.updated_at,
    },
  };
}

module.exports = { setStatus, getAllOverrides, getOverride, applyOverride };
