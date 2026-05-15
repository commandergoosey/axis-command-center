'use strict';

/*
 * In-memory hauler roster — Phase 109: persisted additions.
 *                           Phase 128: persisted mock-hauler mutations.
 *
 * Seeded from mock fixtures at boot; dynamically onboarded haulers are
 * loaded from rosterStore (SQLite) so they survive server restarts.
 *
 * Phase 128 closes the remaining gap: mutations to MOCK haulers (status,
 * contracted_trucks, contact fields, etc.) are now persisted via a
 * `hauler_field_overrides` table and re-applied at boot, so no runtime
 * change to any hauler is lost across restarts.
 *
 * Write priority at boot:
 *   1. Mock fixture baseline
 *   2. hauler_field_overrides applied on top (for mock haulers)
 *   3. rosterStore DB rows merged in (for UI-onboarded haulers)
 *
 * Write priority on update():
 *   - If hauler._persisted  → rosterStore.update() (already existed)
 *   - If mock hauler        → hauler_field_overrides upsert (new)
 */

const db = require('../db');
const mockHaulers  = require('../mock/haulers');
const rosterStore  = require('./rosterStore');

// ── Overrides table for mock haulers ────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS hauler_field_overrides (
    hauler_id   TEXT PRIMARY KEY,
    fields_json TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

const overrideUpsertStmt = db.prepare(`
  INSERT INTO hauler_field_overrides (hauler_id, fields_json, updated_at)
    VALUES (@hauler_id, @fields_json, @updated_at)
  ON CONFLICT (hauler_id) DO UPDATE SET
    fields_json = excluded.fields_json,
    updated_at  = excluded.updated_at
`);

const overrideByIdStmt = db.prepare('SELECT fields_json FROM hauler_field_overrides WHERE hauler_id = ?');
const allOverridesStmt = db.prepare('SELECT hauler_id, fields_json FROM hauler_field_overrides');

// Load all overrides into a Map at boot — avoids repeated DB reads in the
// hot path (roster.find() is called on almost every API request).
const overrideMap = new Map();
for (const row of allOverridesStmt.all()) {
  try { overrideMap.set(row.hauler_id, JSON.parse(row.fields_json)); } catch (_) {}
}

// ── Helper: apply a stored override patch to a hauler object in-place ───────

function applyOverride(h, fields) {
  if (!fields) return;
  if (fields.display_name       != null) h.display_name                   = fields.display_name;
  if (fields.status             != null) h.status                         = fields.status;
  if (fields.contracted_trucks  != null) h.fleet.contracted_trucks         = Number(fields.contracted_trucks);
  if ('contact_name'   in fields)        h.contact_name                    = fields.contact_name;
  if ('contact_email'  in fields)        h.contact_email                   = fields.contact_email;
  if ('contract_share_pct' in fields)    h.contract_share_pct              = fields.contract_share_pct;
  if ('planned_start_date' in fields)    h.planned_start_date              = fields.planned_start_date;
  if (fields.activated_at       != null) h.activated_at                    = fields.activated_at;
}

// ── Build roster ─────────────────────────────────────────────────────────────

function clone(h) {
  return {
    ...h,
    integration: { ...h.integration },
    fleet:       { ...h.fleet },
    performance: { ...h.performance },
  };
}

// Start from the mock seed, applying any persisted overrides.
const roster = mockHaulers.map((h) => {
  const c = clone(h);
  applyOverride(c, overrideMap.get(c.id));
  return c;
});

// Merge DB-persisted haulers that aren't already in the mock set.
for (const h of rosterStore.all()) {
  if (!roster.find((r) => r.id === h.id)) {
    roster.push(h);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  list:   () => roster,
  find:   (id) => roster.find((h) => h.id === id),
  add:    (h)  => { roster.push(h); return h; },
  nextId: ()   => `haul-${String(roster.length + 1).padStart(2, '0')}`,

  /**
   * Mutate a hauler by id. Only touches the provided fields.
   * Persists to rosterStore (for DB-backed haulers) or hauler_field_overrides
   * (for mock haulers) so the change survives a server restart.
   * Returns the mutated entry or null if not found.
   */
  update(id, fields) {
    const h = roster.find((r) => r.id === id);
    if (!h) return null;

    // Apply to in-memory object.
    applyOverride(h, fields);

    if (h._persisted) {
      // DB-onboarded hauler — rosterStore already handles persistence.
      rosterStore.update(id, fields);
    } else {
      // Mock hauler — merge the new fields into the persisted override patch
      // so each update() call accumulates rather than replacing prior changes.
      const existing = overrideMap.get(id) ?? {};
      const merged   = { ...existing, ...fields };
      overrideMap.set(id, merged);
      overrideUpsertStmt.run({
        hauler_id:   id,
        fields_json: JSON.stringify(merged),
        updated_at:  new Date().toISOString(),
      });
    }

    return h;
  },
};
