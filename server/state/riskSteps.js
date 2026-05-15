'use strict';

/*
 * Risk mitigation steps — Phase 74.
 *
 * Phase 72 introduced the risk register with a free-text
 * mitigation_plan field. That captures narrative ("daily check-in
 * with Hauler 05 manager; backup plan if they stall past 2 May")
 * but doesn't capture *progress*. Operators couldn't answer "how
 * far along is the plan?" without re-reading the prose.
 *
 * This module attaches a checklist of structured steps to each
 * risk. Each step is a discrete unit of work — title, owner,
 * due_date, status. The risk page renders a "3 of 5 done" progress
 * signal; the calendar surfaces open steps with due dates; the
 * lender pack reports step counts per risk so credit committee
 * sees not just "we're tracking the risk" but "we're executing
 * the plan."
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

const STATUSES = ['open', 'done'];

db.exec(`
  CREATE TABLE IF NOT EXISTS risk_steps (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    risk_id             INTEGER NOT NULL,
    title               TEXT NOT NULL,
    owner_user_id       TEXT,
    owner_display       TEXT,
    due_date            TEXT,
    status              TEXT NOT NULL DEFAULT 'open',
    completed_at        TEXT,
    completed_by        TEXT,
    created_at          TEXT NOT NULL,
    created_by_user_id  TEXT,
    created_by_display  TEXT,
    created_by_role     TEXT,
    FOREIGN KEY (risk_id) REFERENCES risk_register(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_risk_steps_risk
    ON risk_steps (risk_id, status, due_date);
  CREATE INDEX IF NOT EXISTS idx_risk_steps_open_due
    ON risk_steps (status, due_date)
    WHERE status = 'open' AND due_date IS NOT NULL;
`);

const insertStmt = db.prepare(`
  INSERT INTO risk_steps (
    risk_id, title, owner_user_id, owner_display,
    due_date, status, created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @risk_id, @title, @owner_user_id, @owner_display,
    @due_date, @status, @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const updateStmt = db.prepare(`
  UPDATE risk_steps
     SET title         = COALESCE(@title, title),
         owner_user_id = COALESCE(@owner_user_id, owner_user_id),
         owner_display = COALESCE(@owner_display, owner_display),
         due_date      = CASE WHEN @clear_due = 1 THEN NULL ELSE COALESCE(@due_date, due_date) END,
         status        = COALESCE(@status, status)
   WHERE id = @id
`);
const completeStmt = db.prepare(`
  UPDATE risk_steps
     SET status = 'done', completed_at = ?, completed_by = ?
   WHERE id = ? AND status != 'done'
`);
const reopenStmt = db.prepare(`
  UPDATE risk_steps
     SET status = 'open', completed_at = NULL, completed_by = NULL
   WHERE id = ?
`);
const deleteStmt = db.prepare('DELETE FROM risk_steps WHERE id = ?');
const byIdStmt   = db.prepare('SELECT * FROM risk_steps WHERE id = ?');
const forRiskStmt = db.prepare(`
  SELECT * FROM risk_steps
   WHERE risk_id = ?
   ORDER BY
     CASE status WHEN 'open' THEN 0 ELSE 1 END,
     CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
     due_date ASC,
     created_at ASC
`);
const allOpenWithDueStmt = db.prepare(`
  SELECT * FROM risk_steps
   WHERE status = 'open' AND due_date IS NOT NULL
`);
const countsByRiskStmt = db.prepare(`
  SELECT
    risk_id,
    COUNT(*) FILTER (WHERE status = 'done') AS done_count,
    COUNT(*) AS total_count
  FROM risk_steps
  GROUP BY risk_id
`);

function shape(row) {
  if (!row) return null;
  return {
    id:           row.id,
    risk_id:      row.risk_id,
    title:        row.title,
    owner: row.owner_user_id ? {
      user_id:      row.owner_user_id,
      display_name: row.owner_display,
    } : null,
    due_date:     row.due_date,
    status:       row.status,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    created_at:   row.created_at,
    created_by:   row.created_by_user_id ? {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    } : null,
  };
}

function add({
  risk_id, title,
  owner_user_id, owner_display,
  due_date,
  by_user_id, by_display, by_role,
}) {
  const t = (title || '').trim();
  if (!t) throw new Error('Step title required');
  if (t.length > 200) throw new Error('Step title too long (max 200 chars)');
  if (due_date && Number.isNaN(Date.parse(due_date))) {
    throw new Error('due_date must be ISO date');
  }
  const result = insertStmt.run({
    risk_id,
    title:           t,
    owner_user_id:   owner_user_id || null,
    owner_display:   owner_display || null,
    due_date:        due_date || null,
    status:          'open',
    created_at:      new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function update(id, patch = {}) {
  const existing = byIdStmt.get(id);
  if (!existing) return null;
  if (patch.status && !STATUSES.includes(patch.status)) {
    throw new Error(`Unknown status: ${patch.status}`);
  }
  if (patch.due_date && Number.isNaN(Date.parse(patch.due_date))) {
    throw new Error('due_date must be ISO date');
  }
  updateStmt.run({
    id,
    title:         patch.title         ?? null,
    owner_user_id: patch.owner_user_id ?? null,
    owner_display: patch.owner_display ?? null,
    due_date:      patch.due_date      ?? null,
    clear_due:     patch.due_date === null ? 1 : 0,
    status:        patch.status        ?? null,
  });
  return shape(byIdStmt.get(id));
}

function complete(id, by_display) {
  completeStmt.run(new Date().toISOString(), by_display || null, id);
  return shape(byIdStmt.get(id));
}

function reopen(id) {
  reopenStmt.run(id);
  return shape(byIdStmt.get(id));
}

function remove(id) { deleteStmt.run(id); }
function findById(id) { return shape(byIdStmt.get(id)); }
function forRisk(risk_id) { return forRiskStmt.all(risk_id).map(shape); }
function openWithDueDate() { return allOpenWithDueStmt.all().map(shape); }

// Counts for every risk that has at least one step. UI joins this
// against the risk register list so each row can render
// "N of M done" without an extra fetch per risk.
function countsByRisk() {
  const out = {};
  for (const r of countsByRiskStmt.all()) {
    out[r.risk_id] = {
      done_count:  r.done_count,
      total_count: r.total_count,
      open_count:  r.total_count - r.done_count,
    };
  }
  return out;
}

module.exports = {
  STATUSES,
  add, update, complete, reopen, remove,
  findById, forRisk, openWithDueDate, countsByRisk,
};
