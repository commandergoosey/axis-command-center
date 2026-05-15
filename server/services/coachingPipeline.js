'use strict';

/*
 * Coaching pipeline — Phase 81.
 *
 * Composes the "drivers needing coaching" list by joining the
 * flagged-driver mock against the durable coachingState session
 * log. Each pipeline row carries the driver's current flag, days
 * since last attended session, hauler, and the next-session-due
 * cadence (90 days for routine, sooner for active flags).
 *
 * Pure compose, no writes. Read-open at the route layer (all
 * roles can see the pipeline; lender doesn't get drilled-in
 * driver detail elsewhere but the corridor-level pipeline is
 * fine).
 */

const coachingState = require('../state/coachingState');
const { DRIVERS }   = require('../mock/drivers');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Flag → urgency tier. Drivers with active flags get tighter
// cadences than the default 90-day rotation.
const FLAG_URGENCY = {
  rest_breach:       { tier: 'urgent',   cadence_days: 14 },
  coaching_due:      { tier: 'high',     cadence_days: 30 },
  licence_expiring:  { tier: 'medium',   cadence_days: 60 },
  psv_expiring:      { tier: 'medium',   cadence_days: 60 },
};
const DEFAULT_CADENCE_DAYS = 90;

const TIER_RANK = { urgent: 0, high: 1, medium: 2, routine: 3 };

function compose(now = Date.now()) {
  // Index sessions by attendee driver_id for an O(1) lookup.
  const sessions = coachingState.all();
  const lastSessionByDriver = new Map();
  for (const s of sessions) {
    for (const did of s.attendee_driver_ids || []) {
      const existing = lastSessionByDriver.get(did);
      if (!existing || s.held_at > existing.held_at) {
        lastSessionByDriver.set(did, s);
      }
    }
  }

  // Build the row per driver. Pipeline includes flagged drivers
  // OR drivers whose last session is past the routine cadence
  // (so a driver who's gone 90+ days without coaching surfaces
  // even if they have no active flag).
  const rows = [];
  for (const d of DRIVERS) {
    const last = lastSessionByDriver.get(d.id) || null;
    const lastMs = last ? new Date(last.held_at).getTime() : null;
    const daysSinceLast = lastMs == null ? null : Math.floor((now - lastMs) / ONE_DAY_MS);
    const urgency = d.flag && FLAG_URGENCY[d.flag] ? FLAG_URGENCY[d.flag] : null;
    const cadence = urgency?.cadence_days ?? DEFAULT_CADENCE_DAYS;
    const dueIn = lastMs == null ? -9999 : cadence - daysSinceLast; // negative = overdue
    const overdue = dueIn < 0;

    // Include if flagged OR overdue against cadence.
    if (!d.flag && !overdue && daysSinceLast != null && daysSinceLast < cadence) continue;

    const tier = urgency?.tier
      ?? (overdue && lastMs != null ? 'high'
          : lastMs == null         ? 'medium'
          :                          'routine');

    rows.push({
      driver_id:        d.id,
      full_name:        d.full_name,
      hauler_id:        d.hauler_id,
      hauler_display:   d.hauler_display,
      assigned_plate:   d.assigned_plate,
      flag:             d.flag,
      tier,
      safety_score:     d.safety_score,
      harsh_events_7d:  d.harsh_events_7d,
      rest_status:      d.rest_status,
      hours_this_week:  d.hours_this_week,
      cadence_days:     cadence,
      last_session_at:  last?.held_at ?? null,
      last_session_topic: last?.topic ?? null,
      days_since_last:  daysSinceLast,
      due_in_days:      dueIn,    // negative = overdue
      overdue,
    });
  }

  // Sort: tier urgency first (urgent → routine), then overdue
  // amount (most overdue first), then lowest safety score.
  rows.sort((a, b) => {
    const t = (TIER_RANK[a.tier] ?? 4) - (TIER_RANK[b.tier] ?? 4);
    if (t !== 0) return t;
    if (a.overdue && !b.overdue) return -1;
    if (b.overdue && !a.overdue) return 1;
    if (a.overdue && b.overdue) return a.due_in_days - b.due_in_days; // more negative first
    return (a.safety_score ?? 100) - (b.safety_score ?? 100);
  });

  // Counters useful for the page KPI strip — computed BEFORE the
  // page-cap so the badges reflect the true pipeline depth.
  const counts = rows.reduce((m, r) => {
    m.total++;
    m.by_tier[r.tier] = (m.by_tier[r.tier] || 0) + 1;
    if (r.flag) m.flagged++;
    if (r.overdue) m.overdue++;
    return m;
  }, { total: 0, flagged: 0, overdue: 0, by_tier: {} });

  // Cap the pipeline list at top 50 — the page renders the worst
  // entries first; routine-cadence drivers behind them are reflected
  // in the counts.
  const PAGE_CAP = 50;

  // Recent sessions for the page's history column.
  const recentSessions = coachingState.recentWindow(30).slice(0, 20);

  return {
    generated_at: new Date(now).toISOString(),
    counts,
    pipeline:        rows.slice(0, PAGE_CAP),
    pipeline_capped: rows.length > PAGE_CAP,
    recent_sessions: recentSessions,
  };
}

module.exports = { compose };
