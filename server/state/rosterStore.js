'use strict';

/*
 * rosterStore — Phase 109.
 *
 * SQLite persistence for haulers onboarded via the UI. Mock haulers from
 * mock/haulers.js are immutable fixtures; this table captures only those
 * created at runtime via POST /api/haulers. On boot, roster.js loads
 * rows from here and merges them with the mock set so they survive
 * server restarts.
 *
 * Also tracks mutable fields (contact, planned start, status) for
 * persisted haulers — axis_admin / axis_ops can patch these after creation.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS hauler_records (
    id                 TEXT PRIMARY KEY,
    display_name       TEXT NOT NULL,
    onboarded_date     TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    integration_type   TEXT NOT NULL DEFAULT 'manual',
    contracted_trucks  INTEGER NOT NULL DEFAULT 0,
    contact_name       TEXT,
    contact_email      TEXT,
    contract_share_pct REAL,
    planned_start_date TEXT,
    activated_at       TEXT,
    created_at         TEXT NOT NULL
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO hauler_records
    (id, display_name, onboarded_date, status, integration_type,
     contracted_trucks, contact_name, contact_email, contract_share_pct,
     planned_start_date, created_at)
  VALUES
    (@id, @display_name, @onboarded_date, @status, @integration_type,
     @contracted_trucks, @contact_name, @contact_email, @contract_share_pct,
     @planned_start_date, @created_at)
`);

const updateStmt = db.prepare(`
  UPDATE hauler_records SET
    display_name       = COALESCE(@display_name,       display_name),
    contracted_trucks  = COALESCE(@contracted_trucks,  contracted_trucks),
    contact_name       = @contact_name,
    contact_email      = @contact_email,
    contract_share_pct = @contract_share_pct,
    planned_start_date = @planned_start_date,
    status             = COALESCE(@status,             status),
    activated_at       = COALESCE(@activated_at,       activated_at)
  WHERE id = @id
`);

const allStmt   = db.prepare('SELECT * FROM hauler_records ORDER BY created_at');
const byIdStmt  = db.prepare('SELECT * FROM hauler_records WHERE id = ?');

// ── Shape ─────────────────────────────────────────────────────────────────────

/**
 * Convert a DB row back to the hauler object shape expected by roster.js
 * and the aggregator service.
 */
function deserialise(row) {
  return {
    id:                 row.id,
    display_name:       row.display_name,
    onboarded_date:     row.onboarded_date,
    status:             row.status,
    contact_name:       row.contact_name   ?? null,
    contact_email:      row.contact_email  ?? null,
    contract_share_pct: row.contract_share_pct ?? null,
    planned_start_date: row.planned_start_date ?? null,
    activated_at:       row.activated_at   ?? null,
    integration: {
      type:            row.integration_type,
      adapter:         null,
      last_sync:       null,
      error_count_24h: row.integration_type === 'manual' ? null : 0,
    },
    fleet:       { contracted_trucks: row.contracted_trucks, active_trucks: 0 },
    performance: { on_time_pct: 0, sla_attainment_pct: 0, safety_score: 0 },
    run_rate:    0,
    _persisted:  true,   // sentinel so roster.update() knows this row exists in DB
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

function add(hauler) {
  insertStmt.run({
    id:                 hauler.id,
    display_name:       hauler.display_name,
    onboarded_date:     hauler.onboarded_date,
    status:             hauler.status            ?? 'pending',
    integration_type:   hauler.integration?.type ?? 'manual',
    contracted_trucks:  hauler.fleet?.contracted_trucks ?? 0,
    contact_name:       hauler.contact_name      ?? null,
    contact_email:      hauler.contact_email     ?? null,
    contract_share_pct: hauler.contract_share_pct ?? null,
    planned_start_date: hauler.planned_start_date ?? null,
    created_at:         new Date().toISOString(),
  });
  return deserialise(byIdStmt.get(hauler.id));
}

function update(id, fields) {
  updateStmt.run({
    id,
    display_name:       fields.display_name       ?? null,
    contracted_trucks:  fields.contracted_trucks != null ? Number(fields.contracted_trucks) : null,
    contact_name:       fields.contact_name       ?? null,
    contact_email:      fields.contact_email      ?? null,
    contract_share_pct: fields.contract_share_pct ?? null,
    planned_start_date: fields.planned_start_date ?? null,
    status:             fields.status             ?? null,
    activated_at:       fields.activated_at       ?? null,
  });
  const row = byIdStmt.get(id);
  return row ? deserialise(row) : null;
}

function all() {
  return allStmt.all().map(deserialise);
}

function find(id) {
  const row = byIdStmt.get(id);
  return row ? deserialise(row) : null;
}

module.exports = { add, update, all, find };
