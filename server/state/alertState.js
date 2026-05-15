'use strict';

/*
 * Alert triage state — SQLite-backed as of Phase 25. Durable across server
 * restarts. Module surface is unchanged from the original in-memory version
 * so route handlers don't care.
 *
 * Status overrides, assignments, snoozes, and note threads all live here.
 * The unified audit trail (db/audit.js) is invoked from the route layer
 * rather than here — keeps this module narrow to state mutations.
 */

const db = require('../db');

const upsertStmt = db.prepare(`
  INSERT INTO alert_state (
    alert_id, status_override, assignee_user_id, assignee_display, assignee_role,
    snooze_until_iso, resolved_at_iso, resolved_by_display, resolution_note,
    notes_json, updated_at
  ) VALUES (
    @alert_id, @status_override, @assignee_user_id, @assignee_display, @assignee_role,
    @snooze_until_iso, @resolved_at_iso, @resolved_by_display, @resolution_note,
    @notes_json, @updated_at
  )
  ON CONFLICT(alert_id) DO UPDATE SET
    status_override     = excluded.status_override,
    assignee_user_id    = excluded.assignee_user_id,
    assignee_display    = excluded.assignee_display,
    assignee_role       = excluded.assignee_role,
    snooze_until_iso    = excluded.snooze_until_iso,
    resolved_at_iso     = excluded.resolved_at_iso,
    resolved_by_display = excluded.resolved_by_display,
    resolution_note     = excluded.resolution_note,
    notes_json          = excluded.notes_json,
    updated_at          = excluded.updated_at
`);

const selectStmt = db.prepare('SELECT * FROM alert_state WHERE alert_id = ?');
const clearStmt  = db.prepare('DELETE FROM alert_state');

function blank() {
  return {
    status_override:     null,
    assignee_user_id:    null,
    assignee_display:    null,
    assignee_role:       null,
    snooze_until_iso:    null,
    resolved_at_iso:     null,
    resolved_by_display: null,
    resolution_note:     null,
    notes:               [],
  };
}

function rowToState(row) {
  if (!row) return blank();
  return {
    status_override:     row.status_override,
    assignee_user_id:    row.assignee_user_id,
    assignee_display:    row.assignee_display,
    assignee_role:       row.assignee_role,
    snooze_until_iso:    row.snooze_until_iso,
    resolved_at_iso:     row.resolved_at_iso,
    resolved_by_display: row.resolved_by_display,
    resolution_note:     row.resolution_note,
    notes:               row.notes_json ? JSON.parse(row.notes_json) : [],
  };
}

function getState(alertId) {
  return rowToState(selectStmt.get(alertId));
}

function write(alertId, next) {
  upsertStmt.run({
    alert_id:            alertId,
    status_override:     next.status_override ?? null,
    assignee_user_id:    next.assignee_user_id ?? null,
    assignee_display:    next.assignee_display ?? null,
    assignee_role:       next.assignee_role ?? null,
    snooze_until_iso:    next.snooze_until_iso ?? null,
    resolved_at_iso:     next.resolved_at_iso ?? null,
    resolved_by_display: next.resolved_by_display ?? null,
    resolution_note:     next.resolution_note ?? null,
    notes_json:          JSON.stringify(next.notes ?? []),
    updated_at:          new Date().toISOString(),
  });
  return next;
}

function setState(alertId, patch) {
  const prev = getState(alertId);
  return write(alertId, { ...prev, ...patch });
}

function addNote(alertId, { body, by_user_id, by_display, by_role }) {
  const prev = getState(alertId);
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    body,
    created_at_iso: new Date().toISOString(),
    by_user_id,
    by_display,
    by_role,
  };
  write(alertId, { ...prev, notes: [...prev.notes, note] });
  return note;
}

function resolve(alertId, { by_display, note }) {
  return setState(alertId, {
    status_override:     'RESOLVED',
    resolved_at_iso:     new Date().toISOString(),
    resolved_by_display: by_display,
    resolution_note:     note || null,
    snooze_until_iso:    null,
  });
}

function snooze(alertId, { until_iso }) {
  return setState(alertId, {
    status_override:  'SNOOZED',
    snooze_until_iso: until_iso,
  });
}

function reopen(alertId) {
  return setState(alertId, {
    status_override:     null,
    resolved_at_iso:     null,
    resolved_by_display: null,
    resolution_note:     null,
    snooze_until_iso:    null,
  });
}

function assign(alertId, { user_id, display_name, role }) {
  return setState(alertId, {
    assignee_user_id: user_id || null,
    assignee_display: display_name || null,
    assignee_role:    role || null,
  });
}

function reset() {
  clearStmt.run();
}

module.exports = {
  getState, setState, addNote,
  resolve, snooze, reopen, assign,
  reset,
};
