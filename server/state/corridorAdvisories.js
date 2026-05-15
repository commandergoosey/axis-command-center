'use strict';

/*
 * Corridor advisories — Phase 98.
 *
 * Live write path for conditions the Corridor page has always shown
 * as static mock. axis_admin and axis_ops can post, resolve, and delete
 * field advisories in real time.
 *
 * Severity palette (matches alert register):
 *   info     — FYI, no action required (GHA road works, minor delay)
 *   warn     — Action recommended (reduced throughput, weather advisory)
 *   critical — Immediate convoy impact (road closed, weighbridge down)
 *
 * Lifecycle:
 *   posted → active (resolved_at IS NULL, expires_at IS NULL or future)
 *   posted → resolved (resolved_at set by operator)
 *   posted → expired (expires_at in the past, auto-filtered from active)
 *
 * The GET /api/corridor endpoint merges live active advisories on top of
 * the mock baseline so the page always has at least the seeded content
 * until operators start using the write path.
 */

const db = require('../db');

const SEVERITIES = ['info', 'warn', 'critical'];

db.exec(`
  CREATE TABLE IF NOT EXISTS corridor_advisories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    severity        TEXT    NOT NULL DEFAULT 'info',
    body            TEXT    NOT NULL,
    km_from         INTEGER,
    km_to           INTEGER,
    posted_at       TEXT    NOT NULL,
    expires_at      TEXT,
    resolved_at     TEXT,
    posted_by_id    TEXT,
    posted_by_name  TEXT,
    resolved_by_name TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_corridor_adv_active
    ON corridor_advisories (resolved_at, posted_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO corridor_advisories
    (severity, body, km_from, km_to, posted_at, expires_at, posted_by_id, posted_by_name)
  VALUES
    (@severity, @body, @km_from, @km_to, @posted_at, @expires_at, @posted_by_id, @posted_by_name)
`);

const resolveStmt = db.prepare(`
  UPDATE corridor_advisories
     SET resolved_at = @resolved_at, resolved_by_name = @resolved_by_name
   WHERE id = @id AND resolved_at IS NULL
`);

const deleteStmt = db.prepare('DELETE FROM corridor_advisories WHERE id = ?');
const byIdStmt   = db.prepare('SELECT * FROM corridor_advisories WHERE id = ?');

const activeStmt = db.prepare(`
  SELECT * FROM corridor_advisories
   WHERE resolved_at IS NULL
     AND (expires_at IS NULL OR expires_at > ?)
   ORDER BY
     CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
     posted_at DESC
`);

const recentStmt = db.prepare(`
  SELECT * FROM corridor_advisories
   ORDER BY posted_at DESC
   LIMIT 50
`);

function shape(row) {
  if (!row) return null;
  return {
    id:               `live-${row.id}`,
    _db_id:           row.id,
    severity:         row.severity,
    body:             row.body,
    km_from:          row.km_from,
    km_to:            row.km_to,
    posted_at:        row.posted_at,
    expires_at:       row.expires_at,
    resolved_at:      row.resolved_at,
    posted_by_name:   row.posted_by_name,
    resolved_by_name: row.resolved_by_name,
    is_live:          true,
  };
}

function add({ severity = 'info', body, km_from, km_to, expires_at, by_id, by_name }) {
  const b = String(body || '').trim();
  if (!b) throw new Error('Advisory body is required');
  if (b.length > 500) throw new Error('Body too long (max 500 chars)');
  if (!SEVERITIES.includes(severity)) throw new Error(`Invalid severity: ${severity}`);
  if (expires_at && Number.isNaN(Date.parse(expires_at))) throw new Error('expires_at must be an ISO date');

  const r = insertStmt.run({
    severity,
    body:        b,
    km_from:     km_from ?? null,
    km_to:       km_to ?? null,
    posted_at:   new Date().toISOString(),
    expires_at:  expires_at ?? null,
    posted_by_id:   by_id   ?? null,
    posted_by_name: by_name ?? null,
  });
  return shape(byIdStmt.get(r.lastInsertRowid));
}

function resolve(dbId, { by_name }) {
  const existing = byIdStmt.get(dbId);
  if (!existing) return null;
  resolveStmt.run({
    id:              dbId,
    resolved_at:     new Date().toISOString(),
    resolved_by_name: by_name ?? null,
  });
  return shape(byIdStmt.get(dbId));
}

function remove(dbId) {
  deleteStmt.run(dbId);
}

// Active advisories — for the GET /api/corridor response.
function listActive() {
  return activeStmt.all(new Date().toISOString()).map(shape);
}

// All advisories — for admin manage view.
function listAll() {
  return recentStmt.all().map(shape);
}

function findById(dbId) {
  return shape(byIdStmt.get(dbId));
}

module.exports = { SEVERITIES, add, resolve, remove, listActive, listAll, findById };
