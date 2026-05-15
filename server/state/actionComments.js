'use strict';

/*
 * Action item comments — Phase 57.
 *
 * Phase 45 gave each assignment a single `notes` field, set at
 * assignment time. That captures the initial context but doesn't
 * support the day-by-day progress logging operators actually do
 * ("called GIBDLC AP, awaiting callback Tuesday"). This overlay adds
 * a comment thread per action item — keyed on the synthetic
 * action_item_id so threads survive re-emission.
 *
 * Same lifecycle assumption as Phase 45 assignments: the synth
 * keeps emitting the same stable IDs across requests; if the
 * underlying entity resolves, the comments stay as paper trail (we
 * never delete on resolve — only the operator can).
 *
 * Schema is created idempotently here so prod can ship the
 * migration without touching db/index.js, matching every other
 * Phase 30+ overlay.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS action_item_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action_item_id    TEXT NOT NULL,
    body              TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    created_by_user_id TEXT,
    created_by_display TEXT,
    created_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_aic_item ON action_item_comments (action_item_id, created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO action_item_comments (
    action_item_id, body, created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @action_item_id, @body, @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);

const deleteStmt = db.prepare('DELETE FROM action_item_comments WHERE id = ?');
const byIdStmt   = db.prepare('SELECT * FROM action_item_comments WHERE id = ?');
const forItemStmt = db.prepare(
  'SELECT * FROM action_item_comments WHERE action_item_id = ? ORDER BY created_at ASC, id ASC',
);
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM action_item_comments WHERE action_item_id = ?');

function shape(row) {
  if (!row) return null;
  return {
    id:         row.id,
    body:       row.body,
    created_at: row.created_at,
    author: {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    },
  };
}

function add({ action_item_id, body, by_user_id, by_display, by_role }) {
  if (!action_item_id) throw new Error('action_item_id required');
  const trimmed = (body || '').trim();
  if (!trimmed) throw new Error('Comment body required');
  if (trimmed.length > 2000) throw new Error('Comment too long (max 2,000 chars)');
  const result = insertStmt.run({
    action_item_id,
    body:               trimmed,
    created_at:         new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function remove(id) { deleteStmt.run(id); }
function findById(id) { return shape(byIdStmt.get(id)); }
function forItem(action_item_id) { return forItemStmt.all(action_item_id).map(shape); }
function countFor(action_item_id) {
  return countStmt.get(action_item_id)?.n ?? 0;
}

// Map of action_item_id → comment count. Used by the actionItems()
// synth so each item can carry its `comment_count` without N+1
// queries on the hot path.
const allCountsStmt = db.prepare(
  'SELECT action_item_id, COUNT(*) AS n FROM action_item_comments GROUP BY action_item_id',
);
function countsByItem() {
  const out = {};
  for (const r of allCountsStmt.all()) out[r.action_item_id] = r.n;
  return out;
}

module.exports = { add, remove, findById, forItem, countFor, countsByItem };
