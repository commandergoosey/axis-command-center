'use strict';

/*
 * Dispatcher coaching-session overlay — Phase 30.
 *
 * Every axle-load alert prescribes coaching the dispatcher on pre-
 * departure verification. This module captures that a coaching session
 * actually happened: who ran it, which dispatcher attended, which axle
 * alerts it closed, and the expected hold-rate delta afterwards.
 *
 * Two durable knobs the synth reads:
 *   - recentForHauler(haulerId, days) — alert synth uses this as a
 *     cooldown so a freshly coached hauler doesn't immediately re-open
 *     a `gen-axle-*` alert on pre-existing holds.
 *   - linkedAlertIds(sessionId) — lets the write route auto-close the
 *     exact alerts the operator linked at session creation time.
 */

const crypto = require('crypto');
const db = require('../db');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Phase 54 — additive column for per-driver attendee linkage.
// Idempotent: swallow duplicate-column errors so repeat boots are
// no-op (same pattern as Phase 48's snooze ALTER).
function addColumnIfMissing(table, name, ddl) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); }
  catch (err) { if (!/duplicate column name/i.test(err.message)) throw err; }
}
addColumnIfMissing('coaching_sessions', 'attendee_driver_ids_json', 'TEXT');

const insertStmt = db.prepare(`
  INSERT INTO coaching_sessions (
    id, hauler_id, held_at, topic, dispatcher_name, attendees_count,
    expected_delta_pct, notes, linked_alert_ids_json,
    attendee_driver_ids_json,
    created_by_user_id, created_by_display, created_at
  ) VALUES (
    @id, @hauler_id, @held_at, @topic, @dispatcher_name, @attendees_count,
    @expected_delta_pct, @notes, @linked_alert_ids_json,
    @attendee_driver_ids_json,
    @created_by_user_id, @created_by_display, @created_at
  )
`);

const byIdStmt       = db.prepare('SELECT * FROM coaching_sessions WHERE id = ?');
const forHaulerStmt  = db.prepare('SELECT * FROM coaching_sessions WHERE hauler_id = ? ORDER BY held_at DESC');
const recentStmt     = db.prepare(`SELECT * FROM coaching_sessions WHERE hauler_id = ? AND held_at >= ? ORDER BY held_at DESC LIMIT 1`);
const allStmt        = db.prepare('SELECT * FROM coaching_sessions ORDER BY held_at DESC');
const recentAllStmt  = db.prepare('SELECT * FROM coaching_sessions WHERE held_at >= ? ORDER BY held_at DESC');

function deserialise(row) {
  if (!row) return row;
  try { row.linked_alert_ids = JSON.parse(row.linked_alert_ids_json || '[]'); }
  catch { row.linked_alert_ids = []; }
  try { row.attendee_driver_ids = JSON.parse(row.attendee_driver_ids_json || '[]'); }
  catch { row.attendee_driver_ids = []; }
  return row;
}

function create({
  hauler_id, held_at, topic, dispatcher_name,
  attendees_count, expected_delta_pct, notes,
  linked_alert_ids = [],
  attendee_driver_ids = [],
  created_by_user_id, created_by_display,
}) {
  const id = `cs-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  insertStmt.run({
    id,
    hauler_id,
    held_at: held_at || now,
    topic,
    dispatcher_name: dispatcher_name || null,
    attendees_count: Number.isFinite(+attendees_count) ? +attendees_count : null,
    expected_delta_pct: Number.isFinite(+expected_delta_pct) ? +expected_delta_pct : null,
    notes: notes || null,
    linked_alert_ids_json:    JSON.stringify(linked_alert_ids),
    attendee_driver_ids_json: JSON.stringify(attendee_driver_ids),
    created_by_user_id: created_by_user_id || null,
    created_by_display: created_by_display || null,
    created_at: now,
  });
  return deserialise(byIdStmt.get(id));
}

// Phase 54 — sessions a specific driver attended. Defensive against
// pre-Phase-54 rows that have NULL attendee_driver_ids_json.
function forDriver(driverId) {
  return all().filter((s) => Array.isArray(s.attendee_driver_ids) && s.attendee_driver_ids.includes(driverId));
}

function recentForDriver(driverId, days = 90, now = Date.now()) {
  const cutoff = new Date(now - days * ONE_DAY_MS).toISOString();
  return forDriver(driverId).filter((s) => s.held_at >= cutoff);
}

function findById(id)            { return deserialise(byIdStmt.get(id)); }
function forHauler(haulerId)     { return forHaulerStmt.all(haulerId).map(deserialise); }
function all()                   { return allStmt.all().map(deserialise); }

// Was there a coaching session for this hauler within `days` of now?
// Used by the alert synthesizer as a cooldown guard.
function recentForHauler(haulerId, days = 7, now = Date.now()) {
  const cutoff = new Date(now - days * ONE_DAY_MS).toISOString();
  const row = recentStmt.get(haulerId, cutoff);
  return row ? deserialise(row) : null;
}

// All coaching sessions in the last N days, used by observation synth
// and Today-page strips.
function recentWindow(days = 7, now = Date.now()) {
  const cutoff = new Date(now - days * ONE_DAY_MS).toISOString();
  return recentAllStmt.all(cutoff).map(deserialise);
}

module.exports = {
  create, findById, forHauler, all,
  recentForHauler, recentWindow,
  forDriver, recentForDriver,
};
