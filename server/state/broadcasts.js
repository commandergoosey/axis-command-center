'use strict';

/*
 * Corridor announcements — Phase 85.
 *
 * One-to-many AXIS-to-corridor broadcasts. Distinct from:
 *   - handover (shift-to-shift, narrative, decays after 36h)
 *   - action items (person-to-person, queued)
 *   - hauler contacts (hauler-to-hauler relationship log)
 *
 * Used for: tariff changes, port maintenance, audit kickoffs,
 * regulatory updates — anything every persona on the corridor
 * should see and archive.
 *
 * Severity: info (default), warn (action recommended), urgent
 * (read this immediately).
 *
 * Audience: all (default — operators + hauler admins + lender),
 * operators (axis only), haulers (haulers only — visible on
 * MyHauler dashboard but not Today).
 *
 * Optional `expires_at` so a tariff-change announcement can self-
 * archive after the new rate takes effect, without an operator
 * having to remember to clean up.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

const SEVERITIES = ['info', 'warn', 'urgent'];
const AUDIENCES  = ['all', 'operators', 'haulers'];

db.exec(`
  CREATE TABLE IF NOT EXISTS broadcasts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'info',
    audience        TEXT NOT NULL DEFAULT 'all',
    posted_at       TEXT NOT NULL,
    expires_at      TEXT,
    archived_at     TEXT,
    posted_by_user_id TEXT,
    posted_by_display TEXT,
    posted_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_broadcasts_active
    ON broadcasts (archived_at, posted_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO broadcasts (
    title, body, severity, audience, posted_at, expires_at,
    posted_by_user_id, posted_by_display, posted_by_role
  ) VALUES (
    @title, @body, @severity, @audience, @posted_at, @expires_at,
    @posted_by_user_id, @posted_by_display, @posted_by_role
  )
`);
const updateStmt = db.prepare(`
  UPDATE broadcasts
     SET title    = COALESCE(@title, title),
         body     = COALESCE(@body, body),
         severity = COALESCE(@severity, severity),
         audience = COALESCE(@audience, audience),
         expires_at = CASE WHEN @clear_expiry = 1 THEN NULL ELSE COALESCE(@expires_at, expires_at) END
   WHERE id = @id
`);
const archiveStmt   = db.prepare('UPDATE broadcasts SET archived_at = ? WHERE id = ?');
const unarchiveStmt = db.prepare('UPDATE broadcasts SET archived_at = NULL WHERE id = ?');
const deleteStmt    = db.prepare('DELETE FROM broadcasts WHERE id = ?');
const byIdStmt      = db.prepare('SELECT * FROM broadcasts WHERE id = ?');
const allStmt       = db.prepare(`
  SELECT * FROM broadcasts
   ORDER BY posted_at DESC, id DESC
`);
const activeStmt    = db.prepare(`
  SELECT * FROM broadcasts
   WHERE archived_at IS NULL
     AND (expires_at IS NULL OR expires_at >= ?)
   ORDER BY
     CASE severity WHEN 'urgent' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
     posted_at DESC
`);

function shape(row) {
  if (!row) return null;
  return {
    id:           row.id,
    title:        row.title,
    body:         row.body,
    severity:     row.severity,
    audience:     row.audience,
    posted_at:    row.posted_at,
    expires_at:   row.expires_at,
    archived_at:  row.archived_at,
    posted_by:    row.posted_by_user_id ? {
      user_id:      row.posted_by_user_id,
      display_name: row.posted_by_display,
      role:         row.posted_by_role,
    } : null,
  };
}

function add({
  title, body, severity = 'info', audience = 'all', expires_at = null,
  by_user_id, by_display, by_role,
}) {
  const t = (title || '').trim();
  const b = (body || '').trim();
  if (!t) throw new Error('Title required');
  if (!b) throw new Error('Body required');
  if (t.length > 120) throw new Error('Title too long (max 120 chars)');
  if (b.length > 2000) throw new Error('Body too long (max 2,000 chars)');
  if (!SEVERITIES.includes(severity)) throw new Error(`Unknown severity: ${severity}`);
  if (!AUDIENCES.includes(audience))  throw new Error(`Unknown audience: ${audience}`);
  if (expires_at && Number.isNaN(Date.parse(expires_at))) {
    throw new Error('expires_at must be ISO date');
  }
  const result = insertStmt.run({
    title: t,
    body:  b,
    severity, audience,
    posted_at:  new Date().toISOString(),
    expires_at: expires_at || null,
    posted_by_user_id: by_user_id || null,
    posted_by_display: by_display || null,
    posted_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function update(id, patch = {}) {
  const existing = byIdStmt.get(id);
  if (!existing) return null;
  if (patch.severity && !SEVERITIES.includes(patch.severity)) {
    throw new Error(`Unknown severity: ${patch.severity}`);
  }
  if (patch.audience && !AUDIENCES.includes(patch.audience)) {
    throw new Error(`Unknown audience: ${patch.audience}`);
  }
  if (patch.expires_at && Number.isNaN(Date.parse(patch.expires_at))) {
    throw new Error('expires_at must be ISO date');
  }
  updateStmt.run({
    id,
    title:        patch.title    ?? null,
    body:         patch.body     ?? null,
    severity:     patch.severity ?? null,
    audience:     patch.audience ?? null,
    expires_at:   patch.expires_at ?? null,
    clear_expiry: patch.expires_at === null ? 1 : 0,
  });
  return shape(byIdStmt.get(id));
}

function archive(id, ts = new Date().toISOString())   { archiveStmt.run(ts, id); }
function unarchive(id)                                { unarchiveStmt.run(id); }
function remove(id)                                   { deleteStmt.run(id); }
function findById(id)                                 { return shape(byIdStmt.get(id)); }
function listAll()                                    { return allStmt.all().map(shape); }

// Active broadcasts visible to a given role's audience filter.
function activeForRole(role, now = new Date().toISOString()) {
  const all = activeStmt.all(now).map(shape);
  return all.filter((b) => {
    if (b.audience === 'all') return true;
    if (b.audience === 'operators') return role === 'axis_admin' || role === 'axis_ops';
    if (b.audience === 'haulers')   return role === 'hauler_admin';
    return false;
  });
}

module.exports = {
  SEVERITIES, AUDIENCES,
  add, update, archive, unarchive, remove,
  findById, listAll, activeForRole,
};
