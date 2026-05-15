'use strict';

/*
 * Handover notes — Phase 67.
 *
 * The bridge between shifts. Outgoing operator writes a brief
 * narrative for the incoming shift covering what's outstanding,
 * what's been escalated, what's expected to land tomorrow. The
 * incoming operator sees it prominently on Today — it's the first
 * thing they read after the dominant story.
 *
 * Schema is durable in SQLite; idempotent CREATE so prod migrates
 * without touching db/index.js.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS handover_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    body            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    created_by_user_id TEXT,
    created_by_display TEXT,
    created_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_handover_created
    ON handover_notes (created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO handover_notes (
    body, created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @body, @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const byIdStmt    = db.prepare('SELECT * FROM handover_notes WHERE id = ?');
const latestStmt  = db.prepare('SELECT * FROM handover_notes ORDER BY created_at DESC, id DESC LIMIT 1');
const recentStmt  = db.prepare('SELECT * FROM handover_notes ORDER BY created_at DESC, id DESC LIMIT ?');
const deleteStmt  = db.prepare('DELETE FROM handover_notes WHERE id = ?');

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

function add({ body, by_user_id, by_display, by_role }) {
  const trimmed = (body || '').trim();
  if (!trimmed) throw new Error('Handover body required');
  if (trimmed.length > 4000) throw new Error('Handover too long (max 4,000 chars)');
  const result = insertStmt.run({
    body: trimmed,
    created_at: new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function latest()           { return shape(latestStmt.get()); }
function recent(limit = 20) { return recentStmt.all(limit).map(shape); }
function findById(id)       { return shape(byIdStmt.get(id)); }
function remove(id)         { deleteStmt.run(id); }

module.exports = { add, latest, recent, findById, remove };
