'use strict';

/*
 * Dispatcher coaching sessions — Phase 30.
 *
 * POST /api/coaching/sessions
 *   axis_ops / axis_admin (hauler_admin may log against their own hauler).
 *   On create we auto-close any axle alerts in linked_alert_ids: they
 *   transition to RESOLVED with a note referencing the coaching session.
 *   Downstream: alertSynth.synthAxleHolds honours a 7-day cooldown per
 *   hauler, so the same `gen-axle-{hauler}` id won't re-emit on pre-
 *   existing holds while the coaching intervention is fresh.
 *
 * GET /api/coaching/sessions
 *   Scoped to caller — hauler_admin sees own hauler only.
 */

const express = require('express');
const router = express.Router();

const coachingState = require('../state/coachingState');
const alertState    = require('../state/alertState');
const haulers       = require('../mock/haulers');
const coachingPipeline = require('../services/coachingPipeline');
const { writeAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

function canWriteForHauler(user, haulerId) {
  if (!user) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops') return true;
  if (user.role === 'hauler_admin') return haulerId === user.hauler_id;
  return false;
}

// ── Phase 81 — Coaching pipeline ──────────────────────────────────
//
// Composed view of drivers needing intervention. Joins the
// flagged-driver mock against the durable session log and ranks
// by tier + overdue amount + safety score. Used by the /coaching
// page and the Today right-rail observation.
router.get('/pipeline', requireAuth, (req, res) => {
  const data = coachingPipeline.compose();
  // Hauler-admin scope: filter to their own hauler.
  if (req.user.role === 'hauler_admin') {
    const haulerId = req.user.hauler_id;
    data.pipeline = data.pipeline.filter((r) => r.hauler_id === haulerId);
    data.recent_sessions = data.recent_sessions.filter((s) => s.hauler_id === haulerId);
    // Recompute counts for the filtered view so the KPI strip is accurate.
    data.counts = data.pipeline.reduce((m, r) => {
      m.total++;
      m.by_tier[r.tier] = (m.by_tier[r.tier] || 0) + 1;
      if (r.flag) m.flagged++;
      if (r.overdue) m.overdue++;
      return m;
    }, { total: 0, flagged: 0, overdue: 0, by_tier: {} });
  }

  // Phase 144 — effectiveness summary: group recent sessions by tier and
  // compute avg expected safety delta so ops can see coaching ROI per cohort.
  const TIER_ORDER = ['urgent', 'high', 'medium', 'routine'];
  const cohorts = {};
  (data.recent_sessions ?? []).forEach((s) => {
    const tier = s.tier ?? 'routine';
    if (!cohorts[tier]) cohorts[tier] = { tier, sessions: 0, attendees: 0, sum_delta: 0 };
    cohorts[tier].sessions++;
    cohorts[tier].attendees   += s.attendees_count ?? 1;
    cohorts[tier].sum_delta   += s.expected_delta_pct ?? 0;
  });
  data.effectiveness_summary = TIER_ORDER
    .filter((t) => cohorts[t])
    .map((t) => {
      const g = cohorts[t];
      return {
        tier:                     t,
        sessions:                 g.sessions,
        attendees:                g.attendees,
        avg_expected_delta_pct:   g.sessions > 0
          ? Number((g.sum_delta / g.sessions).toFixed(1))
          : 0,
      };
    });

  // Phase 176 — 8-week coaching session volume trend.
  // Current week uses live session data; prior 7 weeks are seeded. MODELLED.
  function seededCoach(n) {
    const raw = Math.sin(n * 6571 + 59) * 113_003;
    return raw - Math.floor(raw);
  }
  const currentTierCounts = {};
  TIER_ORDER.forEach((t) => { currentTierCounts[t] = cohorts[t]?.sessions ?? 0; });
  const currentWeekTotal = Object.values(currentTierCounts).reduce((s, v) => s + v, 0);
  const session_trend = [];
  for (let w = 7; w >= 0; w--) {
    const weekMs = Date.now() - w * 7 * 86_400_000;
    const monday = new Date(weekMs);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const label = monday.toISOString().slice(0, 10);
    const wk    = Math.round(weekMs / (7 * 86_400_000));
    const entry = { week: label, is_current: w === 0, modelled: w > 0 };
    if (w === 0) {
      TIER_ORDER.forEach((t) => { entry[t] = currentTierCounts[t]; });
      entry.total        = currentWeekTotal;
      entry.completion_pct = currentWeekTotal > 0
        ? Math.min(100, Math.round(currentWeekTotal / Math.max(1, (data.pipeline?.length ?? 4)) * 100))
        : 0;
    } else {
      const total = Math.round(2 + seededCoach(wk) * 8);
      entry.urgent  = Math.round(seededCoach(wk + 10) * 1.5);
      entry.high    = Math.round(seededCoach(wk + 20) * 2.5);
      entry.medium  = Math.round(seededCoach(wk + 30) * 2.5);
      entry.routine = Math.max(0, total - entry.urgent - entry.high - entry.medium);
      entry.total   = total;
      entry.completion_pct = Math.round(55 + seededCoach(wk + 50) * 35);
    }
    session_trend.push(entry);
  }
  data.session_trend = session_trend;

  // Phase 192 — coaching backlog by hauler. Groups the pipeline[] by hauler_id
  // and counts entries per tier so the Coaching page can show which hauler has
  // the most outstanding intervention work. Sorted by urgent + high desc.
  const backlogByHauler = {};
  (data.pipeline ?? []).forEach((r) => {
    if (!backlogByHauler[r.hauler_id]) {
      backlogByHauler[r.hauler_id] = {
        hauler_id:     r.hauler_id,
        hauler_display: r.hauler_display ?? r.hauler_id,
        urgent: 0, high: 0, medium: 0, routine: 0, total: 0,
      };
    }
    const h = backlogByHauler[r.hauler_id];
    h.total++;
    const tier = r.tier ?? 'routine';
    if (h[tier] !== undefined) h[tier]++;
  });
  data.backlog_by_hauler = Object.values(backlogByHauler)
    .sort((a, b) => (b.urgent + b.high) - (a.urgent + a.high) || b.total - a.total);

  res.json(data);
});

router.get('/sessions', (req, res) => {
  let rows = coachingState.all();
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id) {
    rows = rows.filter((r) => r.hauler_id === req.user.hauler_id);
  }
  // Phase 54 — enrich with attendee names so the Compliance log can
  // render "Driver 02-117, Driver 02-042" without doing the join
  // client-side. Resolves against the static DRIVERS fixture.
  const driversById = require('../mock/drivers').DRIVERS.reduce(
    (m, d) => { m[d.id] = d.full_name; return m; }, {},
  );
  rows = rows.map((r) => ({
    ...r,
    attendee_drivers: (r.attendee_driver_ids || []).map((id) => ({
      id,
      display_name: driversById[id] || id,
    })),
  }));
  res.json({ generated_at: new Date().toISOString(), sessions: rows });
});

