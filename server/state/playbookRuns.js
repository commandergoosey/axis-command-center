'use strict';

/*
 * Playbook runs — Phase 80.
 *
 * Each run of a playbook (template) materializes its checklist
 * into a row per item with its own completion state. Operators
 * see runs as durable, dated artifacts: "Monday compliance pass
 * — run 28 Apr by Akosua, 4 of 5 items done."
 *
 * Schema is two tables — `playbook_runs` (one row per execution)
 * and `playbook_run_items` (one row per item, tied to the run).
 * FK + cascade so deleting a run takes its items.
 */

const db = require('../db');

const ITEM_STATUSES = ['open', 'done'];

db.exec(`
  CREATE TABLE IF NOT EXISTS playbook_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    playbook_id     INTEGER NOT NULL,
    playbook_name   TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    started_by_user_id TEXT,
    started_by_display TEXT,
    started_by_role    TEXT,
    completed_at    TEXT,
    FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playbook_run_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        INTEGER NOT NULL,
    title         TEXT NOT NULL,
    owner_display TEXT,
    due_date      TEXT,
    status        TEXT NOT NULL DEFAULT 'open',
    completed_at  TEXT,
    completed_by  TEXT,
    sort_index    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (run_id) REFERENCES playbook_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_pbk_runs_playbook
    ON playbook_runs (playbook_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pbk_run_items_run
    ON playbook_run_items (run_id, sort_index);
  CREATE INDEX IF NOT EXISTS idx_pbk_run_items_open_due
    ON playbook_run_items (status, due_date)
    WHERE status = 'open';
`);

const insertRunStmt = db.prepare(`
  INSERT INTO playbook_runs (
    playbook_id, playbook_name, started_at,
    started_by_user_id, started_by_display, started_by_role
  ) VALUES (
    @playbook_id, @playbook_name, @started_at,
    @started_by_user_id, @started_by_display, @started_by_role
  )
`);
const insertItemStmt = db.prepare(`
  INSERT INTO playbook_run_items (
    run_id, title, owner_display, due_date, status, sort_index
  ) VALUES (
    @run_id, @title, @owner_display, @due_date, 'open', @sort_index
  )
`);
const completeItemStmt = db.prepare(`
  UPDATE playbook_run_items
     SET status = 'done', completed_at = ?, completed_by = ?
   WHERE id = ? AND status = 'open'
`);
const reopenItemStmt = db.prepare(`
  UPDATE playbook_run_items
     SET status = 'open', completed_at = NULL, completed_by = NULL
   WHERE id = ?
`);
const completeRunStmt = db.prepare(`
  UPDATE playbook_runs SET completed_at = ? WHERE id = ?
`);
const itemByIdStmt    = db.prepare('SELECT * FROM playbook_run_items WHERE id = ?');
const runByIdStmt     = db.prepare('SELECT * FROM playbook_runs WHERE id = ?');
const itemsForRunStmt = db.prepare(`
  SELECT * FROM playbook_run_items
   WHERE run_id = ?
   ORDER BY sort_index ASC, id ASC
`);
const runsForPlaybookStmt = db.prepare(`
  SELECT * FROM playbook_runs
   WHERE playbook_id = ?
   ORDER BY started_at DESC, id DESC
   LIMIT ?
`);
const recentRunsStmt = db.prepare(`
  SELECT * FROM playbook_runs
   ORDER BY started_at DESC, id DESC
   LIMIT ?
`);
const openItemsStmt = db.prepare(`
  SELECT i.*, r.playbook_id, r.playbook_name, r.started_at AS run_started_at
    FROM playbook_run_items i
    JOIN playbook_runs r ON r.id = i.run_id
   WHERE i.status = 'open'
   ORDER BY
     CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END,
     i.due_date ASC,
     r.started_at DESC,
     i.sort_index ASC
   LIMIT ?
`);
const countsForRunStmt = db.prepare(`
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'done') AS done
  FROM playbook_run_items
  WHERE run_id = ?
`);

