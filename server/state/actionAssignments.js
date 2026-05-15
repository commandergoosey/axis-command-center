'use strict';

/*
 * Action item assignments — Phase 45.
 *
 * Action items themselves are SYNTHESIZED on every /api/today call from
 * live corridor state — they don't live in a table, so we can't add an
 * `assigned_to` column. Instead this module is an overlay table keyed
 * to the synthetic action item IDs (`act-…`). When the synth re-emits
 * an item with the same stable ID, the overlay re-attaches.
 *
 * If the underlying entity resolves (filing marked filed, licence
 * renewed, alert closed), the synth stops emitting that ID and the
 * assignment row is left orphaned — harmless, and useful as a paper
 * trail for "this person owned closing this last week." We never
 * delete; we keep history. The cockpit only reads back rows whose IDs
 * are still in the live action items feed.
 *
 * Schema is created idempotently here so prod can ship without
 * touching db/index.js, matching every other Phase 30+ overlay.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS action_item_assignments (
    action_item_id          TEXT PRIMARY KEY,
    assignee_user_id        TEXT NOT NULL,
    assignee_display_name   TEXT NOT NULL,
    assignee_role           TEXT NOT NULL,
    due_date                TEXT,                 -- 'YYYY-MM-DD' or null
    notes                   TEXT,
    assigned_at             TEXT NOT NULL,
    assigned_by_user_id     TEXT,
    assigned_by_display     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_aia_assignee ON action_item_assignments (assignee_user_id);
  CREATE INDEX IF NOT EXISTS idx_aia_due_date ON action_item_assignments (due_date);
`);

// Phase 48 — additive snooze columns. ALTER ... ADD COLUMN is idempotent
// in SQLite when wrapped against the column-list because it errors on
// duplicates; we swallow that one specific error so prod migrations
// stay no-op on subsequent boots.
function addColumnIfMissing(table, name, ddl) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}
addColumnIfMissing('action_item_assignments', 'snoozed_until',     'TEXT');
addColumnIfMissing('action_item_assignments', 'snooze_reason',     'TEXT');
addColumnIfMissing('action_item_assignments', 'snoozed_at',        'TEXT');
addColumnIfMissing('action_item_assignments', 'snoozed_by_user_id','TEXT');
addColumnIfMissing('action_item_assignments', 'snoozed_by_display','TEXT');
// Phase 61 — escalation tracking. `escalated_at` set when the system
// auto-escalates an overdue+assigned item to admins. Latch — once set,
// stays set until the assignment is removed; we don't re-escalate the
// same item twice. `acknowledged_at` is admin's "I've seen it" stamp.
addColumnIfMissing('action_item_assignments', 'escalated_at',          'TEXT');
addColumnIfMissing('action_item_assignments', 'escalation_acknowledged_at', 'TEXT');

const upsertStmt = db.prepare(`
  INSERT INTO action_item_assignments (
    action_item_id, assignee_user_id, assignee_display_name, assignee_role,
    due_date, notes, assigned_at, assigned_by_user_id, assigned_by_display
  ) VALUES (
    @action_item_id, @assignee_user_id, @assignee_display_name, @assignee_role,
    @due_date, @notes, @assigned_at, @assigned_by_user_id, @assigned_by_display
  )
  ON CONFLICT(action_item_id) DO UPDATE SET
    assignee_user_id      = excluded.assignee_user_id,
    assignee_display_name = excluded.assignee_display_name,
    assignee_role         = excluded.assignee_role,
    due_date              = excluded.due_date,
    notes                 = excluded.notes,
    assigned_at           = excluded.assigned_at,
    assigned_by_user_id   = excluded.assigned_by_user_id,
    assigned_by_display   = excluded.assigned_by_display
`);

const deleteStmt = db.prepare('DELETE FROM action_item_assignments WHERE action_item_id = ?');
const byIdStmt   = db.prepare('SELECT * FROM action_item_assignments WHERE action_item_id = ?');
const allStmt    = db.prepare('SELECT * FROM action_item_assignments');
const byUserStmt = db.prepare(
  'SELECT * FROM action_item_assignments WHERE assignee_user_id = ? ORDER BY due_date ASC, assigned_at DESC',
);

function deserialise(row) {
  if (!row) return null;
  return {
    action_item_id:        row.action_item_id,
    assignee:              {
      user_id:      row.assignee_user_id,
      display_name: row.assignee_display_name,
      role:         row.assignee_role,
    },
    due_date:              row.due_date,
    notes:                 row.notes,
    assigned_at:           row.assigned_at,
    assigned_by: {
      user_id:      row.assigned_by_user_id,
      display_name: row.assigned_by_display,
    },
    // Phase 48 — snooze envelope. `snoozed_until` is the wake-up date;
    // when it's in the future we treat the item as snoozed. UI uses
    // `snooze` block so consumers don't have to know the column names.
    snooze: row.snoozed_until ? {
      until:        row.snoozed_until,
      reason:       row.snooze_reason,
      snoozed_at:   row.snoozed_at,
      snoozed_by: {
        user_id:      row.snoozed_by_user_id,
        display_name: row.snoozed_by_display,
      },
    } : null,
    // Phase 61 — escalation envelope. Set when the system auto-escalates
    // an overdue+assigned item; the acknowledged_at stamp is the
    // admin's "I've seen it" marker.
    escalation: row.escalated_at ? {
      escalated_at:     row.escalated_at,
      acknowledged_at:  row.escalation_acknowledged_at,
    } : null,
  };
}

function assign({
  action_item_id, assignee_user_id, assignee_display_name, assignee_role,
  due_date, notes, assigned_by_user_id, assigned_by_display,
}) {
  if (!action_item_id) throw new Error('action_item_id required');
  if (!assignee_user_id) throw new Error('assignee_user_id required');
  upsertStmt.run({
    action_item_id,
    assignee_user_id,
    assignee_display_name: assignee_display_name || assignee_user_id,
    assignee_role:         assignee_role || 'axis_ops',
    due_date:              due_date || null,
    notes:                 notes || null,
    assigned_at:           new Date().toISOString(),
    assigned_by_user_id:   assigned_by_user_id || null,
    assigned_by_display:   assigned_by_display || null,
  });
  return deserialise(byIdStmt.get(action_item_id));
}

function unassign(action_item_id) {
  deleteStmt.run(action_item_id);
}

// Phase 48 — snooze writes use prepared statements compiled lazily so
// the older deployments that booted before the columns existed don't
// fail at module load.
const snoozeStmt = db.prepare(`
  UPDATE action_item_assignments SET
    snoozed_until        = @snoozed_until,
    snooze_reason        = @snooze_reason,
    snoozed_at           = @snoozed_at,
    snoozed_by_user_id   = @snoozed_by_user_id,
    snoozed_by_display   = @snoozed_by_display
  WHERE action_item_id = @action_item_id
`);

function snooze({ action_item_id, until, reason, by_user_id, by_display }) {
  if (!until) throw new Error('snooze `until` required');
  const existing = byIdStmt.get(action_item_id);
  if (!existing) throw new Error('Cannot snooze an unassigned item');
  snoozeStmt.run({
    action_item_id,
    snoozed_until:      until,
    snooze_reason:      reason || null,
    snoozed_at:         new Date().toISOString(),
    snoozed_by_user_id: by_user_id || null,
    snoozed_by_display: by_display || null,
  });
  return deserialise(byIdStmt.get(action_item_id));
}

function unsnooze(action_item_id) {
  snoozeStmt.run({
    action_item_id,
    snoozed_until:      null,
    snooze_reason:      null,
    snoozed_at:         null,
    snoozed_by_user_id: null,
    snoozed_by_display: null,
  });
  return deserialise(byIdStmt.get(action_item_id));
}

function findById(action_item_id) {
  return deserialise(byIdStmt.get(action_item_id));
}

function all() {
  return allStmt.all().map(deserialise);
}

// Map of action_item_id → assignment, for cheap O(1) lookup during
// per-request synth — caller does this once and joins inline.
function map() {
  const m = {};
  for (const a of all()) m[a.action_item_id] = a;
  return m;
}

function forUser(userId) {
  return byUserStmt.all(userId).map(deserialise);
}

// Phase 61 — escalation marks. `markEscalated` is called by the
// scheduler-equivalent (opportunistic check on /api/today reads).
// `acknowledgeEscalation` is called when an admin clicks the badge.
const escalateStmt = db.prepare(
  'UPDATE action_item_assignments SET escalated_at = @ts WHERE action_item_id = @id AND escalated_at IS NULL',
);
const ackStmt = db.prepare(
  'UPDATE action_item_assignments SET escalation_acknowledged_at = @ts WHERE action_item_id = @id',
);

function markEscalated(action_item_id, ts = new Date().toISOString()) {
  const result = escalateStmt.run({ id: action_item_id, ts });
  return result.changes > 0; // true if this is the first escalation
}

function acknowledgeEscalation(action_item_id, ts = new Date().toISOString()) {
  ackStmt.run({ id: action_item_id, ts });
}

module.exports = {
  assign, unassign, snooze, unsnooze,
  markEscalated, acknowledgeEscalation,
  findById, all, map, forUser,
};