router.get('/sessions/:id', (req, res) => {
  const row = coachingState.findById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Coaching session not found' });
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id
   && row.hauler_id !== req.user.hauler_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(row);
});

router.post('/sessions', requireAuth, express.json(), (req, res) => {
  const body = req.body || {};
  const hauler_id = typeof body.hauler_id === 'string' ? body.hauler_id.trim() : '';
  if (!hauler_id) return res.status(400).json({ error: 'hauler_id is required' });
  const hauler = haulers.find((h) => h.id === hauler_id);
  if (!hauler) return res.status(404).json({ error: 'Hauler not found' });

  if (!canWriteForHauler(req.user, hauler_id)) {
    return res.status(403).json({ error: 'You cannot log coaching sessions for this hauler' });
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const linked = Array.isArray(body.linked_alert_ids)
    ? body.linked_alert_ids.filter((x) => typeof x === 'string' && x.length > 0)
    : [];

  // Phase 54 — accept per-driver attendee linkage. The fixture-driver
  // ids are accepted as-is (no roster validation here — drivers are
  // hauler-scoped and the synth will tolerate stale ids). Audit
  // payload carries the count separate from the legacy
  // `attendees_count` so historical rows aren't silently overwritten.
  const attendeeDriverIds = Array.isArray(body.attendee_driver_ids)
    ? body.attendee_driver_ids.filter((x) => typeof x === 'string' && x.length > 0)
    : [];

  const session = coachingState.create({
    hauler_id,
    held_at:            typeof body.held_at === 'string' ? body.held_at : null,
    topic,
    dispatcher_name:    typeof body.dispatcher_name === 'string' ? body.dispatcher_name.trim() : null,
    attendees_count:    body.attendees_count,
    expected_delta_pct: body.expected_delta_pct,
    notes:              typeof body.notes === 'string' ? body.notes.trim() : null,
    linked_alert_ids:   linked,
    attendee_driver_ids: attendeeDriverIds,
    created_by_user_id: req.user.id,
    created_by_display: `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`,
  });

  // Auto-close any linked alerts — operator selected them precisely because
  // the coaching session supersedes them. Status flips to RESOLVED with a
  // note pointing at the session id so the alerts page reads as intended.
  const autoClosed = [];
  for (const alertId of linked) {
    try {
      alertState.resolve(alertId, {
        by_display: `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`,
        note:       `Resolved via coaching session ${session.id} (${topic})`,
      });
      autoClosed.push(alertId);
      writeAudit({
        req,
        entity_type: 'alert',
        entity_id:   alertId,
        action:      'resolve',
        summary:     `Auto-resolved via coaching session ${session.id}`,
        payload:     { coaching_session_id: session.id, hauler_id, topic },
      });
    } catch (err) {
      console.error('[coaching] auto-close failed for', alertId, err.message);
    }
  }

  writeAudit({
    req,
    entity_type: 'coaching_session',
    entity_id:   session.id,
    action:      'create',
    summary:     `Logged dispatcher coaching session for ${hauler.display_name} · ${topic}`,
    payload: {
      hauler_id,
      hauler_display:     hauler.display_name,
      topic,
      dispatcher_name:    session.dispatcher_name,
      attendees_count:    session.attendees_count,
      expected_delta_pct: session.expected_delta_pct,
      linked_alert_ids:   linked,
      auto_closed_alerts: autoClosed,
      // Phase 54 — per-driver attendees so the audit row can be replayed
      // back into a driver dossier later.
      attendee_driver_ids: attendeeDriverIds,
    },
  });

  res.status(201).json({
    ...session,
    auto_closed_alerts: autoClosed,
  });
});

// Hauler-level recent-sessions lookup — used by the coaching strip on
// the hauler detail view.
router.get('/haulers/:haulerId/recent', (req, res) => {
  const haulerId = req.params.haulerId;
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id
   && haulerId !== req.user.hauler_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const days = Number.isFinite(+req.query.days) ? +req.query.days : 30;
  const rows = coachingState.forHauler(haulerId)
    .filter((r) => (Date.now() - new Date(r.held_at).getTime()) <= days * 24 * 60 * 60 * 1000);
  res.json({ generated_at: new Date().toISOString(), days, sessions: rows });
});

module.exports = router;
