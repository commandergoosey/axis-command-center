'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must happen before requiring any state module ───────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

// ── Module under test ─────────────────────────────────────────────────────
delete require.cache[require.resolve('../state/alertRulesStore')];
const store = require('../state/alertRulesStore');

// ─────────────────────────────────────────────────────────────────────────────

describe('alertRulesStore — seeding', () => {
  it('creates all DEFAULT_RULES + TELEMETRY_RULES on a fresh DB', () => {
    const rules = store.list();
    // 7 DEFAULT_RULES + 3 TELEMETRY_RULES = 10
    assert.strictEqual(rules.length, 10);
  });

  it('seed() is idempotent — re-requiring does not duplicate rules', () => {
    delete require.cache[require.resolve('../state/alertRulesStore')];
    const store2 = require('../state/alertRulesStore');
    assert.strictEqual(store2.list().length, 10);
  });

  it('seedIfMissing() adds telemetry rules to a pre-telemetry DB', () => {
    // Simulate a DB seeded before telemetry rules were introduced.
    db.exec("DELETE FROM alert_rules WHERE rule_type IN ('low_signal', 'low_fuel', 'fuel_theft')");
    assert.strictEqual(store.list().length, 7);

    delete require.cache[require.resolve('../state/alertRulesStore')];
    const store3 = require('../state/alertRulesStore');

    const types = new Set(store3.list().map((r) => r.rule_type));
    assert.ok(types.has('low_signal'), 'low_signal should be seeded');
    assert.ok(types.has('low_fuel'),   'low_fuel should be seeded');
    assert.ok(types.has('fuel_theft'), 'fuel_theft should be seeded');
    // Total should be back to 10
    assert.strictEqual(store3.list().length, 10);
  });

  it('seedIfMissing() is idempotent — does not add duplicates when all rules exist', () => {
    delete require.cache[require.resolve('../state/alertRulesStore')];
    const store4 = require('../state/alertRulesStore');
    assert.strictEqual(store4.list().length, 10);
  });

  it('low_fuel rule has a negative threshold (-50)', () => {
    const rule = store.list().find((r) => r.rule_type === 'low_fuel');
    assert.ok(rule, 'low_fuel rule must exist');
    assert.strictEqual(rule.threshold, -50);
    assert.strictEqual(rule.severity, 'warning');
  });

  it('fuel_theft rule has threshold 30 (litres drain)', () => {
    const rule = store.list().find((r) => r.rule_type === 'fuel_theft');
    assert.ok(rule);
    assert.strictEqual(rule.threshold, 30);
    assert.strictEqual(rule.severity, 'critical');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertRulesStore — CRUD', () => {
  it('create() inserts and returns the new rule with correct fields', () => {
    const rule = store.create({
      rule_type: 'speed',
      threshold: 120,
      severity:  'critical',
      label:     'Test speed > 120',
    });
    assert.ok(rule.id, 'should have an id');
    assert.strictEqual(rule.rule_type,  'speed');
    assert.strictEqual(rule.threshold,  120);
    assert.strictEqual(rule.severity,   'critical');
    assert.strictEqual(rule.enabled,    1);
    assert.strictEqual(rule.hauler_id,  null);
    store.remove(rule.id);
  });

  it('create() defaults severity to warning and enabled to 1', () => {
    const rule = store.create({ rule_type: 'idle_engine', threshold: 45 });
    assert.strictEqual(rule.severity, 'warning');
    assert.strictEqual(rule.enabled,  1);
    store.remove(rule.id);
  });

  it('create() accepts hauler_id for hauler-scoped rules', () => {
    const rule = store.create({
      rule_type:  'speed',
      threshold:  75,
      severity:   'warning',
      hauler_id:  'haulco-1',
    });
    assert.strictEqual(rule.hauler_id, 'haulco-1');
    store.remove(rule.id);
  });

  it('findById() returns the rule', () => {
    const created = store.create({ rule_type: 'speed', threshold: 99, severity: 'info' });
    const found   = store.findById(created.id);
    assert.strictEqual(found.id,        created.id);
    assert.strictEqual(found.threshold, 99);
    store.remove(created.id);
  });

  it('findById() returns null for an unknown id', () => {
    assert.strictEqual(store.findById('does-not-exist'), null);
  });

  it('update() changes threshold and label without touching other fields', () => {
    const created = store.create({ rule_type: 'speed', threshold: 90, severity: 'warning', label: 'Original' });
    const updated = store.update(created.id, { threshold: 95, label: 'Updated' });
    assert.strictEqual(updated.threshold, 95);
    assert.strictEqual(updated.label,     'Updated');
    assert.strictEqual(updated.severity,  'warning'); // unchanged
    assert.strictEqual(updated.enabled,   1);          // unchanged
    store.remove(created.id);
  });

  it('update() can disable a rule', () => {
    const created = store.create({ rule_type: 'idle_engine', threshold: 30, severity: 'info' });
    const updated = store.update(created.id, { enabled: false });
    assert.strictEqual(updated.enabled, 0);
    store.remove(created.id);
  });

  it('update() returns null for an unknown id', () => {
    assert.strictEqual(store.update('does-not-exist', { threshold: 0 }), null);
  });

  it('remove() deletes the rule', () => {
    const created = store.create({ rule_type: 'speed', threshold: 77, severity: 'info' });
    assert.ok(store.findById(created.id), 'rule should exist before removal');
    store.remove(created.id);
    assert.strictEqual(store.findById(created.id), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertRulesStore — forEvent()', () => {
  it('returns all enabled global rules matching the type', () => {
    const rules = store.forEvent('speed', null);
    assert.ok(rules.length >= 2, 'should return at least the two seeded speed rules');
    rules.forEach((r) => {
      assert.strictEqual(r.rule_type, 'speed');
      assert.strictEqual(r.enabled,   1);
    });
  });

  it('excludes disabled rules', () => {
    const disabled = store.create({ rule_type: 'speed', threshold: 999, severity: 'info', enabled: false });
    const rules    = store.forEvent('speed', null);
    assert.ok(!rules.some((r) => r.id === disabled.id), 'disabled rule must not appear');
    store.remove(disabled.id);
  });

  it('returns nothing for an unknown rule_type', () => {
    const rules = store.forEvent('nonexistent_type', null);
    assert.strictEqual(rules.length, 0);
  });

  it('returns both global and hauler-specific rules for that type', () => {
    const haulerId  = 'test-hauler-forEvent';
    const global    = store.create({ rule_type: 'axle_overload', threshold: 5, severity: 'info' });
    const specific  = store.create({ rule_type: 'axle_overload', threshold: 3, severity: 'warning', hauler_id: haulerId });

    const rules = store.forEvent('axle_overload', haulerId);
    assert.ok(rules.some((r) => r.id === global.id),   'global rule should be included');
    assert.ok(rules.some((r) => r.id === specific.id), 'hauler-specific rule should be included');

    store.remove(global.id);
    store.remove(specific.id);
  });

  it('hauler-specific rules sort before global rules (ORDER BY hauler_id DESC NULLS LAST)', () => {
    const haulerId  = 'test-hauler-order';
    const global    = store.create({ rule_type: 'hours_driving', threshold: 12, severity: 'info' });
    const specific  = store.create({ rule_type: 'hours_driving', threshold: 9, severity: 'warning', hauler_id: haulerId });

    const rules = store.forEvent('hours_driving', haulerId);
    const iGlobal   = rules.findIndex((r) => r.id === global.id);
    const iSpecific = rules.findIndex((r) => r.id === specific.id);
    assert.ok(iSpecific < iGlobal, 'hauler-specific rule should sort before global rule');

    store.remove(global.id);
    store.remove(specific.id);
  });

  it('does not return hauler-specific rules for a different hauler', () => {
    const specific = store.create({ rule_type: 'speed', threshold: 60, severity: 'warning', hauler_id: 'hauler-A' });
    const rules    = store.forEvent('speed', 'hauler-B');
    assert.ok(!rules.some((r) => r.id === specific.id), 'rule for hauler-A should not appear for hauler-B');
    store.remove(specific.id);
  });
});
