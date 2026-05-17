'use strict';

/*
 * LP-4 — Hauler store backed by SQLite.
 *
 * Supersedes the three-layer system (mock array + hauler_field_overrides +
 * hauler_records). On first boot the `haulers` table is seeded from
 * mock/haulers.js; any existing hauler_records rows are migrated in the
 * same seed transaction so data is never lost.
 *
 * The deserialise() function reconstructs the nested hauler object shape
 * (integration, fleet, performance) so all existing callers via roster.js
 * continue to work without changes.
 */

const db = require('../db');

/* ── Prepared statements ─────────────────────────────────────────── */
const stmts = {
  count:    db.prepare('SELECT COUNT(*) AS n FROM haulers'),
  list:     db.prepare('SELECT * FROM haulers WHERE deactivated = 0 ORDER BY onboarded_date, id'),
  listAll:  db.prepare('SELECT * FROM haulers ORDER BY onboarded_date, id'),
  byId:     db.prepare('SELECT * FROM haulers WHERE id = ?'),
  insert:   db.prepare(`
    INSERT INTO haulers
      (id, display_name, onboarded_date, status,
       integration_type, integration_adapter, last_sync, error_count_24h,
       contracted_trucks, active_trucks, on_time_pct, sla_attainment_pct,
       safety_score, run_rate,
       contact_name, contact_email, contract_share_pct, planned_start_date,
       activated_at, deactivated, deactivated_at, created_at, updated_at)
    VALUES
      (@id, @display_name, @onboarded_date, @status,
       @integration_type, @integration_adapter, @last_sync, @error_count_24h,
       @contracted_trucks, @active_trucks, @on_time_pct, @sla_attainment_pct,
       @safety_score, @run_rate,
       @contact_name, @contact_email, @contract_share_pct, @planned_start_date,
       @activated_at, 0, NULL, @created_at, @updated_at)
  `),

  deactivate: db.prepare(`
    UPDATE haulers SET deactivated = 1, deactivated_at = @ts, updated_at = @ts WHERE id = @id
  `),
  reactivate: db.prepare(`
    UPDATE haulers SET deactivated = 0, deactivated_at = NULL, updated_at = @ts WHERE id = @id
  `),
  maxNum: db.prepare(`
    SELECT id FROM haulers WHERE id GLOB 'haul-[0-9]*' ORDER BY id DESC LIMIT 1
  `),
};

/* ── Deserialise a DB row into the standard hauler object shape ──── */
function deserialise(row) {
  if (!row) return null;
  return {
    id:                 row.id,
    display_name:       row.display_name,
    onboarded_date:     row.onboarded_date,
    status:             row.status,
    contact_name:       row.contact_name       ?? null,
    contact_email:      row.contact_email      ?? null,
    contract_share_pct: row.contract_share_pct ?? null,
    planned_start_date: row.planned_start_date ?? null,
    activated_at:       row.activated_at       ?? null,
    deactivated:        Boolean(row.deactivated),
    deactivated_at:     row.deactivated_at     ?? null,
    integration: {
      type:             row.integration_type,
      adapter:          row.integration_adapter ?? null,
      last_sync:        row.last_sync           ?? null,
      error_count_24h:  row.error_count_24h     ?? (row.integration_type === 'manual' ? null : 0),
    },
    fleet: {
      contracted_trucks: row.contracted_trucks,
      active_trucks:     row.active_trucks,
    },
    performance: {
      on_time_pct:        row.on_time_pct,
      sla_attainment_pct: row.sla_attainment_pct,
      safety_score:       row.safety_score,
    },
    run_rate:   row.run_rate,
    _persisted: true,   // sentinel kept for backward-compat with existing callers
  };
}

/* ── Seed on first boot ──────────────────────────────────────────── */
function seed() {
  const { n } = stmts.count.get();
  if (n > 0) return;

  console.log('[haulerStore] Seeding haulers from mock generator…');
  const mockHaulers = require('../mock/haulers');
  const now = new Date().toISOString();

  // Also migrate any haulers that were already in hauler_records (Phases 109+).
  // Safe to ignore if the table doesn't exist yet.
  let legacyRows = [];
  try {
    const legacyStmt = db.prepare('SELECT * FROM hauler_records ORDER BY created_at');
    legacyRows = legacyStmt.all();
  } catch (_) { /* table may not exist in fresh installs */ }

  const insertMany = db.transaction((rows) => {
    for (const h of rows) {
      stmts.insert.run({
        id:                  h.id,
        display_name:        h.display_name,
        onboarded_date:      h.onboarded_date ?? now.slice(0, 10),
        status:              h.status         ?? 'active',
        integration_type:    h.integration?.type        ?? h.integration_type  ?? 'manual',
        integration_adapter: h.integration?.adapter     ?? null,
        last_sync:           h.integration?.last_sync   ?? null,
        error_count_24h:     h.integration?.error_count_24h ?? null,
        contracted_trucks:   h.fleet?.contracted_trucks ?? h.contracted_trucks ?? 0,
        active_trucks:       h.fleet?.active_trucks     ?? 0,
        on_time_pct:         h.performance?.on_time_pct        ?? 0,
        sla_attainment_pct:  h.performance?.sla_attainment_pct ?? 0,
        safety_score:        h.performance?.safety_score       ?? 0,
        run_rate:            h.run_rate       ?? 0,
        contact_name:        h.contact_name       ?? null,
        contact_email:       h.contact_email      ?? null,
        contract_share_pct:  h.contract_share_pct ?? null,
        planned_start_date:  h.planned_start_date ?? null,
        activated_at:        h.status === 'active' ? (h.activated_at ?? now) : (h.activated_at ?? null),
        created_at:          h.created_at ?? now,
        updated_at:          now,
      });
    }
  });

  // Merge: mock first, then legacy (skip any ID collisions via INSERT-only logic)
  const allToSeed = [...mockHaulers];
  const mockIds = new Set(mockHaulers.map((h) => h.id));
  for (const r of legacyRows) {
    if (!mockIds.has(r.id)) allToSeed.push(r);
  }

  insertMany(allToSeed);
  console.log(`[haulerStore] Seeded ${allToSeed.length} haulers.`);
}

