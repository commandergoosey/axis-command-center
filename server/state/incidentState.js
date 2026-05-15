'use strict';

/*
 * HSE incident overlay — Phase 34.
 *
 * The HSE fixture (server/mock/compliance.js) gives a 90-day baseline of
 * three events on the corridor. Live-mode operators log incidents as
 * they happen at the weighbridge, depot, or roadside; this module
 * persists those rows and exposes a merged view to the compliance
 * route. Once a corrective action is captured, the incident moves to
 * CLOSED state — both states feed the events-per-million-tonne-km
 * readout because the regulator counts the event whether or not it's
 * been closed out.
 *
 * Schema is created idempotently here so production migration can ship
 * without touching db/index.js.
 */

const crypto = require('crypto');
const db = require('../db');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS hse_incidents (
    id                   TEXT PRIMARY KEY,
    occurred_at          TEXT NOT NULL,
    hauler_id            TEXT NOT NULL,
    truck                TEXT,
    driver               TEXT,
    category             TEXT NOT NULL,        -- 'A' | 'B'
    type                 TEXT NOT NULL,        -- 'Rollover (no injury)', 'Tyre burst', etc.
    km_marker            INTEGER,
    note                 TEXT,
    status               TEXT NOT NULL,        -- 'OPEN' | 'CLOSED'
    corrective_action    TEXT,
    closed_at            TEXT,
    closed_by_display    TEXT,
    linked_coaching_id   TEXT,
    created_by_user_id   TEXT,
    created_by_display   TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hse_occurred ON hse_incidents (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_hse_status   ON hse_incidents (status, occurred_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO hse_incidents (
    id, occurred_at, hauler_id, truck, driver, category, type, km_marker, note,
    status, corrective_action, closed_at, closed_by_display, linked_coaching_id,
    created_by_user_id, created_by_display, created_at, updated_at
  ) VALUES (
    @id, @occurred_at, @hauler_id, @truck, @driver, @category, @type, @km_marker, @note,
    @status, @corrective_action, @closed_at, @closed_by_display, @linked_coaching_id,
    @created_by_user_id, @created_by_display, @created_at, @updated_at
  )
`);

const closeStmt = db.prepare(`
  UPDATE hse_incidents SET
    status = 'CLOSED',
    corrective_action  = @corrective_action,
    closed_at          = @closed_at,
    closed_by_display  = @closed_by_display,
    linked_coaching_id = COALESCE(@linked_coaching_id, linked_coaching_id),
    updated_at         = @closed_at
  WHERE id = @id
`);

const byIdStmt   = db.prepare('SELECT * FROM hse_incidents WHERE id = ?');
const allStmt    = db.prepare('SELECT * FROM hse_incidents ORDER BY occurred_at DESC');
const sinceStmt  = db.prepare('SELECT * FROM hse_incidents WHERE occurred_at >= ? ORDER BY occurred_at DESC');

function create({
  occurred_at, hauler_id, truck, driver, category, type,
  km_marker, note, linked_coaching_id,
  created_by_user_id, created_by_display,
}) {
  if (!hauler_id) throw new Error('hauler_id required');
  if (!type)      throw new Error('type required');
  if (!['A', 'B'].includes(category)) throw new Error('category must be A or B');

  const id  = `hse-x${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date().toISOString();
  insertStmt.run({
    id,
    occurred_at: occurred_at || now,
    hauler_id,
    truck:               truck || null,
    driver:              driver || null,
    category,
    type,
    km_marker:           Number.isFinite(+km_marker) ? +km_marker : null,
    note:                note || null,
    status:              'OPEN',
    corrective_action:   null,
    closed_at:           null,
    closed_by_display:   null,
    linked_coaching_id:  linked_coaching_id || null,
    created_by_user_id:  created_by_user_id || null,
    created_by_display:  created_by_display || null,
    created_at:          now,
    updated_at:          now,
  });
  return byIdStmt.get(id);
}

function close(id, { corrective_action, closed_by_display, linked_coaching_id }) {
  if (!corrective_action || !corrective_action.trim()) {
    throw new Error('corrective_action required');
  }
  const existing = byIdStmt.get(id);
  if (!existing) throw new Error('Incident not found');
  if (existing.status === 'CLOSED') throw new Error('Incident already closed');

  closeStmt.run({
    id,
    corrective_action,
    closed_at:          new Date().toISOString(),
    closed_by_display:  closed_by_display || null,
    linked_coaching_id: linked_coaching_id || null,
  });
  return byIdStmt.get(id);
}

function findById(id) { return byIdStmt.get(id); }
function all()        { return allStmt.all(); }

function since(days = 90, now = Date.now()) {
  const cutoff = new Date(now - days * ONE_DAY_MS).toISOString();
  return sinceStmt.all(cutoff);
}

module.exports = { create, close, findById, all, since };
