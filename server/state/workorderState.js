'use strict';

/*
 * Maintenance workorder overlay — Phase 29.
 *
 * Rigs carry a `maintenance_flag` in the FLEET fixture (critical /
 * service_due / road_worthy_30d). This module tracks workorders
 * against those rigs so "critical" doesn't mean "nobody's doing
 * anything" forever — once a workorder is OPEN or IN_PROGRESS the
 * alert synth treats the rig as being remediated and the cluster
 * alert stops shouting.
 *
 * Lifecycle: OPEN → IN_PROGRESS → RESOLVED.
 * Every transition is durable in SQLite and audited at the route
 * layer. No implicit state machine — each transition is its own
 * route so the audit summary can describe what actually happened.
 */

const crypto = require('crypto');
const db = require('../db');

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

const insertStmt = db.prepare(`
  INSERT INTO workorders (
    id, rig_id, hauler_id, title,
    opened_at, opened_by_user_id, opened_by_display,
    status, updated_at
  ) VALUES (
    @id, @rig_id, @hauler_id, @title,
    @opened_at, @opened_by_user_id, @opened_by_display,
    @status, @updated_at
  )
`);

const updateStmt = db.prepare(`
  UPDATE workorders SET
    status              = @status,
    progress_note       = COALESCE(@progress_note, progress_note),
    progress_at         = COALESCE(@progress_at, progress_at),
    progress_by_display = COALESCE(@progress_by_display, progress_by_display),
    resolution_note     = COALESCE(@resolution_note, resolution_note),
    resolved_at         = COALESCE(@resolved_at, resolved_at),
    resolved_by_display = COALESCE(@resolved_by_display, resolved_by_display),
    cost_usd            = COALESCE(@cost_usd, cost_usd),
    hours               = COALESCE(@hours, hours),
    updated_at          = @updated_at
  WHERE id = @id
`);

const byIdStmt       = db.prepare('SELECT * FROM workorders WHERE id = ?');
const byRigStmt      = db.prepare('SELECT * FROM workorders WHERE rig_id = ? ORDER BY opened_at DESC');
const openByRigStmt  = db.prepare(`SELECT * FROM workorders WHERE rig_id = ? AND status != 'RESOLVED' ORDER BY opened_at DESC`);
const allOpenStmt    = db.prepare(`SELECT * FROM workorders WHERE status != 'RESOLVED'`);
const allStmt        = db.prepare('SELECT * FROM workorders ORDER BY opened_at DESC');

function open({ rig_id, hauler_id, title, opened_by_user_id, opened_by_display }) {
  const id  = `wo-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  insertStmt.run({
    id,
    rig_id,
    hauler_id: hauler_id || null,
    title,
    opened_at: now,
    opened_by_user_id: opened_by_user_id || null,
    opened_by_display: opened_by_display || null,
    status: 'OPEN',
    updated_at: now,
  });
  return byIdStmt.get(id);
}

function progress(id, { note, by_display }) {
  const now = new Date().toISOString();
  updateStmt.run({
    id,
    status: 'IN_PROGRESS',
    progress_note: note || null,
    progress_at: now,
    progress_by_display: by_display || null,
    resolution_note: null,
    resolved_at: null,
    resolved_by_display: null,
    cost_usd: null,
    hours: null,
    updated_at: now,
  });
  return byIdStmt.get(id);
}

function resolve(id, { note, by_display, cost_usd, hours }) {
  const now = new Date().toISOString();
  updateStmt.run({
    id,
    status: 'RESOLVED',
    progress_note: null,
    progress_at: null,
    progress_by_display: null,
    resolution_note: note || null,
    resolved_at: now,
    resolved_by_display: by_display || null,
    cost_usd: cost_usd ?? null,
    hours: hours ?? null,
    updated_at: now,
  });
  return byIdStmt.get(id);
}

function findById(id)          { return byIdStmt.get(id) || null; }
function forRig(rigId)         { return byRigStmt.all(rigId); }
function openForRig(rigId)     { return openByRigStmt.all(rigId); }
function allOpen()             { return allOpenStmt.all(); }
function all()                 { return allStmt.all(); }

// Cluster helper — returns the set of rig IDs that currently have a
// non-resolved workorder. alertSynth / observationSynth use this to
// exclude remediated rigs from the cluster thresholds.
function rigsInRemediation() {
  return new Set(allOpen().map((w) => w.rig_id));
}

module.exports = {
  STATUSES,
  open, progress, resolve,
  findById, forRig, openForRig, allOpen, all,
  rigsInRemediation,
};
