'use strict';

/*
 * Hauler contact log — Phase 69.
 *
 * The handover note (Phase 67) captures the operator's narrative
 * across a shift. The receivables chase log (Phase 64) captures
 * structured contact attempts per ageing band. This module
 * generalizes that pattern to any hauler.
 *
 * Per-hauler contact log: when did we last reach Hauler 05's
 * manager, on what channel, what was the outcome, when's the
 * follow-up. The next operator opens the hauler drawer and sees
 * a chronological strip of recent contacts — phone / WhatsApp /
 * email / site visit — with outcome and follow-up status. No
 * more "I think Akosua called him yesterday but I'm not sure
 * what was committed."
 *
 * Schema is durable in SQLite; idempotent CREATE so prod migrates
 * without touching db/index.js (matching every other Phase 30+
 * overlay).
 */

const db = require('../db');

const CHANNELS = ['phone', 'whatsapp', 'email', 'site_visit', 'meeting'];
const DIRECTIONS = ['outbound', 'inbound'];
const OUTCOMES = [
  'committed',         // counterparty made a specific commitment
  'partial',           // some progress, more chasing needed
  'no_response',       // didn't pick up, no reply
  'disputed',          // disagreement on facts/terms
  'escalation_needed', // beyond ops to resolve
  'resolved',          // matter closed
];

db.exec(`
  CREATE TABLE IF NOT EXISTS hauler_contacts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    hauler_id           TEXT NOT NULL,
    channel             TEXT NOT NULL,
    direction           TEXT NOT NULL,
    counterparty_name   TEXT,
    counterparty_role   TEXT,
    summary             TEXT NOT NULL,
    outcome             TEXT NOT NULL,
    follow_up_at        TEXT,
    follow_up_resolved  INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    created_by_user_id  TEXT,
    created_by_display  TEXT,
    created_by_role     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_hauler_contacts_hauler
    ON hauler_contacts (hauler_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_hauler_contacts_followup
    ON hauler_contacts (follow_up_at)
    WHERE follow_up_at IS NOT NULL AND follow_up_resolved = 0;
`);

const insertStmt = db.prepare(`
  INSERT INTO hauler_contacts (
    hauler_id, channel, direction,
    counterparty_name, counterparty_role,
    summary, outcome, follow_up_at,
    created_at,
    created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @hauler_id, @channel, @direction,
    @counterparty_name, @counterparty_role,
    @summary, @outcome, @follow_up_at,
    @created_at,
    @created_by_user_id, @created_by_display, @created_by_role
  )
`);
const byIdStmt        = db.prepare('SELECT * FROM hauler_contacts WHERE id = ?');
const byHaulerStmt    = db.prepare(`
  SELECT * FROM hauler_contacts
   WHERE hauler_id = ?
   ORDER BY created_at DESC, id DESC
   LIMIT ?
`);
const latestPerHaulerStmt = db.prepare(`
  SELECT hauler_id, MAX(created_at) AS last_contact_at, COUNT(*) AS n
    FROM hauler_contacts
   GROUP BY hauler_id
`);
const resolveFollowupStmt = db.prepare(`
  UPDATE hauler_contacts
     SET follow_up_resolved = 1
   WHERE id = ? AND follow_up_resolved = 0
`);
const deleteStmt      = db.prepare('DELETE FROM hauler_contacts WHERE id = ?');

function shape(row) {
  if (!row) return null;
  return {
    id:                row.id,
    hauler_id:         row.hauler_id,
    channel:           row.channel,
    direction:         row.direction,
    counterparty_name: row.counterparty_name,
    counterparty_role: row.counterparty_role,
    summary:           row.summary,
    outcome:           row.outcome,
    follow_up_at:      row.follow_up_at,
    follow_up_resolved: !!row.follow_up_resolved,
    created_at:        row.created_at,
    author: {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    },
  };
}

function add({
  hauler_id, channel, direction = 'outbound',
  counterparty_name = null, counterparty_role = null,
  summary, outcome, follow_up_at = null,
  by_user_id, by_display, by_role,
}) {
  if (!hauler_id) throw new Error('hauler_id required');
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);
  if (!DIRECTIONS.includes(direction)) throw new Error(`Unknown direction: ${direction}`);
  if (!OUTCOMES.includes(outcome)) throw new Error(`Unknown outcome: ${outcome}`);
  const trimmed = (summary || '').trim();
  if (!trimmed) throw new Error('Summary required');
  if (trimmed.length > 1000) throw new Error('Summary too long (max 1,000 chars)');
  if (follow_up_at && Number.isNaN(Date.parse(follow_up_at))) {
    throw new Error('follow_up_at must be ISO date');
  }

  const result = insertStmt.run({
    hauler_id,
    channel,
    direction,
    counterparty_name: counterparty_name || null,
    counterparty_role: counterparty_role || null,
    summary:           trimmed,
    outcome,
    follow_up_at:      follow_up_at || null,
    created_at:        new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function findById(id)               { return shape(byIdStmt.get(id)); }
function forHauler(hauler_id, limit = 50) {
  return byHaulerStmt.all(hauler_id, limit).map(shape);
}
function resolveFollowup(id)        { resolveFollowupStmt.run(id); }
function remove(id)                 { deleteStmt.run(id); }

// Used by the stale-contact observation on Today: a map of
// hauler_id → { last_contact_at, n }. UI joins this against the
// active hauler list to flag any active hauler with no contact
// in the last N days.
function latestPerHauler() {
  const out = {};
  for (const r of latestPerHaulerStmt.all()) {
    out[r.hauler_id] = { last_contact_at: r.last_contact_at, n: r.n };
  }
  return out;
}

module.exports = {
  CHANNELS, DIRECTIONS, OUTCOMES,
  add, findById, forHauler,
  resolveFollowup, remove,
  latestPerHauler,
};
