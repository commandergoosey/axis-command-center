'use strict';

/*
 * Personal pins — Phase 78.
 *
 * Each user can pin haulers, risks, alerts, hauler contacts, or
 * filings to a personal watchlist. Pins are refs (entity_type +
 * entity_id), not snapshots — every read hydrates against the
 * source primitive so a pinned risk row reflects today's
 * severity, today's step progress, today's review staleness.
 *
 * Pins are personal, not shared. Lender's pins live alongside
 * Akosua's; one user can't see another user's pinboard.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

const PINNABLE_TYPES = ['hauler', 'risk', 'alert', 'contact', 'filing'];

db.exec(`
  CREATE TABLE IF NOT EXISTS user_pins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    label         TEXT,
    pinned_at     TEXT NOT NULL,
    UNIQUE (user_id, entity_type, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_pins_user
    ON user_pins (user_id, pinned_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO user_pins (user_id, entity_type, entity_id, label, pinned_at)
       VALUES (@user_id, @entity_type, @entity_id, @label, @pinned_at)
  ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET
       pinned_at = excluded.pinned_at,
       label     = COALESCE(excluded.label, user_pins.label)
`);
const deleteStmt = db.prepare(
  'DELETE FROM user_pins WHERE id = ? AND user_id = ?',
);
const deleteByRefStmt = db.prepare(
  'DELETE FROM user_pins WHERE user_id = ? AND entity_type = ? AND entity_id = ?',
);
const forUserStmt = db.prepare(`
  SELECT * FROM user_pins
   WHERE user_id = ?
   ORDER BY pinned_at ASC, id ASC
`);
const isPinnedStmt = db.prepare(`
  SELECT id FROM user_pins
   WHERE user_id = ? AND entity_type = ? AND entity_id = ?
`);

function shape(row) {
  if (!row) return null;
  return {
    id:          row.id,
    entity_type: row.entity_type,
    entity_id:   row.entity_id,
    label:       row.label,
    pinned_at:   row.pinned_at,
  };
}

function add({ user_id, entity_type, entity_id, label }) {
  if (!user_id) throw new Error('user_id required');
  if (!PINNABLE_TYPES.includes(entity_type)) {
    throw new Error(`Cannot pin entity_type "${entity_type}". Pinnable: ${PINNABLE_TYPES.join(', ')}.`);
  }
  if (!entity_id) throw new Error('entity_id required');
  insertStmt.run({
    user_id,
    entity_type,
    entity_id:  String(entity_id),
    label:      label ? label.toString().slice(0, 200) : null,
    pinned_at:  new Date().toISOString(),
  });
  return shape(isPinnedStmt.get(user_id, entity_type, String(entity_id)) ? forUserStmt.all(user_id).find((p) => p.entity_type === entity_type && p.entity_id === String(entity_id)) : null);
}

function removeById(id, user_id) {
  deleteStmt.run(id, user_id);
}

function removeByRef(user_id, entity_type, entity_id) {
  deleteByRefStmt.run(user_id, entity_type, String(entity_id));
}

function forUser(user_id) {
  return forUserStmt.all(user_id).map(shape);
}

function isPinned(user_id, entity_type, entity_id) {
  return !!isPinnedStmt.get(user_id, entity_type, String(entity_id));
}

module.exports = {
  PINNABLE_TYPES,
  add, removeById, removeByRef,
  forUser, isPinned,
};
