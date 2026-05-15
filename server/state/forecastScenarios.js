'use strict';

/*
 * Forecast scenarios library — Phase 71.
 *
 * Phase 47 introduced the scenario engine — `buildForecastScenario`
 * applies operator-controlled levers (truck lifts, workorder
 * resolves, daily pace lift) to the baseline forecast and returns
 * a what-if projection. Each call is one-shot; nothing is saved.
 *
 * This module makes scenarios durable. An operator who has framed
 * a useful scenario — say, "Hauler 05 doesn't ramp until June" or
 * "stress: 25% pace cut" — can save it under a name. The library
 * is then re-evaluated on every read against current corridor
 * state, so a saved scenario always reflects the latest truths
 * (current idle truck counts, current workorder list, current
 * daily average) with the operator's overrides re-applied on top.
 *
 * Useful for: board prep ("base case / downside / stress test"),
 * lender briefing ("here's our published downside scenario"),
 * operator continuity ("the named scenarios survive the shift").
 *
 * Schema is durable in SQLite; idempotent CREATE so prod migrates
 * without touching db/index.js.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS forecast_scenarios (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT,
    params_json     TEXT NOT NULL,
    archived_at     TEXT,
    created_at      TEXT NOT NULL,
    created_by_user_id TEXT,
    created_by_display TEXT,
    created_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_forecast_scenarios_active
    ON forecast_scenarios (archived_at, created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO forecast_scenarios (
    name, description, params_json, created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @name, @description, @params_json, @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const byIdStmt   = db.prepare('SELECT * FROM forecast_scenarios WHERE id = ?');
const activeStmt = db.prepare(`
  SELECT * FROM forecast_scenarios
   WHERE archived_at IS NULL
   ORDER BY created_at ASC, id ASC
`);
const archiveStmt   = db.prepare('UPDATE forecast_scenarios SET archived_at = ? WHERE id = ?');
const unarchiveStmt = db.prepare('UPDATE forecast_scenarios SET archived_at = NULL WHERE id = ?');
const deleteStmt    = db.prepare('DELETE FROM forecast_scenarios WHERE id = ?');
const updateStmt    = db.prepare(`
  UPDATE forecast_scenarios
     SET name        = COALESCE(@name, name),
         description = COALESCE(@description, description),
         params_json = COALESCE(@params_json, params_json)
   WHERE id = @id
`);

function shape(row) {
  if (!row) return null;
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    params:      JSON.parse(row.params_json || '{}'),
    archived_at: row.archived_at,
    created_at:  row.created_at,
    author: {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    },
  };
}

function add({ name, description, params, by_user_id, by_display, by_role }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new Error('Scenario name required');
  if (trimmedName.length > 80) throw new Error('Scenario name too long (max 80 chars)');
  const trimmedDesc = description ? description.trim().slice(0, 400) : null;
  if (!params || typeof params !== 'object') throw new Error('Scenario params required');
  // Light validation — let the engine clamp specifics on every read.
  const allowed = ['hauler_truck_lifts', 'resolve_workorders', 'daily_avg_lift_pct'];
  const cleaned = {};
  for (const k of allowed) {
    if (params[k] !== undefined) cleaned[k] = params[k];
  }
  const result = insertStmt.run({
    name:        trimmedName,
    description: trimmedDesc || null,
    params_json: JSON.stringify(cleaned),
    created_at:  new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function update(id, patch = {}) {
  const existing = byIdStmt.get(id);
  if (!existing) return null;
  const params = patch.params !== undefined ? JSON.stringify(patch.params) : null;
  updateStmt.run({
    id,
    name:        patch.name        !== undefined ? patch.name : null,
    description: patch.description !== undefined ? patch.description : null,
    params_json: params,
  });
  return shape(byIdStmt.get(id));
}

function archive(id, ts = new Date().toISOString())   { archiveStmt.run(ts, id); }
function unarchive(id)                                { unarchiveStmt.run(id); }
function remove(id)                                   { deleteStmt.run(id); }
function findById(id)                                 { return shape(byIdStmt.get(id)); }
function listActive()                                 { return activeStmt.all().map(shape); }

module.exports = {
  add, update, archive, unarchive, remove, findById, listActive,
};
