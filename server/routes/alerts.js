'use strict';

/*
 * Alerts — Phase 13 triage.
 *
 * Read:
 *   GET /api/alerts                  — merged view (fixture + triage state),
 *                                      filtered by query params.
 *
 * Writes (require auth + role scope):
 *   POST /api/alerts/:id/resolve     { note? }
 *   POST /api/alerts/:id/snooze      { until_iso }
 *   POST /api/alerts/:id/reopen
 *   POST /api/alerts/:id/assign      { user_id }
 *   POST /api/alerts/:id/note        { body }
 *
 * Scope rules (enforced in canTriage):
 *   axis_admin / axis_ops   — any alert
 *   hauler_admin            — only alerts where hauler_id matches own hauler
 *   lender                  — read-only; no writes
 *
 * Status resolution: the fixture gives each alert a baseline status, but
 * alertState.status_override (if set) always wins. Snoozes are treated as
 * open for the summary counts — they re-appear once the snooze_until has
 * passed (applied on read).
 */

const express = require('express');
const router = express.Router();

const roster = require('../state/roster');
const alertState = require('../state/alertState');
const users = require('../state/users');
const { requireAuth } = require('../middleware/auth');
const { writeAudit } = require('../db/audit');
const { allAlerts, autoClearedAlerts } = require('../services/alertSynth');

function summariseAlert(alert) {
  return `${alert.severity} · ${alert.title ?? alert.type ?? alert.id}`;
}

function alertById(id) {
  return allAlerts().find((a) => a.id === id) || null;
}

// Merges fixture + triage state. Applies snooze-expiry so snoozes don't
// swallow alerts forever.
function merge(alert) {
  const st = alertState.getState(alert.id);
  let status = st.status_override ?? alert.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) {
      status = alert.status; // snooze expired — revert to baseline
    }
  }
  return {
    ...alert,
    status,
    assignee:       st.assignee_display ? {
      user_id:      st.assignee_user_id,
      display_name: st.assignee_display,
      role:         st.assignee_role,
    } : null,
    snooze_until_iso:   st.snooze_until_iso,
    resolved_at_iso:    st.resolved_at_iso ?? (alert.resolved_at || null),
    resolved_by_display: st.resolved_by_display,
    resolution_note:    st.resolution_note,
    notes:              st.notes,
  };
}

function visibleTo(alert, user) {
  if (!user) return true; // public/demo reads allowed
  if (user.role === 'hauler_admin') {
    // Hauler admins see their own hauler + null-hauler (corridor-wide)
    return !alert.hauler_id || alert.hauler_id === user.hauler_id;
  }
  return true;
}

function canTriage(alert, user) {
  if (!user) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops') return true;
  if (user.role === 'hauler_admin') return alert.hauler_id === user.hauler_id;
  return false;
}

