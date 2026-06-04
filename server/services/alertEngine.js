'use strict';

/*
 * Alert engine — LP-13.
 *
 * Evaluates an incoming measurement (speed, axle load, hours driving, etc.)
 * against all applicable alert rules and, when a threshold is breached,
 * creates an entry in alert_state and triggers notification dispatch.
 *
 * Design choices:
 *   - Rules are fetched from alertRulesStore (DB-backed, hot-reloadable).
 *   - A synthetic alert_id is derived from rule + vehicle + 1-hour bucket so
 *     the same violation doesn't spam alert_state on every position ping.
 *   - alert_state rows are inserted only if they don't already exist
 *     (INSERT OR IGNORE) — duplicates are dropped silently.
 */

const crypto           = require('crypto');
const db               = require('../db');
const alertRulesStore  = require('../state/alertRulesStore');
const notificationDispatcher = require('./notificationDispatcher');
const eventBus         = require('./eventBus');
const log              = require('./logger');

/** Build a stable alert_id for a rule+vehicle within the current hour bucket. */
function alertId(ruleId, vehicleId, haulerIdFallback) {
  const bucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const key    = `${ruleId}:${vehicleId ?? haulerIdFallback}:${bucket}`;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
}

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO alert_state
    (alert_id, status_override, notes_json, updated_at, severity, rule_id, vehicle_id, hauler_id)
  VALUES
    (@alert_id, 'NEEDS_ACTION', '[]', @updated_at, @severity, @rule_id, @vehicle_id, @hauler_id)
`);

/**
 * evaluate({ rule_type, value, hauler_id, vehicle_id, meta })
 *
 * Looks up applicable rules for this rule_type + hauler, evaluates each,
 * and inserts an alert for any violation.
 */
function evaluate({ rule_type, value, hauler_id, vehicle_id, meta = {} }) {
  let rules;
  try {
    rules = alertRulesStore.forEvent(rule_type, hauler_id);
  } catch (err) {
    log.warn('Alert engine: failed to fetch rules', { rule_type, err: err.message });
    return;
  }

  const ts = new Date().toISOString();

  for (const rule of rules) {
    if (value <= rule.threshold) continue; // no violation

    const aid  = alertId(rule.id, vehicle_id, hauler_id);
    const meta_summary = [
      `${rule_type} = ${value}`,
      rule.label,
      vehicle_id ? `vehicle ${vehicle_id}` : null,
      hauler_id  ? `hauler ${hauler_id}`   : null,
    ].filter(Boolean).join(' · ');

    try {
      const result = stmtInsert.run({
        alert_id:   aid,
        updated_at: ts,
        severity:   rule.severity,
        rule_id:    rule.id,
        vehicle_id: vehicle_id ?? null,
        hauler_id:  hauler_id  ?? null,
      });

      if (result.changes > 0) {
        // Newly opened alert — log and dispatch notification.
        log.warn('Alert triggered', {
          alert_id:  aid,
          rule_type,
          threshold: rule.threshold,
          value,
          severity:  rule.severity,
          hauler_id,
          vehicle_id,
        });

        eventBus.emit('alert_raised', {
          alert_id:  aid,
          rule_type,
          severity:  rule.severity,
          vehicle_id,
          hauler_id,
        });

        notificationDispatcher.dispatch({
          alert_id:  aid,
          rule_type,
          severity:  rule.severity,
          label:     rule.label,
          summary:   meta_summary,
          hauler_id,
          vehicle_id,
        }).catch((err) => {
          log.warn('Notification dispatch failed', { alert_id: aid, err: err.message });
        });
      }
    } catch (err) {
      log.error('Alert engine: failed to insert alert_state', {
        alert_id: aid, err: err.message,
      });
    }
  }
}

module.exports = { evaluate };
