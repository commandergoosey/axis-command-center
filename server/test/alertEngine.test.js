'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must happen before requiring any state module ───────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db); // adds severity/rule_id/vehicle_id/hauler_id to alert_state (011)

// ── Stub notificationDispatcher — prevents real email/network calls ────────
const ndKey = require.resolve('../services/notificationDispatcher');
require.cache[ndKey] = {
  id: ndKey, filename: ndKey, loaded: true,
  exports: { dispatch: async () => {} },
};

// ── Require modules under test (after db is in cache) ─────────────────────
delete require.cache[require.resolve('../state/alertRulesStore')];
const alertRulesStore = require('../state/alertRulesStore');

delete require.cache[require.resolve('../services/alertEngine')];
const alertEngine = require('../services/alertEngine');

// ── Helpers ───────────────────────────────────────────────────────────────
const countAlertState = db.prepare('SELECT COUNT(*) AS n FROM alert_state');
const clearAlertState = () => db.exec('DELETE FROM alert_state');

// ─────────────────────────────────────────────────────────────────────────────

describe('alertEngine — threshold evaluation', () => {
  beforeEach(clearAlertState);

  it('does not fire when value === threshold (strictly greater required)', () => {
    // Seeded rule: speed > 80. value = 80 is NOT a violation.
    alertEngine.evaluate({ rule_type: 'speed', value: 80, hauler_id: null, vehicle_id: 'VH-01' });
    assert.strictEqual(countAlertState.get().n, 0);
  });

  it('does not fire when value < threshold', () => {
    alertEngine.evaluate({ rule_type: 'speed', value: 70, hauler_id: null, vehicle_id: 'VH-01' });
    assert.strictEqual(countAlertState.get().n, 0);
  });

  it('creates one alert_state row when value exceeds one threshold', () => {
    // value = 95: triggers speed > 80 (warning) but NOT speed > 100 (critical)
    alertEngine.evaluate({ rule_type: 'speed', value: 95, hauler_id: null, vehicle_id: 'VH-01' });
    assert.strictEqual(countAlertState.get().n, 1);
  });

  it('creates multiple alert_state rows when value exceeds multiple thresholds', () => {
    // value = 105: triggers both speed > 80 (warning) AND speed > 100 (critical)
    alertEngine.evaluate({ rule_type: 'speed', value: 105, hauler_id: null, vehicle_id: 'VH-02' });
    assert.strictEqual(countAlertState.get().n, 2);
  });

  it('creates no alert for an unknown rule_type (no matching rules)', () => {
    alertEngine.evaluate({ rule_type: 'unknown_rule_xyz', value: 9999, hauler_id: null, vehicle_id: 'VH-01' });
    assert.strictEqual(countAlertState.get().n, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertEngine — deduplication', () => {
  beforeEach(clearAlertState);

  it('INSERT OR IGNORE suppresses duplicate alerts within the same hour bucket', () => {
    alertEngine.evaluate({ rule_type: 'speed', value: 90, hauler_id: null, vehicle_id: 'VH-03' });
    alertEngine.evaluate({ rule_type: 'speed', value: 90, hauler_id: null, vehicle_id: 'VH-03' });
    // Same rule + same vehicle + same hour bucket → same alert_id → only 1 row
    assert.strictEqual(countAlertState.get().n, 1, 'duplicate in same bucket must be ignored');
  });

  it('different vehicles produce distinct alerts for the same rule', () => {
    alertEngine.evaluate({ rule_type: 'speed', value: 90, hauler_id: null, vehicle_id: 'VH-04' });
    alertEngine.evaluate({ rule_type: 'speed', value: 90, hauler_id: null, vehicle_id: 'VH-05' });
    assert.strictEqual(countAlertState.get().n, 2, 'different vehicles must produce distinct alerts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertEngine — low_fuel negated-threshold semantics', () => {
  beforeEach(clearAlertState);

  /*
   * low_fuel uses an inverted value so the standard `value > threshold` engine
   * works for a "below minimum" rule:
   *   server/index.js passes value = -fuel_litres
   *   seeded rule threshold = -50
   *   violation fires when: -fuel_litres > -50  ↔  fuel < 50 L
   */

  it('fires when fuel is 45 L (below 50 L): -45 > -50', () => {
    alertEngine.evaluate({ rule_type: 'low_fuel', value: -45, hauler_id: null, vehicle_id: 'VH-06' });
    assert.strictEqual(countAlertState.get().n, 1);
  });

  it('does not fire when fuel is 55 L (above 50 L): -55 is NOT > -50', () => {
    alertEngine.evaluate({ rule_type: 'low_fuel', value: -55, hauler_id: null, vehicle_id: 'VH-06' });
    assert.strictEqual(countAlertState.get().n, 0);
  });

  it('does not fire when fuel is exactly 50 L: -50 is NOT > -50', () => {
    alertEngine.evaluate({ rule_type: 'low_fuel', value: -50, hauler_id: null, vehicle_id: 'VH-06' });
    assert.strictEqual(countAlertState.get().n, 0);
  });

  it('fires when fuel is 1 L (critically low): -1 > -50', () => {
    alertEngine.evaluate({ rule_type: 'low_fuel', value: -1, hauler_id: null, vehicle_id: 'VH-06' });
    assert.strictEqual(countAlertState.get().n, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertEngine — disabled rules', () => {
  beforeEach(clearAlertState);

  it('disabled rule is excluded from evaluation (no alert created)', () => {
    // Create a rule that would fire for value=60 if enabled (threshold=50)
    // The seeded speed rules are 80 and 100, so value=60 won't trigger them.
    const rule = alertRulesStore.create({
      rule_type: 'speed',
      threshold: 50,
      severity:  'warning',
      enabled:   false,
    });

    alertEngine.evaluate({ rule_type: 'speed', value: 60, hauler_id: null, vehicle_id: 'VH-07' });
    assert.strictEqual(countAlertState.get().n, 0, 'disabled rule must not create an alert');

    alertRulesStore.remove(rule.id);
  });

  it('re-enabling a rule causes it to fire again', () => {
    const rule = alertRulesStore.create({
      rule_type: 'speed',
      threshold: 50,
      severity:  'warning',
      enabled:   false,
    });

    // Confirm disabled
    alertEngine.evaluate({ rule_type: 'speed', value: 60, hauler_id: null, vehicle_id: 'VH-08' });
    assert.strictEqual(countAlertState.get().n, 0, 'should not fire when disabled');

    alertRulesStore.update(rule.id, { enabled: true });
    clearAlertState();

    alertEngine.evaluate({ rule_type: 'speed', value: 60, hauler_id: null, vehicle_id: 'VH-08' });
    assert.strictEqual(countAlertState.get().n, 1, 'should fire after re-enabling');

    alertRulesStore.remove(rule.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertEngine — context columns stored on alert_state', () => {
  beforeEach(clearAlertState);

  const getRow = db.prepare('SELECT * FROM alert_state LIMIT 1');

  it('stores severity, vehicle_id, and hauler_id on the alert_state row', () => {
    alertEngine.evaluate({ rule_type: 'speed', value: 90, hauler_id: 'haul-01', vehicle_id: 'VH-CTX' });
    const row = getRow.get();
    assert.ok(row, 'alert_state row should exist');
    assert.strictEqual(row.severity,   'warning',  'severity should match seeded rule');
    assert.strictEqual(row.vehicle_id, 'VH-CTX',   'vehicle_id should be stored');
    assert.strictEqual(row.hauler_id,  'haul-01',  'hauler_id should be stored');
    assert.ok(row.rule_id,                          'rule_id should be populated');
  });

  it('stores severity = critical for a critical rule', () => {
    // Seeded critical rule: speed > 100
    alertEngine.evaluate({ rule_type: 'speed', value: 105, hauler_id: null, vehicle_id: 'VH-CTX2' });
    const rows = db.prepare('SELECT severity FROM alert_state ORDER BY severity').all();
    const severities = rows.map((r) => r.severity).sort();
    assert.ok(severities.includes('critical'), 'critical rule should store severity=critical');
    assert.ok(severities.includes('warning'),  'warning rule should also fire for value=105');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('alertEngine — hauler-scoped rules', () => {
  beforeEach(clearAlertState);

  it('hauler-specific rule fires only for its hauler', () => {
    const rule = alertRulesStore.create({
      rule_type: 'speed',
      threshold: 50,
      severity:  'warning',
      hauler_id: 'hauler-scoped',
    });

    // Should fire for the scoped hauler (50 < 60)
    alertEngine.evaluate({ rule_type: 'speed', value: 60, hauler_id: 'hauler-scoped', vehicle_id: 'VH-09' });
    assert.strictEqual(countAlertState.get().n, 1, 'scoped rule must fire for its hauler');

    clearAlertState();

    // Should NOT fire for a different hauler
    alertEngine.evaluate({ rule_type: 'speed', value: 60, hauler_id: 'other-hauler', vehicle_id: 'VH-09' });
    assert.strictEqual(countAlertState.get().n, 0, 'scoped rule must not fire for a different hauler');

    alertRulesStore.remove(rule.id);
  });
});