// ── Read ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const nameById = Object.fromEntries(roster.list().map((h) => [h.id, h.display_name]));
  const sourceAlerts = allAlerts();

  let rows = sourceAlerts
    .filter((a) => visibleTo(a, req.user))
    .map((a) => ({
      ...merge(a),
      hauler_display_name: a.hauler_id ? nameById[a.hauler_id] ?? a.hauler_id : null,
    }));

  // Filters
  const { severity, status, hauler_id, type, assignee, source } = req.query;
  if (severity)  rows = rows.filter((a) => a.severity === severity);
  if (status)    rows = rows.filter((a) => a.status === status);
  if (hauler_id) rows = rows.filter((a) => a.hauler_id === hauler_id);
  if (type)      rows = rows.filter((a) => a.type === type);
  if (source === 'generated') rows = rows.filter((a) => a.generated);
  else if (source === 'curated') rows = rows.filter((a) => !a.generated);
  if (assignee === 'unassigned') rows = rows.filter((a) => !a.assignee);
  else if (assignee === 'me' && req.user) rows = rows.filter((a) => a.assignee?.user_id === req.user.id);
  else if (typeof assignee === 'string' && assignee) rows = rows.filter((a) => a.assignee?.user_id === assignee);

  // Summaries always computed from the full visible set, not the filtered one.
  const visible = sourceAlerts.filter((a) => visibleTo(a, req.user)).map(merge);
  const open = visible.filter((a) => a.status === 'NEEDS_ACTION' || a.status === 'MONITORING');
  const snoozed = visible.filter((a) => a.status === 'SNOOZED');
  const resolved = visible.filter((a) => a.status === 'RESOLVED');
  const bySeverity = open.reduce((s, a) => { s[a.severity] = (s[a.severity] ?? 0) + 1; return s; }, { CRITICAL: 0, WARNING: 0, INFO: 0 });
  const mine = req.user ? visible.filter((a) => a.assignee?.user_id === req.user.id && a.status !== 'RESOLVED').length : 0;
  const unassigned = open.filter((a) => !a.assignee).length;
  const generatedTotal = visible.filter((a) => a.generated).length;

  // Auto-cleared (suppressed-by-lifecycle) alerts are filtered out of
  // `allAlerts()` upstream — operators were left wondering "where did
  // that alert go?". Surface them as a separate, non-actionable section
  // with the lifecycle reason so the system stays trustworthy. Hauler
  // scope still applies.
  const autoCleared = autoClearedAlerts()
    .filter((a) => visibleTo(a, req.user))
    .map((a) => ({
      ...a,
      hauler_display_name: a.hauler_id ? nameById[a.hauler_id] ?? a.hauler_id : null,
    }));

  // Phase 155 — 8-week alert severity trend.
  // Current week uses live counts; prior 7 weeks use a seeded PRNG so
  // the chart shows meaningful historical context without requiring a
  // time-series store.
  function seededAlert(n) {
    const raw = Math.sin(n * 7919 + 13) * 177013;
    return raw - Math.floor(raw);
  }
  const nowRef = new Date();
  const severity_trend = [];
  for (let w = 7; w >= 0; w--) {
    const ref    = new Date(nowRef.getTime() - w * 7 * 86_400_000);
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7));
    const weekLabel = monday.toISOString().slice(0, 10);
    const wk = monday.getUTCFullYear() * 1000
             + monday.getUTCMonth()    *   31
             + monday.getUTCDate();
    if (w === 0) {
      severity_trend.push({ week: weekLabel, critical: bySeverity.CRITICAL, warning: bySeverity.WARNING, info: bySeverity.INFO });
    } else {
      severity_trend.push({
        week:     weekLabel,
        critical: Math.round(1 + seededAlert(wk + 1) * 4),
        warning:  Math.round(3 + seededAlert(wk + 2) * 6),
        info:     Math.round(2 + seededAlert(wk + 3) * 5),
      });
    }
  }

  // Phase 197 — alert age profile.
  // Buckets open alerts (NEEDS_ACTION + MONITORING) by days since opened_at
  // so the shift supervisor can spot stale work without scanning every card.
  const AGE_BUCKETS = [
    { key: '0–2d',  label: '0–2 days',  min: 0,  max: 2          },
    { key: '3–7d',  label: '3–7 days',  min: 3,  max: 7          },
    { key: '8–14d', label: '8–14 days', min: 8,  max: 14         },
    { key: '15+d',  label: '15+ days',  min: 15, max: Infinity   },
  ];
  const nowMs = Date.now();
  const ageBuckets = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  open.forEach((a) => {
    if (!a.opened_at) return;
    const ageDays = Math.floor((nowMs - new Date(a.opened_at).getTime()) / 86_400_000);
    const bucketIdx = AGE_BUCKETS.findIndex((b) => ageDays >= b.min && ageDays <= b.max);
    if (bucketIdx >= 0) ageBuckets[bucketIdx].count++;
  });
  const oldestDays = open.length > 0
    ? Math.max(...open.map((a) => a.opened_at
        ? Math.floor((nowMs - new Date(a.opened_at).getTime()) / 86_400_000)
        : 0))
    : 0;
  const alert_age_profile = { buckets: ageBuckets, oldest_open_days: oldestDays };

  // Phase 212 — mean time to resolve by alert type (MODELLED).
  // Seeded values reflect realistic domain knowledge: integration failures
  // are quick (ops re-push), convoy delays clear in hours, licence issues
  // take days to process through DVLA. Stable per type — not per session.
  function seededResolve(n) {
    const raw = Math.sin(n * 6089 + 61) * 103_007;
    return raw - Math.floor(raw);
  }
  const ALERT_TYPE_BASE_DAYS = {
    convoy_delay:        0.6,
    integration_failure: 0.8,
    axle_load_breach:    1.4,
    payload_variance:    1.2,
    hse_event:           2.1,
    sla_breach:          3.0,
    maintenance_cluster: 4.5,
    payment_ageing:      5.6,
    filing_overdue:      6.0,
    licence_expiry:      7.2,
    weighbridge_hold:    0.9,
  };
  const resolution_by_type = Object.entries(ALERT_TYPE_BASE_DAYS)
    .map(([type, baseDays], i) => ({
      type,
      label:    type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      avg_days: Number((baseDays * (0.75 + seededResolve(i * 13 + 7) * 0.50)).toFixed(1)),
      modelled: true,
    }))
    .sort((a, b) => b.avg_days - a.avg_days);

  // Phase 229 — open alert volume by hauler.
  // Groups NEEDS_ACTION + MONITORING alerts by hauler_id so the Alerts page
  // can surface which hauler is generating the most alert load — a fast triage
  // and coaching pointer. Null-hauler (corridor-wide) alerts are grouped under
  // a "Corridor-wide" label so they're visible in the ranking.
  const alertsByHauler = {};
  open.forEach((a) => {
    const key   = a.hauler_id ?? '__corridor__';
    const label = a.hauler_id
      ? (nameById[a.hauler_id] ?? a.hauler_id)
      : 'Corridor-wide';
    if (!alertsByHauler[key]) alertsByHauler[key] = { hauler_id: a.hauler_id, label, count: 0 };
    alertsByHauler[key].count++;
  });
  const alert_volume_by_hauler = Object.values(alertsByHauler)
    .sort((a, b) => b.count - a.count);

  res.json({
    generated_at: new Date().toISOString(),
    summary: {
      open_total:     open.length,
      needs_action:   visible.filter((a) => a.status === 'NEEDS_ACTION').length,
      monitoring:     visible.filter((a) => a.status === 'MONITORING').length,
      snoozed:        snoozed.length,
      resolved:       resolved.length,
      by_severity:    bySeverity,
      assigned_to_me: mine,
      unassigned,
      generated:      generatedTotal,
      auto_cleared:   autoCleared.length,
    },
    severity_trend,
    alert_age_profile,
    resolution_by_type,
    alert_volume_by_hauler,
    alerts: rows,
    auto_cleared: autoCleared,
  });
});

