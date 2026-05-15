'use strict';

/*
 * Receivables collection followups — Phase 64.
 *
 * The receivables ageing fixture (PAYMENT_SECURITY.receivables.ageing)
 * surfaces overdue balance by band, but operators have no way to
 * track WHO is chasing WHAT. This overlay records the chase activity
 * per ageing band:
 *
 *   - Who placed the call (or sent the email, or visited)
 *   - When
 *   - The outcome (committed-to-pay / partial / no-response /
 *     disputed / collected)
 *   - Free-text notes for context
 *
 * Each followup is audit-logged at the route layer; this module
 * just owns the durable state. Resolved followups stay in the table
 * — they're paper trail for the audit covenant test.
 *
 * Schema is created idempotently here so prod migrates without
 * touching db/index.js (matching every other Phase 30+ overlay).
 */

const db = require('../db');

const BAND_IDS = ['band_0_30', 'band_31_60', 'band_61_90', 'band_90p'];
const OUTCOMES = ['committed', 'partial', 'no_response', 'disputed', 'collected'];

db.exec(`
  CREATE TABLE IF NOT EXISTS receivable_followups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    band_id         TEXT NOT NULL,
    notes           TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    created_by_user_id TEXT,
    created_by_display TEXT,
    created_by_role    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_recv_followups_band
    ON receivable_followups (band_id, created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO receivable_followups (
    band_id, notes, outcome, created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @band_id, @notes, @outcome, @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const deleteStmt = db.prepare('DELETE FROM receivable_followups WHERE id = ?');
const byIdStmt   = db.prepare('SELECT * FROM receivable_followups WHERE id = ?');
const allStmt    = db.prepare('SELECT * FROM receivable_followups ORDER BY created_at DESC, id DESC');
const byBandStmt = db.prepare('SELECT * FROM receivable_followups WHERE band_id = ? ORDER BY created_at DESC, id DESC');
const countsByBandStmt = db.prepare(
  'SELECT band_id, COUNT(*) AS n FROM receivable_followups GROUP BY band_id',
);

function shape(row) {
  if (!row) return null;
  return {
    id:         row.id,
    band_id:    row.band_id,
    notes:      row.notes,
    outcome:    row.outcome,
    created_at: row.created_at,
    author: {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    },
  };
}

function add({ band_id, notes, outcome, by_user_id, by_display, by_role }) {
  if (!BAND_IDS.includes(band_id)) throw new Error(`Unknown band_id: ${band_id}`);
  if (!OUTCOMES.includes(outcome)) throw new Error(`Unknown outcome: ${outcome}`);
  const trimmed = (notes || '').trim();
  if (!trimmed) throw new Error('Notes required');
  if (trimmed.length > 1000) throw new Error('Notes too long (max 1,000 chars)');

  const result = insertStmt.run({
    band_id,
    notes:              trimmed,
    outcome,
    created_at:         new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function remove(id) { deleteStmt.run(id); }
function findById(id) { return shape(byIdStmt.get(id)); }
function all() { return allStmt.all().map(shape); }
function forBand(band_id) { return byBandStmt.all(band_id).map(shape); }

// Counts grouped by band, used by the route to enrich the receivables
// payload — UI shows "$280,000 · 3 followups" per band.
function countsByBand() {
  const out = {};
  for (const r of countsByBandStmt.all()) out[r.band_id] = r.n;
  return out;
}

module.exports = {
  BAND_IDS, OUTCOMES,
  add, remove, findById, all, forBand, countsByBand,
};
