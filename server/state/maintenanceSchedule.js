'use strict';

/*
 * Maintenance schedule — Phase 84.
 *
 * Forward-looking complement to workorderState. While workorders
 * are reactive (a rig is in workshop now because something broke),
 * the schedule is planned: "Rig haul-02-104 in workshop 5-7 May
 * for service B." Each scheduled window has start + end + type
 * + notes + status, and shows up on the calendar (Phase 73)
 * inside the horizon. Auto-completes when end date passes if not
 * already cancelled.
 *
 * Schema is durable in SQLite; idempotent CREATE so prod migrates
 * without touching db/index.js.
 */

const db = require('../db');

const TYPES = ['service_a', 'service_b', 'service_c', 'tyre', 'inspection', 'repair', 'other'];
const STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'];

db.exec(`
  CREATE TABLE IF NOT EXISTS maintenance_schedule (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    rig_id          TEXT NOT NULL,
    hauler_id       TEXT NOT NULL,
    type            TEXT NOT NULL,
    start_at        TEXT NOT NULL,
    end_at          TEXT NOT NULL,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'planned',
    completed_at    TEXT,
    completed_by    TEXT,
    created_at      TEXT NOT NULL,
    created_by_user_id TEXT,
    created_by_display TEXT,
    created_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_maint_sched_open
    ON maintenance_schedule (status, start_at)
    WHERE status IN ('planned', 'in_progress');
  CREATE INDEX IF NOT EXISTS idx_maint_sched_rig
    ON maintenance_schedule (rig_id, start_at DESC);
  CREATE INDEX IF NOT EXISTS idx_maint_sched_hauler
    ON maintenance_schedule (hauler_id, start_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO maintenance_schedule (
    rig_id, hauler_id, type, start_at, end_at, notes,
    created_at, created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @rig_id, @hauler_id, @type, @start_at, @end_at, @notes,
    @created_at, @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const updateStmt = db.prepare(`
  UPDATE maintenance_schedule
     SET type     = COALESCE(@type, type),
         start_at = COALESCE(@start_at, start_at),
         end_at   = COALESCE(@end_at, end_at),
         notes    = COALESCE(@notes, notes),
         status   = COALESCE(@status, status)
   WHERE id = @id
`);
const completeStmt = db.prepare(`
  UPDATE maintenance_schedule
     SET status = 'completed', completed_at = ?, completed_by = ?
   WHERE id = ? AND status IN ('planned', 'in_progress')
`);
const cancelStmt = db.prepare(`
  UPDATE maintenance_schedule
     SET status = 'cancelled'
   WHERE id = ? AND status IN ('planned', 'in_progress')
`);
const deleteStmt = db.prepare('DELETE FROM maintenance_schedule WHERE id = ?');
const byIdStmt   = db.prepare('SELECT * FROM maintenance_schedule WHERE id = ?');
const upcomingStmt = db.prepare(`
  SELECT * FROM maintenance_schedule
   WHERE status IN ('planned', 'in_progress')
   ORDER BY start_at ASC, id ASC
`);
const allStmt = db.prepare(`
  SELECT * FROM maintenance_schedule
   ORDER BY start_at DESC, id DESC
`);
const forHaulerStmt = db.prepare(`
  SELECT * FROM maintenance_schedule
   WHERE hauler_id = ?
   ORDER BY start_at DESC, id DESC
`);
const forRigStmt = db.prepare(`
  SELECT * FROM maintenance_schedule
   WHERE rig_id = ?
   ORDER BY start_at DESC, id DESC
`);
const inWindowStmt = db.prepare(`
  SELECT hauler_id, COUNT(*) AS n
    FROM maintenance_schedule
   WHERE status IN ('planned', 'in_progress')
     AND start_at <= ?
     AND end_at   >= ?
   GROUP BY hauler_id
`);

function shape(row) {
  if (!row) return null;
  return {
    id:             row.id,
    rig_id:         row.rig_id,
    hauler_id:      row.hauler_id,
    type:           row.type,
    start_at:       row.start_at,
    end_at:         row.end_at,
    notes:          row.notes,
    status:         row.status,
    completed_at:   row.completed_at,
    completed_by:   row.completed_by,
    created_at:     row.created_at,
    created_by:     row.created_by_user_id ? {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    } : null,
  };
}

function add({ rig_id, hauler_id, type, start_at, end_at, notes, by_user_id, by_display, by_role }) {
  if (!rig_id)    throw new Error('rig_id required');
  if (!hauler_id) throw new Error('hauler_id required');
  if (!TYPES.includes(type)) throw new Error(`Unknown type: ${type}`);
  if (!start_at || Number.isNaN(Date.parse(start_at))) throw new Error('start_at must be ISO date');
  if (!end_at   || Number.isNaN(Date.parse(end_at)))   throw new Error('end_at must be ISO date');
  if (new Date(end_at).getTime() < new Date(start_at).getTime()) {
    throw new Error('end_at must be on or after start_at');
  }
  const result = insertStmt.run({
    rig_id, hauler_id, type, start_at, end_at,
    notes: notes ? String(notes).slice(0, 1000) : null,
    created_at: new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function update(id, patch = {}) {
  const existing = byIdStmt.get(id);
  if (!existing) return null;
  if (patch.type    && !TYPES.includes(patch.type))       throw new Error(`Unknown type: ${patch.type}`);
  if (patch.status  && !STATUSES.includes(patch.status))  throw new Error(`Unknown status: ${patch.status}`);
  if (patch.start_at && Number.isNaN(Date.parse(patch.start_at))) throw new Error('start_at must be ISO date');
  if (patch.end_at   && Number.isNaN(Date.parse(patch.end_at)))   throw new Error('end_at must be ISO date');
  updateStmt.run({
    id,
    type:     patch.type     ?? null,
    start_at: patch.start_at ?? null,
    end_at:   patch.end_at   ?? null,
    notes:    patch.notes    ?? null,
    status:   patch.status   ?? null,
  });
  return shape(byIdStmt.get(id));
}

function complete(id, by_display) {
  completeStmt.run(new Date().toISOString(), by_display || null, id);
  return shape(byIdStmt.get(id));
}
function cancel(id)  { cancelStmt.run(id); return shape(byIdStmt.get(id)); }
function remove(id)  { deleteStmt.run(id); }
function findById(id){ return shape(byIdStmt.get(id)); }
function upcoming()  { return upcomingStmt.all().map(shape); }
function all()       { return allStmt.all().map(shape); }
function forHauler(haulerId) { return forHaulerStmt.all(haulerId).map(shape); }
function forRig(rigId)       { return forRigStmt.all(rigId).map(shape); }

// Counts of rigs in workshop on a given date — useful for the
// per-hauler workshop-capacity strip.
function countsInWindow(at = new Date().toISOString()) {
  const rows = inWindowStmt.all(at, at);
  const out = {};
  for (const r of rows) out[r.hauler_id] = r.n;
  return out;
}

module.exports = {
  TYPES, STATUSES,
  add, update, complete, cancel, remove,
  findById, upcoming, all, forHauler, forRig, countsInWindow,
};
