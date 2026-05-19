'use strict';

/*
 * Notification dispatcher — LP-14.
 *
 * Given a triggered alert, finds all users with matching notification
 * preferences and sends them an email. Deduplicates via notification_log
 * so the same (alert_id, user_id) pair is never delivered twice.
 *
 * Preference matching:
 *   A user receives a notification if they have a preference row where
 *   alert_type = '*'  (subscribe to all)
 *   OR alert_type = the specific rule_type of this alert.
 *
 * Roles that receive alerts by default (if no preference row exists):
 *   axis_admin, axis_ops — all alert types
 *   hauler_admin         — alerts for their own hauler_id only
 *   lender               — critical alerts only
 */

const crypto = require('crypto');
const db     = require('../db');
const mailer = require('./mailer');
const users  = require('../state/users');
const log    = require('./logger');

function now() { return new Date().toISOString(); }
function newId() { return crypto.randomBytes(6).toString('hex'); }

const stmts = {
  // Users who have opted in for this alert type (or '*') with email enabled.
  subscribed: db.prepare(`
    SELECT DISTINCT user_id FROM notification_preferences
    WHERE via_email = 1
      AND (alert_type = '*' OR alert_type = @alert_type)
  `),

  // Check if a notification was already sent for this (alert_id, user_id).
  alreadySent: db.prepare(`
    SELECT id FROM notification_log WHERE alert_id = @alert_id AND user_id = @user_id LIMIT 1
  `),

  // Record delivery.
  logDelivery: db.prepare(`
    INSERT INTO notification_log (id, alert_id, user_id, channel, sent_at)
    VALUES (@id, @alert_id, @user_id, 'email', @sent_at)
  `),
};

/**
 * dispatch({ alert_id, rule_type, severity, label, summary, hauler_id, vehicle_id })
 *
 * Async — fire-and-forget is fine; the caller uses .catch() for errors.
 */
async function dispatch({ alert_id, rule_type, severity, label, summary, hauler_id, vehicle_id }) {
  // Collect subscribed user IDs from the DB.
  const subscribedIds = new Set(
    stmts.subscribed.all({ alert_type: rule_type }).map((r) => r.user_id),
  );

  // Also add admins and ops users who have no explicit preference rows yet
  // (default-on behaviour until they opt out).
  const allUsers = users.list();
  for (const u of allUsers) {
    if (!u.active) continue;
    if (u.role === 'axis_admin' || u.role === 'axis_ops') {
      subscribedIds.add(u.id);
    }
    if (u.role === 'hauler_admin' && u.hauler_id === hauler_id) {
      subscribedIds.add(u.id);
    }
    if (u.role === 'lender' && severity === 'critical') {
      subscribedIds.add(u.id);
    }
  }

  if (subscribedIds.size === 0) return;

  const ts = now();

  for (const userId of subscribedIds) {
    // Dedup check.
    if (stmts.alreadySent.get({ alert_id, user_id: userId })) continue;

    const user = users.findById(userId);
    if (!user || !user.email) continue;

    try {
      await mailer.send({
        to:      user.email,
        subject: `[AXIS ${severity.toUpperCase()}] ${label ?? rule_type}`,
        text: [
          `Hi ${user.display_name},`,
          '',
          `An alert has been triggered on the Nyinahin–Takoradi corridor.`,
          '',
          `  Severity : ${severity.toUpperCase()}`,
          `  Type     : ${rule_type}`,
          `  Details  : ${summary}`,
          vehicle_id ? `  Vehicle  : ${vehicle_id}` : null,
          hauler_id  ? `  Hauler   : ${hauler_id}`  : null,
          '',
          `Sign in to AXIS Command Center to review and triage this alert.`,
          `${mailer.APP_URL}/alerts`,
          '',
          '— AXIS Command Center',
        ].filter((l) => l !== null).join('\n'),
      });

      stmts.logDelivery.run({
        id:       newId(),
        alert_id,
        user_id:  userId,
        sent_at:  ts,
      });

      log.info('Notification sent', { alert_id, user_id: userId, rule_type, severity });
    } catch (err) {
      log.error('Notification send failed', { alert_id, user_id: userId, err: err.message });
    }
  }
}

module.exports = { dispatch };
