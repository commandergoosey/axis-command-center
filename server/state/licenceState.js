'use strict';

/*
 * Driver licence renewal overlay — Phase 33.
 *
 * The LICENCE_EXPIRY fixture in server/mock/compliance.js declares the
 * 90-day regulatory pipeline (Class E licences + medical certificates
 * coming due on the corridor roster). Once Ops escorts a driver through
 * a DVLA renewal they record the new expiry here; `days_remaining` is
 * then recomputed live against the server clock and the row either
 * drops out of the pipeline or re-appears further out.
 *
 * Every renewal is captured by the unified audit log (see routes/
 * compliance.js), so the regulator can reconstruct "who renewed what,
 * when, and under which reference number" months later.
 *
 * Schema lives alongside the other overlays in server/db/index.js.
 */

const db = require('../db');

// Idempotent — schema files add this on every boot so prod can ship
// the migration without touching db/index.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS licence_state (
    licence_id   TEXT PRIMARY KEY,
    expiry_iso   TEXT NOT NULL,
    ref_number   TEXT,
    renewed_at   TEXT NOT NULL,
    renewed_by   TEXT,
    note         TEXT,
    updated_at   TEXT NOT NULL
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO licence_state (licence_id, expiry_iso, ref_number, renewed_at, renewed_by, note, updated_at)
  VALUES (@licence_id, @expiry_iso, @ref_number, @renewed_at, @renewed_by, @note, @updated_at)
  ON CONFLICT(licence_id) DO UPDATE SET
    expiry_iso = excluded.expiry_iso,
    ref_number = excluded.ref_number,
    renewed_at = excluded.renewed_at,
    renewed_by = excluded.renewed_by,
    note       = excluded.note,
    updated_at = excluded.updated_at
`);

const selectStmt = db.prepare('SELECT * FROM licence_state WHERE licence_id = ?');
const listStmt   = db.prepare('SELECT * FROM licence_state');

function getState(licenceId) {
  return selectStmt.get(licenceId) ?? null;
}

function all() {
  return listStmt.all();
}

function renew(licenceId, { expiry_iso, ref_number, renewed_by, note }) {
  const now = new Date().toISOString();
  upsertStmt.run({
    licence_id: licenceId,
    expiry_iso,
    ref_number: ref_number || null,
    renewed_at: now,
    renewed_by: renewed_by || null,
    note:       note || null,
    updated_at: now,
  });
  return {
    licence_id: licenceId,
    expiry_iso,
    ref_number: ref_number || null,
    renewed_at: now,
    renewed_by: renewed_by || null,
    note: note || null,
  };
}

module.exports = { getState, all, renew };