function shapeItem(row) {
  if (!row) return null;
  return {
    id:           row.id,
    run_id:       row.run_id,
    title:        row.title,
    owner_display:row.owner_display,
    due_date:     row.due_date,
    status:       row.status,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    sort_index:   row.sort_index,
    // Optional join columns from openItemsStmt.
    playbook_id:    row.playbook_id,
    playbook_name:  row.playbook_name,
    run_started_at: row.run_started_at,
  };
}

function shapeRun(row) {
  if (!row) return null;
  return {
    id:           row.id,
    playbook_id:  row.playbook_id,
    playbook_name:row.playbook_name,
    started_at:   row.started_at,
    completed_at: row.completed_at,
    started_by:   row.started_by_user_id ? {
      user_id:      row.started_by_user_id,
      display_name: row.started_by_display,
      role:         row.started_by_role,
    } : null,
  };
}

// Wrapped in a transaction so a partial materialization isn't
// possible.
const runTx = db.transaction((playbook, runMeta) => {
  const result = insertRunStmt.run({
    playbook_id:        playbook.id,
    playbook_name:      playbook.name,
    started_at:         new Date().toISOString(),
    started_by_user_id: runMeta.by_user_id || null,
    started_by_display: runMeta.by_display || null,
    started_by_role:    runMeta.by_role    || null,
  });
  const runId = result.lastInsertRowid;
  const now = Date.now();
  playbook.items.forEach((item, idx) => {
    let dueDate = null;
    if (Number.isFinite(item.default_due_offset_days)) {
      dueDate = new Date(now + item.default_due_offset_days * 24 * 60 * 60 * 1000).toISOString();
    }
    insertItemStmt.run({
      run_id:        runId,
      title:         item.title,
      owner_display: item.default_owner_display || null,
      due_date:      dueDate,
      sort_index:    idx,
    });
  });
  return runId;
});

function run(playbook, runMeta) {
  const runId = runTx(playbook, runMeta);
  return {
    run:   shapeRun(runByIdStmt.get(runId)),
    items: itemsForRunStmt.all(runId).map(shapeItem),
  };
}

function completeItem(itemId, by_display) {
  completeItemStmt.run(new Date().toISOString(), by_display || null, itemId);
  // Auto-mark run as completed when all items are done.
  const item = itemByIdStmt.get(itemId);
  if (item) {
    const counts = countsForRunStmt.get(item.run_id);
    if (counts.total === counts.done) {
      completeRunStmt.run(new Date().toISOString(), item.run_id);
    }
  }
  return shapeItem(itemByIdStmt.get(itemId));
}

function reopenItem(itemId) {
  reopenItemStmt.run(itemId);
  // If the run had completed, un-complete it (since not all items are done now).
  const item = itemByIdStmt.get(itemId);
  if (item) {
    const counts = countsForRunStmt.get(item.run_id);
    if (counts.total !== counts.done) {
      completeRunStmt.run(null, item.run_id);
    }
  }
  return shapeItem(itemByIdStmt.get(itemId));
}

function findRun(id)                       { return shapeRun(runByIdStmt.get(id)); }
function findItem(id)                      { return shapeItem(itemByIdStmt.get(id)); }
function itemsForRun(runId)                { return itemsForRunStmt.all(runId).map(shapeItem); }
function runsForPlaybook(playbookId, limit = 10) {
  const rows = runsForPlaybookStmt.all(playbookId, limit);
  return rows.map((r) => {
    const counts = countsForRunStmt.get(r.id);
    return { ...shapeRun(r), counts: { total: counts.total, done: counts.done } };
  });
}
function recentRuns(limit = 10) {
  const rows = recentRunsStmt.all(limit);
  return rows.map((r) => {
    const counts = countsForRunStmt.get(r.id);
    return { ...shapeRun(r), counts: { total: counts.total, done: counts.done } };
  });
}
function openItems(limit = 20)             { return openItemsStmt.all(limit).map(shapeItem); }

module.exports = {
  ITEM_STATUSES,
  run, completeItem, reopenItem,
  findRun, findItem, itemsForRun, runsForPlaybook, recentRuns, openItems,
};
