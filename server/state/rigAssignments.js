'use strict';

/*
 * rigAssignments — Phase 110.
 *
 * SQLite-backed live override of the mock driver→rig assignment.
 * The mock fleet fixture uses `assigned_rig_id` on each driver record
 * deterministically. This module lets operators override that with a
 * real, persisted assignment that survives server restarts.
 *
 * Schema
 *   rig_id      TEXT PRIMARY KEY
 *   driver_id   TEXT NOT NULL
 *   notes       TEXT
 *   assigned_by TEXT              — display name of the assigning operator
 *   assigned_at TEXT              — ISO-8601 timestamp
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS rig_assignments (
    rig_id      TEXT PRIMARY KEY,
    driver_id   TEXT NOT NULL,
    notes       TEXT,
    assigned_by TEXT,
    assigned_at TEXT NOT NULL
  )
`);

const assignStmt = db.prepare(`
  INSERT INTO rig_assignments (rig_id, driver_id, notes, assigned_by, assigned_at)
  VALUES (@rig_id, @driver_id, @notes, @assigned_by, @assigned_at)
  ON CONFLICT (rig_id) DO UPDATE SET
    driver_id   = excluded.driver_id,
    notes       = excluded.notes,
    assigned_by = excluded.assigned_by,
    assigned_at = excluded.assigned_at
`);

const unassignStmt    = db.prepare(`DELETE FROM rig_assignments WHERE rig_id = ?`);
const getByRigStmt    = db.prepare(`SELECT * FROM rig_assignments WHERE rig_id = ?`);
const getByDriverStmt = db.prepare(`SELECT * FROM rig_assignments WHERE driver_id = ?`);
const getAllStmt       = db.prepare(`SELECT * FROM rig_assignments`);

module.exports = {
  /**
   * Assign a driver to a rig (upserts — overwrites any existing assignment).
   * @param {string} rigId
   * @param {string} driverId
   * @param {{ notes?: string, by_name?: string }} opts
   * @returns {object} The persisted assignment row.
   */
  assign(rigId, driverId, opts = {}) {
    const row = {
      rig_id:      rigId,
      driver_id:   driverId,
      notes:       opts.notes ?? null,
      assigned_by: opts.by_name ?? null,
      assigned_at: new Date().toISOString(),
    };
    assignStmt.run(row);
    return row;
  },

  /**
   * Remove a live assignment for a rig.
   * @param {string} rigId
   */
  unassign(rigId) {
    unassignStmt.run(rigId);
  },

  /**
   * Get the live assignment for a rig, or null if none exists.
   * @param {string} rigId
   * @returns {object|null}
   */
  getAssignment(rigId) {
    return getByRigStmt.get(rigId) ?? null;
  },

  /**
   * Get all rigs a driver is currently assigned to (normally at most 1).
   * @param {string} driverId
   * @returns {object[]}
   */
  getByDriver(driverId) {
    return getByDriverStmt.all(driverId);
  },

  /**
   * Get all live assignments as a Map keyed by rig_id.
   * @returns {Map<string, object>}
   */
  getAllAssignments() {
    const rows = getAllStmt.all();
    return new Map(rows.map((r) => [r.rig_id, r]));
  },
};
