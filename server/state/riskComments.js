'use strict';

/*
 * Risk comments — Phase 77.
 *
 * Phase 72 gave risks structured fields: severity, likelihood,
 * status, owner, description, mitigation plan. Phase 74 added
 * trackable mitigation steps. But all of that is static-feeling
 * — operators set the fields and re-edit them in place. The
 * *evolution* of a risk over days and weeks ("as of 2 May,
 * GIBDLC's CFO has confirmed the AP commitment") has nowhere
 * structured to live. Operators were dropping these updates into
 * handover narrative, where they scroll past after one shift.
 *
 * This overlay mirrors Phase 57's action_item_comments pattern,
 * keyed on risk_id. Comments are append-only narrative; mitigation
 * steps are the trackable work. Together they let a risk
 * accumulate a live ledger that survives shift changes and
 * surfaces in the lender pack.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS risk_comments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    risk_id             INTEGER NOT NULL,
    body                TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    created_by_user_id  TEXT,
    created_by_display  TEXT,
    created_by_role     TEXT,
    FOREIGN KEY (risk_id) REFERENCES risk_register(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_risk_comments_risk
    ON risk_comments (risk_id, created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO risk_comments (
    risk_id, body, created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @risk_id, @body, @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const deleteStmt = db.prepare('DELETE FROM risk_comments WHERE id = ?');
const byIdStmt   = db.prepare('SELECT * FROM risk_comments WHERE id = ?');
const forRiskStmt = db.prepare(`
  SELECT * FROM risk_comments
   WHERE risk_id = ?
   ORDER BY created_at ASC, id ASC
`);
const recentForRiskStmt = db.prepare(`
  SELECT * FROM risk_comments
   WHERE risk_id = ?
   ORDER BY created_at DESC, id DESC
   LIMIT ?
`);
const countsByRiskStmt = db.prepare(`
  SELECT risk_id, COUNT(*) AS n
    FROM risk_comments
   GROUP BY risk_id
`);

function shape(row) {
  if (!row) return null;
  return {
    id:         row.id,
    risk_id:    row.risk_id,
    body:       row.body,
    created_at: row.created_at,
    author: {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    },
  };
}

function add({ risk_id, body, by_user_id, by_display, by_role }) {
  const trimmed = (body || '').trim();
  if (!trimmed) throw new Error('Comment body required');
  if (trimmed.length > 2000) throw new Error('Comment too long (max 2,000 chars)');
  const result = insertStmt.run({
    risk_id,
    body: trimmed,
    created_at: new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function remove(id) { deleteStmt.run(id); }
function findById(id) { return shape(byIdStmt.get(id)); }
function forRisk(risk_id) { return forRiskStmt.all(risk_id).map(shape); }
function recentForRisk(risk_id, limit = 3) {
  // Returns latest N descending — used by the lender pack to surface
  // the play-by-play in the credit-committee summary.
  return recentForRiskStmt.all(risk_id, limit).map(shape);
}

function countsByRisk() {
  const out = {};
  for (const r of countsByRiskStmt.all()) out[r.risk_id] = r.n;
  return out;
}

module.exports = {
  add, remove, findById, forRisk, recentForRisk, countsByRisk,
};
