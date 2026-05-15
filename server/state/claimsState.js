'use strict';

/*
 * Claims state overlay — Phase 90.
 *
 * Mirrors the durable-overlay pattern (alertState, filingState,
 * settlementOverlay, etc.). Base CLAIMS in mock/claims.js are
 * immutable demo seed; this overlay captures status transitions
 * and supplemental fields written during the cockpit's life.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

const STATUSES = ['filed', 'under_review', 'approved', 'denied', 'paid'];

db.exec(`
  CREATE TABLE IF NOT EXISTS claims_state (
    claim_id            TEXT PRIMARY KEY,
    status              TEXT,
    approved_amount_usd INTEGER,
    paid_at             TEXT,
    payment_ref         TEXT,
    notes               TEXT,
    updated_at          TEXT NOT NULL,
    updated_by_user_id  TEXT,
    updated_by_display  TEXT
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO claims_state (
    claim_id, status, approved_amount_usd, paid_at, payment_ref, notes,
    updated_at, updated_by_user_id, updated_by_display
  ) VALUES (
    @claim_id, @status, @approved_amount_usd, @paid_at, @payment_ref, @notes,
    @updated_at, @updated_by_user_id, @updated_by_display
  )
  ON CONFLICT (claim_id) DO UPDATE SET
    status              = COALESCE(excluded.status, claims_state.status),
    approved_amount_usd = COALESCE(excluded.approved_amount_usd, claims_state.approved_amount_usd),
    paid_at             = COALESCE(excluded.paid_at, claims_state.paid_at),
    payment_ref         = COALESCE(excluded.payment_ref, claims_state.payment_ref),
    notes               = COALESCE(excluded.notes, claims_state.notes),
    updated_at          = excluded.updated_at,
    updated_by_user_id  = excluded.updated_by_user_id,
    updated_by_display  = excluded.updated_by_display
`);
const byIdStmt = db.prepare('SELECT * FROM claims_state WHERE claim_id = ?');

function getOverride(claim_id) {
  return byIdStmt.get(claim_id) || null;
}

function transition(claim_id, { status, approved_amount_usd, payment_ref, paid_at, notes, by_user_id, by_display }) {
  if (status && !STATUSES.includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }
  upsertStmt.run({
    claim_id,
    status: status ?? null,
    approved_amount_usd: approved_amount_usd ?? null,
    paid_at: paid_at ?? null,
    payment_ref: payment_ref ?? null,
    notes: notes ?? null,
    updated_at: new Date().toISOString(),
    updated_by_user_id: by_user_id || null,
    updated_by_display: by_display || null,
  });
}

function apply(base) {
  const ov = getOverride(base.id);
  if (!ov) return { ...base, notes: base.notes_default ?? null };
  return {
    ...base,
    status:              ov.status ?? base.status,
    approved_amount_usd: ov.approved_amount_usd ?? base.approved_amount_usd,
    paid_at:             ov.paid_at ?? base.paid_at ?? null,
    payment_ref:         ov.payment_ref ?? base.payment_ref ?? null,
    notes:               ov.notes ?? base.notes_default ?? null,
    last_updated_at:     ov.updated_at,
    last_updated_by:     ov.updated_by_display,
  };
}

module.exports = { STATUSES, transition, apply, getOverride };
