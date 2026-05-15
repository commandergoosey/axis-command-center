'use strict';

/*
 * Playbook templates — Phase 80.
 *
 * Reusable named checklists for routines operators run on schedule
 * — Monday compliance pass, Friday EOM reconciliation, weekly
 * hauler chase. The template is just the recipe (name + items);
 * each *run* against the template lives in playbook_runs and
 * carries its own per-item completion state.
 *
 * Templates have an informational `schedule_label` ("Weekly,
 * Monday morning"). Phase 80 ships explicit-run only — no cron;
 * operators click "Run now". The label is for the sidebar /
 * filter chips so operators can find the right template.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS playbooks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT,
    schedule_label  TEXT,
    items_json      TEXT NOT NULL,
    archived_at     TEXT,
    created_at      TEXT NOT NULL,
    created_by_user_id TEXT,
    created_by_display TEXT,
    created_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_playbooks_active
    ON playbooks (archived_at, created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO playbooks (
    name, description, schedule_label, items_json,
    created_at, created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @name, @description, @schedule_label, @items_json,
    @created_at, @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const updateStmt = db.prepare(`
  UPDATE playbooks
     SET name           = COALESCE(@name, name),
         description    = COALESCE(@description, description),
         schedule_label = COALESCE(@schedule_label, schedule_label),
         items_json     = COALESCE(@items_json, items_json)
   WHERE id = @id
`);
const archiveStmt   = db.prepare('UPDATE playbooks SET archived_at = ? WHERE id = ?');
const unarchiveStmt = db.prepare('UPDATE playbooks SET archived_at = NULL WHERE id = ?');
const deleteStmt    = db.prepare('DELETE FROM playbooks WHERE id = ?');
const byIdStmt      = db.prepare('SELECT * FROM playbooks WHERE id = ?');
const activeStmt    = db.prepare(`
  SELECT * FROM playbooks
   WHERE archived_at IS NULL
   ORDER BY created_at ASC, id ASC
`);

function shape(row) {
  if (!row) return null;
  let items = [];
  try { items = JSON.parse(row.items_json || '[]'); } catch { items = []; }
  return {
    id:             row.id,
    name:           row.name,
    description:    row.description,
    schedule_label: row.schedule_label,
    items,
    archived_at:    row.archived_at,
    created_at:     row.created_at,
    created_by:     row.created_by_user_id ? {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    } : null,
  };
}

function add({ name, description, schedule_label, items, by_user_id, by_display, by_role }) {
  const t = (name || '').trim();
  if (!t) throw new Error('Playbook name required');
  if (t.length > 120) throw new Error('Name too long (max 120 chars)');
  if (!Array.isArray(items) || items.length === 0) throw new Error('At least one item required');
  const cleanedItems = items.map((item, idx) => {
    const title = (item.title || '').trim();
    if (!title) throw new Error(`Item ${idx + 1} title required`);
    return {
      title:                   title.slice(0, 200),
      default_owner_display:   item.default_owner_display ? String(item.default_owner_display).slice(0, 80) : null,
      default_due_offset_days: Number.isFinite(item.default_due_offset_days) ? item.default_due_offset_days : null,
    };
  });
  const result = insertStmt.run({
    name:           t,
    description:    description ? String(description).trim().slice(0, 500) : null,
    schedule_label: schedule_label ? String(schedule_label).trim().slice(0, 80) : null,
    items_json:     JSON.stringify(cleanedItems),
    created_at:     new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function update(id, patch = {}) {
  const existing = byIdStmt.get(id);
  if (!existing) return null;
  let itemsJson = null;
  if (patch.items !== undefined) {
    if (!Array.isArray(patch.items) || patch.items.length === 0) {
      throw new Error('At least one item required');
    }
    const cleaned = patch.items.map((item, idx) => {
      const title = (item.title || '').trim();
      if (!title) throw new Error(`Item ${idx + 1} title required`);
      return {
        title:                   title.slice(0, 200),
        default_owner_display:   item.default_owner_display ? String(item.default_owner_display).slice(0, 80) : null,
        default_due_offset_days: Number.isFinite(item.default_due_offset_days) ? item.default_due_offset_days : null,
      };
    });
    itemsJson = JSON.stringify(cleaned);
  }
  updateStmt.run({
    id,
    name:           patch.name           ?? null,
    description:    patch.description    ?? null,
    schedule_label: patch.schedule_label ?? null,
    items_json:     itemsJson,
  });
  return shape(byIdStmt.get(id));
}

function archive(id, ts = new Date().toISOString())   { archiveStmt.run(ts, id); }
function unarchive(id)                                { unarchiveStmt.run(id); }
function remove(id)                                   { deleteStmt.run(id); }
function findById(id)                                 { return shape(byIdStmt.get(id)); }
function listActive()                                 { return activeStmt.all().map(shape); }

module.exports = {
  add, update, archive, unarchive, remove,
  findById, listActive,
};