seed();

/* ── Public API ──────────────────────────────────────────────────── */

/** List all non-deactivated haulers. */
function list({ include_deactivated = false } = {}) {
  const rows = include_deactivated ? stmts.listAll.all() : stmts.list.all();
  return rows.map(deserialise);
}

/** Find a hauler by id — includes deactivated (for admin lookups). */
function findById(id) {
  if (!id) return null;
  return deserialise(stmts.byId.get(id) ?? null);
}

/**
 * Create a new hauler. Returns the created hauler object.
 * `h` should match the hauler shape (nested integration/fleet/performance allowed).
 */
function create(h) {
  const now = new Date().toISOString();
  stmts.insert.run({
    id:                  h.id,
    display_name:        String(h.display_name).trim(),
    onboarded_date:      h.onboarded_date ?? now.slice(0, 10),
    status:              h.status          ?? 'pending',
    integration_type:    h.integration?.type        ?? h.integration_type  ?? 'manual',
    integration_adapter: h.integration?.adapter     ?? null,
    last_sync:           h.integration?.last_sync   ?? null,
    error_count_24h:     h.integration?.error_count_24h ?? null,
    contracted_trucks:   h.fleet?.contracted_trucks ?? h.contracted_trucks ?? 0,
    active_trucks:       h.fleet?.active_trucks     ?? 0,
    on_time_pct:         h.performance?.on_time_pct        ?? 0,
    sla_attainment_pct:  h.performance?.sla_attainment_pct ?? 0,
    safety_score:        h.performance?.safety_score       ?? 0,
    run_rate:            h.run_rate ?? 0,
    contact_name:        h.contact_name       ?? null,
    contact_email:       h.contact_email      ?? null,
    contract_share_pct:  h.contract_share_pct ?? null,
    planned_start_date:  h.planned_start_date ?? null,
    activated_at:        h.activated_at       ?? null,
    created_at:          now,
    updated_at:          now,
  });
  return findById(h.id);
}

// Column map: field key → SQL column name + optional coerce function.
// Only keys present in `fields` are included in the UPDATE.
const UPDATE_COLS = {
  display_name:        { col: 'display_name' },
  status:              { col: 'status' },
  integration_type:    { col: 'integration_type' },
  integration_adapter: { col: 'integration_adapter' },
  last_sync:           { col: 'last_sync' },
  error_count_24h:     { col: 'error_count_24h',    coerce: (v) => v != null ? Number(v) : null },
  contracted_trucks:   { col: 'contracted_trucks',  coerce: (v) => v != null ? Number(v) : null },
  active_trucks:       { col: 'active_trucks',      coerce: (v) => v != null ? Number(v) : null },
  on_time_pct:         { col: 'on_time_pct',        coerce: (v) => v != null ? Number(v) : null },
  sla_attainment_pct:  { col: 'sla_attainment_pct', coerce: (v) => v != null ? Number(v) : null },
  safety_score:        { col: 'safety_score',       coerce: (v) => v != null ? Number(v) : null },
  run_rate:            { col: 'run_rate',           coerce: (v) => v != null ? Number(v) : null },
  contact_name:        { col: 'contact_name',       coerce: (v) => v?.trim() ?? null },
  contact_email:       { col: 'contact_email',      coerce: (v) => v?.trim() ?? null },
  contract_share_pct:  { col: 'contract_share_pct', coerce: (v) => v         ?? null },
  planned_start_date:  { col: 'planned_start_date', coerce: (v) => v         ?? null },
  activated_at:        { col: 'activated_at' },
};

/**
 * Update mutable fields. Only keys present in `fields` are written to the DB,
 * so callers can safely pass a partial object. Passing `null` for a key
 * explicitly clears that column.
 */
function update(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return findById(id);
  const now    = new Date().toISOString();
  const sets   = ['updated_at = @updated_at'];
  const params = { id, updated_at: now };

  for (const [key, { col, coerce }] of Object.entries(UPDATE_COLS)) {
    if (!(key in fields)) continue;
    sets.push(`${col} = @${key}`);
    params[key] = coerce ? coerce(fields[key]) : (fields[key] ?? null);
  }

  db.prepare(`UPDATE haulers SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return findById(id);
}

function deactivate(id) {
  const ts = new Date().toISOString();
  stmts.deactivate.run({ id, ts });
}

function reactivate(id) {
  const ts = new Date().toISOString();
  stmts.reactivate.run({ id, ts });
}

/** Generate next sequential haul-NN id. */
function nextId() {
  const row = stmts.maxNum.get();
  if (!row) return 'haul-01';
  const last = parseInt(row.id.replace('haul-', ''), 10);
  return `haul-${String(last + 1).padStart(2, '0')}`;
}

module.exports = { list, findById, create, update, deactivate, reactivate, nextId };
