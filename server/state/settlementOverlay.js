'use strict';

/*
 * Settlement state overlay — Phase 89.
 *
 * Mirrors the durable-overlay pattern (alertState, filingState,
 * licenceState, etc.). The base SETTLEMENTS in mock/settlements.js
 * are immutable demo seed; this overlay captures operator
 * actions that mutate status: mark-paid, dispute, resolve-dispute.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

const STATUSES = ['pending', 'paid', 'partial', 'disputed'];

// ── Generated fortnightly invoices ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS generated_settlements (
    id              TEXT PRIMARY KEY,
    hauler_id       TEXT NOT NULL,
    period          TEXT NOT NULL,
    period_label    TEXT NOT NULL,
    issued_at       TEXT NOT NULL,
    due_date        TEXT NOT NULL,
    gross_usd       INTEGER NOT NULL,
    deductions_usd  INTEGER NOT NULL,
    net_usd         INTEGER NOT NULL,
    line_items_json TEXT NOT NULL DEFAULT '[]',
    generated_at    TEXT NOT NULL,
    generated_by    TEXT
  );
`);

const insertGenStmt = db.prepare(`
  INSERT OR IGNORE INTO generated_settlements
    (id, hauler_id, period, period_label, issued_at, due_date,
     gross_usd, deductions_usd, net_usd, line_items_json, generated_at, generated_by)
  VALUES
    (@id, @hauler_id, @period, @period_label, @issued_at, @due_date,
     @gross_usd, @deductions_usd, @net_usd, @line_items_json, @generated_at, @generated_by)
`);

const listGenStmt = db.prepare('SELECT * FROM generated_settlements ORDER BY generated_at DESC');
const hasPeriodStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM generated_settlements WHERE period = @period AND hauler_id = @hauler_id',
);

function deserialiseGenerated(row) {
  return {
    id:             row.id,
    hauler_id:      row.hauler_id,
    period:         row.period,
    period_label:   row.period_label,
    issued_at:      row.issued_at,
    due_date:       row.due_date,
    gross_usd:      row.gross_usd,
    deductions_usd: row.deductions_usd,
    net_usd:        row.net_usd,
    line_items:     JSON.parse(row.line_items_json || '[]'),
    status:         'pending',
    generated:      true,
  };
}

function createGenerated(rows) {
  const insert = db.transaction((rs) => rs.forEach((r) => insertGenStmt.run(r)));
  insert(rows);
}

function listGenerated() {
  return listGenStmt.all().map(deserialiseGenerated);
}

function hasPeriod(period, hauler_id) {
  return (hasPeriodStmt.get({ period, hauler_id })?.n ?? 0) > 0;
}

// ── Overlay state table ───────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS settlement_state (
    settlement_id     TEXT PRIMARY KEY,
    status            TEXT,
    paid_at           TEXT,
    paid_amount_usd   INTEGER,
    payment_ref       TEXT,
    dispute_reason    TEXT,
    dispute_opened_at TEXT,
    dispute_opened_by TEXT,
    notes             TEXT,
    updated_at        TEXT NOT NULL,
    updated_by_user_id TEXT,
    updated_by_display TEXT
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO settlement_state (
    settlement_id, status, paid_at, paid_amount_usd, payment_ref,
    dispute_reason, dispute_opened_at, dispute_opened_by, notes,
    updated_at, updated_by_user_id, updated_by_display
  ) VALUES (
    @settlement_id, @status, @paid_at, @paid_amount_usd, @payment_ref,
    @dispute_reason, @dispute_opened_at, @dispute_opened_by, @notes,
    @updated_at, @updated_by_user_id, @updated_by_display
  )
  ON CONFLICT (settlement_id) DO UPDATE SET
    status            = COALESCE(excluded.status, settlement_state.status),
    paid_at           = COALESCE(excluded.paid_at, settlement_state.paid_at),
    paid_amount_usd   = COALESCE(excluded.paid_amount_usd, settlement_state.paid_amount_usd),
    payment_ref       = COALESCE(excluded.payment_ref, settlement_state.payment_ref),
    dispute_reason    = COALESCE(excluded.dispute_reason, settlement_state.dispute_reason),
    dispute_opened_at = COALESCE(excluded.dispute_opened_at, settlement_state.dispute_opened_at),
    dispute_opened_by = COALESCE(excluded.dispute_opened_by, settlement_state.dispute_opened_by),
    notes             = COALESCE(excluded.notes, settlement_state.notes),
    updated_at        = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_display = excluded.updated_by_display
`);
const byIdStmt = db.prepare('SELECT * FROM settlement_state WHERE settlement_id = ?');

// Dedicated notes UPDATE: bypasses the COALESCE in upsertStmt so null can clear existing notes.
const setNotesStmt = db.prepare(`
  UPDATE settlement_state SET notes = ?, updated_at = ?, updated_by_user_id = ?, updated_by_display = ?
  WHERE settlement_id = ?
`);

function getOverride(settlement_id) {
  const row = byIdStmt.get(settlement_id);
  return row || null;
}

function markPaid(settlement_id, { paid_at, paid_amount_usd, payment_ref, by_user_id, by_display }) {
  upsertStmt.run({
    settlement_id,
    status: 'paid',
    paid_at:         paid_at || new Date().toISOString(),
    paid_amount_usd: paid_amount_usd ?? null,
    payment_ref:     payment_ref     ?? null,
    dispute_reason:  null,
    dispute_opened_at: null,
    dispute_opened_by: null,
    notes:           null,
    updated_at:      new Date().toISOString(),
    updated_by_user_id: by_user_id || null,
    updated_by_display: by_display || null,
  });
}

function openDispute(settlement_id, { dispute_reason, by_user_id, by_display }) {
  upsertStmt.run({
    settlement_id,
    status: 'disputed',
    paid_at: null,
    paid_amount_usd: null,
    payment_ref: null,
    dispute_reason: dispute_reason || null,
    dispute_opened_at: new Date().toISOString(),
    dispute_opened_by: by_display || null,
    notes: null,
    updated_at: new Date().toISOString(),
    updated_by_user_id: by_user_id || null,
    updated_by_display: by_display || null,
  });
}

function resolveDispute(settlement_id, { resolution_status = 'pending', by_user_id, by_display }) {
  // Resolution flips back to pending or paid depending on
  // the requested resolution_status.
  if (!STATUSES.includes(resolution_status)) {
    throw new Error(`Unknown resolution_status: ${resolution_status}`);
  }
  upsertStmt.run({
    settlement_id,
    status: resolution_status,
    paid_at: null,
    paid_amount_usd: null,
    payment_ref: null,
    dispute_reason: null,
    dispute_opened_at: null,
    dispute_opened_by: null,
    notes: null,
    updated_at: new Date().toISOString(),
    updated_by_user_id: by_user_id || null,
    updated_by_display: by_display || null,
  });
}

function setNotes(settlement_id, { notes, by_user_id, by_display }) {
  const ts = new Date().toISOString();
  const normalised = notes ? String(notes).slice(0, 2000) : null;
  // Use upsert to create the row if it doesn't exist yet, then UPDATE
  // directly so null can clear an existing notes value (COALESCE in upsertStmt
  // would silently keep the old value when null is passed).
  upsertStmt.run({
    settlement_id,
    status: null, paid_at: null, paid_amount_usd: null, payment_ref: null,
    dispute_reason: null, dispute_opened_at: null, dispute_opened_by: null,
    notes: normalised,
    updated_at: ts, updated_by_user_id: by_user_id || null, updated_by_display: by_display || null,
  });
  setNotesStmt.run(normalised, ts, by_user_id || null, by_display || null, settlement_id);
}

// Apply the overlay to a base settlement record. Caller passes
// the immutable mock object; we return a merged copy.
function apply(base) {
  const ov = getOverride(base.id);
  if (!ov) return base;
  return {
    ...base,
    status:          ov.status         ?? base.status,
    paid_at:         ov.paid_at        ?? base.paid_at,
    paid_amount_usd: ov.paid_amount_usd ?? base.paid_amount_usd,
    payment_ref:     ov.payment_ref    ?? base.payment_ref,
    dispute: ov.dispute_opened_at ? {
      reason:    ov.dispute_reason,
      opened_at: ov.dispute_opened_at,
      opened_by: ov.dispute_opened_by,
    } : null,
    notes:           ov.notes ?? null,
    last_updated_at: ov.updated_at,
    last_updated_by: ov.updated_by_display,
  };
}

module.exports = {
  STATUSES,
  markPaid, openDispute, resolveDispute, setNotes,
  apply, getOverride,
  createGenerated, listGenerated, hasPeriod,
};