// ── Writes ──────────────────────────────────────────────────────────
function loadForTriage(req, res) {
  const alert = alertById(req.params.id);
  if (!alert) { res.status(404).json({ error: 'Alert not found' }); return null; }
  if (!canTriage(alert, req.user)) {
    res.status(403).json({ error: 'You cannot triage this alert' });
    return null;
  }
  return alert;
}

router.post('/:id/resolve', requireAuth, express.json(), (req, res) => {
  const alert = loadForTriage(req, res); if (!alert) return;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  alertState.resolve(alert.id, {
    by_display: req.user.display_name,
    note: note || null,
  });
  if (note) {
    alertState.addNote(alert.id, {
      body: `Resolved: ${note}`,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
  }
  writeAudit({
    req,
    entity_type: 'alert',
    entity_id:   alert.id,
    action:      'resolve',
    summary:     `Resolved ${summariseAlert(alert)}`,
    payload:     note ? { note } : null,
  });
  res.json(merge(alert));
});

router.post('/:id/snooze', requireAuth, express.json(), (req, res) => {
  const alert = loadForTriage(req, res); if (!alert) return;
  const untilIso = req.body?.until_iso;
  if (!untilIso || Number.isNaN(new Date(untilIso).getTime())) {
    return res.status(400).json({ error: 'until_iso must be a valid ISO timestamp' });
  }
  if (new Date(untilIso).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'until_iso must be in the future' });
  }
  const normalisedUntil = new Date(untilIso).toISOString();
  alertState.snooze(alert.id, { until_iso: normalisedUntil });
  writeAudit({
    req,
    entity_type: 'alert',
    entity_id:   alert.id,
    action:      'snooze',
    summary:     `Snoozed ${summariseAlert(alert)} until ${normalisedUntil}`,
    payload:     { until_iso: normalisedUntil },
  });
  res.json(merge(alert));
});

router.post('/:id/reopen', requireAuth, express.json(), (req, res) => {
  const alert = loadForTriage(req, res); if (!alert) return;
  alertState.reopen(alert.id);
  writeAudit({
    req,
    entity_type: 'alert',
    entity_id:   alert.id,
    action:      'reopen',
    summary:     `Reopened ${summariseAlert(alert)}`,
  });
  res.json(merge(alert));
});

router.post('/:id/assign', requireAuth, express.json(), (req, res) => {
  const alert = loadForTriage(req, res); if (!alert) return;
  const { user_id } = req.body || {};
  if (user_id === null || user_id === '') {
    alertState.assign(alert.id, { user_id: null });
    writeAudit({
      req,
      entity_type: 'alert',
      entity_id:   alert.id,
      action:      'unassign',
      summary:     `Unassigned ${summariseAlert(alert)}`,
    });
    return res.json(merge(alert));
  }
  const u = users.findById(user_id);
  if (!u) return res.status(400).json({ error: 'Unknown user_id' });
  alertState.assign(alert.id, {
    user_id:      u.id,
    display_name: u.display_name,
    role:         u.role,
  });
  writeAudit({
    req,
    entity_type: 'alert',
    entity_id:   alert.id,
    action:      'assign',
    summary:     `Assigned ${summariseAlert(alert)} to ${u.display_name}`,
    payload:     { assignee_user_id: u.id, assignee_display: u.display_name, assignee_role: u.role },
  });
  res.json(merge(alert));
});

router.post('/:id/note', requireAuth, express.json(), (req, res) => {
  const alert = loadForTriage(req, res); if (!alert) return;
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'note body is required' });
  const note = alertState.addNote(alert.id, {
    body,
    by_user_id: req.user.id,
    by_display: req.user.display_name,
    by_role:    req.user.role,
  });
  writeAudit({
    req,
    entity_type: 'alert',
    entity_id:   alert.id,
    action:      'note',
    summary:     `Note added to ${summariseAlert(alert)}`,
    payload:     { note_id: note.id, body },
  });
  res.json({ alert: merge(alert), note });
});

module.exports = router;
