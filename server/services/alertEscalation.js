'use strict';

/*
 * Alert escalation sweep — LP-35.
 *
 * Runs hourly. Scans alert_state for alerts that are still open (status_override
 * IS NULL or = 'open') and have been open for more than ESCALATION_THRESHOLD_H
 * hours without any update. For each, emits a notification to axis_admin users
 * and logs a warn entry.
 *
 * Deduplication: tracks the last escalation time per alert in a module-level
 * Map so repeated runs within the cooldown window don't re-notify.
 *
 * Threshold: ALERT_ESCALATION_H env var (default 2 hours).
 * Cooldown:  ALERT_ESCALATION_COOLDOWN_H env var (default 4 hours between repeats).
 */

const db            = require('../db');
const notifications = require('../state/notifications');
const users         = require('../state/users');
const log           = require('./logger');

const THRESHOLD_H  = parseFloat(process.env.ALERT_ESCALATION_H          ?? '2');
const COOLDOWN_H   = parseFloat(process.env.ALERT_ESCALATION_COOLDOWN_H ?? '4');

// In-memory dedup: alertId → last escalation ISO timestamp.
const lastEscalated = new Map();

const stmts = {
  staleAlerts: db.prepare(`
    SELECT alert_id, status_override, updated_at
    FROM alert_state
    WHERE (status_override IS NULL OR status_override = 'open')
      AND updated_at < @cutoff
    ORDER BY updated_at ASC
    LIMIT 50
  `),
};

function run() {
  const nowMs    = Date.now();
  const cutoff   = new Date(nowMs - THRESHOLD_H   * 3_600_000).toISOString();
  const cooldown =            nowMs - COOLDOWN_H   * 3_600_000;

  const rows = stmts.staleAlerts.all({ cutoff });
  if (rows.length === 0) return { escalated: 0 };

  // Find axis_admin recipients.
  const admins = users.list().filter((u) => u.role === 'axis_admin' && u.active !== false);
  if (admins.length === 0) return { escalated: 0 };

  let escalated = 0;

  for (const row of rows) {
    const lastMs = lastEscalated.has(row.alert_id)
      ? new Date(lastEscalated.get(row.alert_id)).getTime()
      : 0;
    if (lastMs > cooldown) continue; // still in cooldown

    const ageH = ((nowMs - new Date(row.updated_at).getTime()) / 3_600_000).toFixed(1);

    for (const admin of admins) {
      try {
        notifications.emit({
          user_id:    admin.id,
          event_type: 'escalation',
          body:       `Alert ${row.alert_id} has been open for ${ageH} h with no update.`,
          link:       { path: '/alerts', label: 'Review alerts' },
        });
      } catch (_) {}
    }

    lastEscalated.set(row.alert_id, new Date(nowMs).toISOString());
    escalated++;

    log.warn('Alert escalation: stale open alert', {
      alert_id: row.alert_id,
      age_h:    ageH,
      updated_at: row.updated_at,
    });
  }

  if (escalated > 0) {
    log.info('Alert escalation sweep complete', { escalated, checked: rows.length });
  }

  return { escalated, checked: rows.length };
}

module.exports = { run };
