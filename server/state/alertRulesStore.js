'use strict';

/*
 * Alert rules store — LP-13.
 *
 * Configurable thresholds evaluated against incoming telemetry events.
 * Default rules are seeded on first boot; admins can add hauler-specific
 * overrides via POST /api/admin/alert-rules.
 *
 * rule_type values and their threshold semantics:
 *   speed          — speed_kmh > threshold
 *   axle_overload  — axle_load_pct > threshold
 *   hours_driving  — hours since last rest > threshold
 *   idle_engine    — stationary engine-on duration (min) > threshold
 */

const crypto = require('crypto');
const db     = require('../db');
const log    = require('../services/logger');

function now() { return new Date().toISOString(); }
function newId() { return crypto.randomBytes(6).toString('hex'); }

const stmts = {
  count:       db.prepare('SELECT COUNT(*) AS n FROM alert_rules'),
  countByType: db.prepare('SELECT COUNT(*) AS n FROM alert_rules WHERE rule_type = ?'),
  list:   db.prepare('SELECT * FROM alert_rules ORDER BY rule_type, hauler_id NULLS FIRST'),
  byId:   db.prepare('SELECT * FROM alert_rules WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO alert_rules (id, hauler_id, rule_type, threshold, severity, enabled, label, created_at, updated_at)
    VALUES (@id, @hauler_id, @rule_type, @threshold, @severity, @enabled, @label, @created_at, @updated_at)
  `),
  update: db.prepare(`
    UPDATE alert_rules
    SET hauler_id = @hauler_id, rule_type = @rule_type, threshold = @threshold,
        severity = @severity, enabled = @enabled, label = @label, updated_at = @updated_at
    WHERE id = @id
  `),
  delete:      db.prepare('DELETE FROM alert_rules WHERE id = ?'),
  forEvent:    db.prepare(`
    SELECT * FROM alert_rules
    WHERE rule_type = @rule_type
      AND enabled = 1
      AND (hauler_id IS NULL OR hauler_id = @hauler_id)
    ORDER BY hauler_id DESC NULLS LAST
  `),
};

/* ── Default rules ─────────────────────────────────────────────── */

const DEFAULT_RULES = [
  { rule_type: 'speed',         threshold: 80,  severity: 'warning',  label: 'Speed > 80 km/h' },
  { rule_type: 'speed',         threshold: 100, severity: 'critical', label: 'Speed > 100 km/h' },
  { rule_type: 'axle_overload', threshold: 10,  severity: 'warning',  label: 'Axle load > 10% over limit' },
  { rule_type: 'axle_overload', threshold: 20,  severity: 'critical', label: 'Axle load > 20% over limit' },
  { rule_type: 'hours_driving', threshold: 10,  severity: 'warning',  label: 'Driving > 10 hours' },
  { rule_type: 'hours_driving', threshold: 11,  severity: 'critical', label: 'Driving > 11 hours (HOS violation)' },
  { rule_type: 'idle_engine',   threshold: 30,  severity: 'info',     label: 'Engine idle > 30 min' },
];

function seed() {
  const { n } = stmts.count.get();
  if (n > 0) return;
  log.info('[alertRulesStore] Seeding default alert rules');
  const ts = now();
  const insertAll = db.transaction((rules) => {
    for (const r of rules) {
      stmts.insert.run({
        id:         newId(),
        hauler_id:  null,
        rule_type:  r.rule_type,
        threshold:  r.threshold,
        severity:   r.severity,
        enabled:    1,
        label:      r.label,
        created_at: ts,
        updated_at: ts,
      });
    }
  });
  insertAll(DEFAULT_RULES);
}

seed();

/*
 * Telemetry-sourced rules that must exist even on DBs seeded before they
 * were introduced. Checked per rule_type — safe to run on every boot.
 * low_fuel uses a negated threshold: engine fires when value > threshold,
 * so passing -fuel_litres with threshold -50 alerts when fuel < 50 L.
 */
const TELEMETRY_RULES = [
  { rule_type: 'low_signal', threshold: 0,   severity: 'warning',  label: 'Device signal weak (<5 CSQ)' },
  { rule_type: 'low_fuel',   threshold: -50, severity: 'warning',  label: 'Fuel below 50 L' },
  { rule_type: 'fuel_theft', threshold: 30,  severity: 'critical', label: 'Fuel drain > 30 L (suspected theft)' },
];

function seedIfMissing() {
  const ts = now();
  for (const r of TELEMETRY_RULES) {
    const { n } = stmts.countByType.get(r.rule_type);
    if (n > 0) continue;
    stmts.insert.run({
      id: newId(), hauler_id: null,
      rule_type: r.rule_type, threshold: r.threshold,
      severity: r.severity, enabled: 1, label: r.label,
      created_at: ts, updated_at: ts,
    });
    log.info(`[alertRulesStore] Seeded missing rule: ${r.rule_type}`);
  }
}

seedIfMissing();

/* ── Public API ────────────────────────────────────────────────── */

function list() { return stmts.list.all(); }
function findById(id) { return stmts.byId.get(id) ?? null; }

/**
 * Find all enabled rules matching a rule_type for a given hauler.
 * Returns hauler-specific rules first (they take precedence), then global rules.
 */
function forEvent(rule_type, hauler_id) {
  return stmts.forEvent.all({ rule_type, hauler_id: hauler_id ?? null });
}

function create(fields) {
  const ts = now();
  const id = newId();
  stmts.insert.run({
    id,
    hauler_id:  fields.hauler_id  ?? null,
    rule_type:  fields.rule_type,
    threshold:  Number(fields.threshold),
    severity:   fields.severity   ?? 'warning',
    enabled:    fields.enabled !== false ? 1 : 0,
    label:      fields.label      ?? null,
    created_at: ts,
    updated_at: ts,
  });
  return stmts.byId.get(id);
}

function update(id, fields) {
  const existing = stmts.byId.get(id);
  if (!existing) return null;
  stmts.update.run({
    id,
    hauler_id:  'hauler_id'  in fields ? (fields.hauler_id  ?? null)   : existing.hauler_id,
    rule_type:  'rule_type'  in fields ? fields.rule_type               : existing.rule_type,
    threshold:  'threshold'  in fields ? Number(fields.threshold)       : existing.threshold,
    severity:   'severity'   in fields ? fields.severity                : existing.severity,
    enabled:    'enabled'    in fields ? (fields.enabled ? 1 : 0)       : existing.enabled,
    label:      'label'      in fields ? (fields.label ?? null)         : existing.label,
    updated_at: now(),
  });
  return stmts.byId.get(id);
}

function remove(id) { stmts.delete.run(id); }

module.exports = { list, findById, forEvent, create, update, remove };
