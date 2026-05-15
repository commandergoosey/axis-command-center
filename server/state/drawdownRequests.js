'use strict';

/*
 * Drawdown request store — Phase 97.
 *
 * One active request slot per tranche. AXIS (admin/ops) submits when all gates
 * close; the lender desk approves, rejects, or asks for more information.
 *
 * Durable via SQLite (drawdown_requests table). Previously in-memory only;
 * now persists across server restarts.
 *
 * Lifecycle:
 *   pending        → AXIS has submitted, lender has not responded.
 *   approved       → Lender approved; drawdown proceeds.
 *   rejected       → Lender rejected; AXIS can re-submit after addressing.
 *   info_requested → Lender needs more information before deciding.
 *
 * One row per tranche — a new submission replaces the previous record
 * (allowed only when prior is rejected or info_requested).
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS drawdown_requests (
    id                 TEXT NOT NULL,
    tranche_id         TEXT PRIMARY KEY,
    status             TEXT NOT NULL,
    requested_at       TEXT NOT NULL,
    requested_by_id    TEXT,
    requested_by_name  TEXT,
    amount_usd         REAL,
    notes              TEXT NOT NULL DEFAULT '',
    responded_at       TEXT,
    responded_by_name  TEXT,
    response_note      TEXT
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO drawdown_requests
    (id, tranche_id, status, requested_at, requested_by_id, requested_by_name,
     amount_usd, notes, responded_at, responded_by_name, response_note)
  VALUES
    (@id, @tranche_id, @status, @requested_at, @requested_by_id, @requested_by_name,
     @amount_usd, @notes, @responded_at, @responded_by_name, @response_note)
  ON CONFLICT (tranche_id) DO UPDATE SET
    id                = excluded.id,
    status            = excluded.status,
    requested_at      = excluded.requested_at,
    requested_by_id   = excluded.requested_by_id,
    requested_by_name = excluded.requested_by_name,
    amount_usd        = excluded.amount_usd,
    notes             = excluded.notes,
    responded_at      = excluded.responded_at,
    responded_by_name = excluded.responded_by_name,
    response_note     = excluded.response_note
`);

const updateStmt = db.prepare(`
  UPDATE drawdown_requests SET
    status            = @status,
    responded_at      = @responded_at,
    responded_by_name = @responded_by_name,
    response_note     = @response_note
  WHERE tranche_id = @tranche_id
`);

const byTrancheStmt = db.prepare('SELECT * FROM drawdown_requests WHERE tranche_id = ?');

function shape(row) {
  if (!row) return null;
  return {
    id:                row.id,
    tranche_id:        row.tranche_id,
    status:            row.status,
    requested_at:      row.requested_at,
    requested_by_id:   row.requested_by_id   ?? null,
    requested_by_name: row.requested_by_name ?? null,
    amount_usd:        row.amount_usd        ?? null,
    notes:             row.notes             ?? '',
    responded_at:      row.responded_at      ?? null,
    responded_by_name: row.responded_by_name ?? null,
    response_note:     row.response_note     ?? null,
  };
}

function get(trancheId) {
  return shape(byTrancheStmt.get(trancheId));
}

/*
 * submit — creates or replaces a request.
 * Allowed when: no prior request, or prior is rejected, or lender requested info.
 */
function submit({ trancheId, userId, userName, amountUsd, notes }) {
  const existing = get(trancheId);
  if (existing && existing.status === 'pending') {
    throw new Error('A drawdown request is already pending for this tranche');
  }
  if (existing && existing.status === 'approved') {
    throw new Error('Drawdown already approved for this tranche');
  }

  const req = {
    id:                `dr-${trancheId}-${Date.now()}`,
    tranche_id:        trancheId,
    status:            'pending',
    requested_at:      new Date().toISOString(),
    requested_by_id:   userId   ?? null,
    requested_by_name: userName ?? null,
    amount_usd:        amountUsd ?? null,
    notes:             notes || '',
    responded_at:      null,
    responded_by_name: null,
    response_note:     null,
  };

  upsertStmt.run(req);
  return shape(byTrancheStmt.get(trancheId));
}

/*
 * respond — lender action.
 * status must be 'approved' | 'rejected' | 'info_requested'.
 */
function respond({ trancheId, status, respondedByName, responseNote }) {
  const req = get(trancheId);
  if (!req) throw new Error('No drawdown request found for this tranche');
  if (req.status !== 'pending') throw new Error(`Request is already in '${req.status}' state`);

  const VALID = ['approved', 'rejected', 'info_requested'];
  if (!VALID.includes(status)) throw new Error(`Invalid response status: ${status}`);

  updateStmt.run({
    tranche_id:        trancheId,
    status,
    responded_at:      new Date().toISOString(),
    responded_by_name: respondedByName ?? null,
    response_note:     responseNote    ?? '',
  });
  return shape(byTrancheStmt.get(trancheId));
}

module.exports = { get, submit, respond };
