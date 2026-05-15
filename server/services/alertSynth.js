'use strict';

/*
 * Alert synthesizer — Phase 27.
 *
 * Composes alert candidates from current operational state. Triggers:
 *   - axle holds in last 24h (per-hauler, threshold-tiered severity)
 *   - filings past due or due within 3 days, not yet FILED
 *   - critical-maintenance clusters (>=3 critical rigs at one hauler)
 *   - integration probe failures (creds set, last probe failed)
 *
 * IDs are stable so the alertState overlay (assignee, snooze, manual resolve,
 * notes) sticks across requests. When a condition clears the synthesizer just
 * stops emitting — that's the auto-close behaviour the briefing needs.
 *
 * No persistence here: this module is a pure function of mock + integration
 * state, called on every alerts read.
 */

const { AXLE_EVENTS, FILINGS, LICENCE_EXPIRY } = require('../mock/compliance');
const { FLEET } = require('../mock/fleet');
const { ALERTS: STATIC_ALERTS } = require('../mock/alerts');
const filingState = require('../state/filingState');
const integrationStore = require('../state/integrationStore');
const workorderState = require('../state/workorderState');
const coachingState = require('../state/coachingState');
const licenceState = require('../state/licenceState');
const incidentState = require('../state/incidentState');
const weighbridgeEvents = require('../state/weighbridgeEvents');
// Phase 134 — covenant breach alerts
const { buildCovenants } = require('./covenants');
const roster = require('../state/roster');
const haulers = require('../mock/haulers');

const COACHING_COOLDOWN_DAYS = 7;
const HSE_CLOSEOUT_LOOKBACK_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function nameOf(haulerId) {
  return haulers.find((h) => h.id === haulerId)?.display_name ?? haulerId;
}

function mergedFiling(filing) {
  const st = filingState.getState(filing.id);
  return st ? { ...filing, status: st.status, submitted_at: st.submitted_at } : filing;
}

function daysUntil(iso, now) {
  return Math.ceil((new Date(iso).getTime() - now) / ONE_DAY_MS);
}

// ── 1. Axle holds (per hauler, last 24h) ─────────────────────────────

function synthAxleHolds(now) {
  const recent = AXLE_EVENTS.filter((e) =>
    e.action === 'HOLD' && (now - new Date(e.timestamp).getTime()) <= ONE_DAY_MS,
  );
  if (recent.length === 0) return [];

  const byHauler = recent.reduce((m, e) => {
    (m[e.hauler_id] = m[e.hauler_id] || []).push(e);
    return m;
  }, {});

  return Object.entries(byHauler)
    // Cooldown — if the hauler has been coached in the last 7 days we
    // assume the intervention is underway. Suppressing the alert prevents
    // a fresh `gen-axle-{hauler}` from re-opening on the same pre-
    // existing holds immediately after the operator closed the old one
    // from the coaching session.
    .filter(([haulerId]) => !coachingState.recentForHauler(haulerId, COACHING_COOLDOWN_DAYS, now))
    .map(([haulerId, events]) => {
    const latest  = events.reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
    const severity = events.length >= 2 ? 'CRITICAL' : 'WARNING';
    const totalKg  = events.reduce((acc, e) => acc + (e.overload_kg || 0), 0);
    const totalDelay = events.reduce((acc, e) => acc + (e.delay_min || 0), 0);
    return {
      id:        `gen-axle-${haulerId}`,
      opened_at: latest.timestamp,
      severity,
      type:      'axle_load_breach',
      title:     `Axle-load holds · ${nameOf(haulerId)}`,
      hauler_id: haulerId,
      asset_ref: latest.truck,
      body:      `${events.length} weighbridge hold${events.length === 1 ? '' : 's'} in last 24h. Aggregate overload ${(totalKg / 1000).toFixed(1)} t; delay ${totalDelay} min.`,
      impact:    'Repeated holds risk SLA offloading band and signal a dispatcher pre-departure check failure.',
      action:    `Coach ${nameOf(haulerId)} dispatcher on pre-departure axle verification`,
      status:    'NEEDS_ACTION',
      link:      { label: 'Open compliance', path: '/compliance' },
      default_owner_role: 'axis_ops',
      generated: true,
    };
  });
}

// ── 2. Filings due / overdue ─────────────────────────────────────────

function synthFilings(now) {
  return FILINGS
    .map(mergedFiling)
    .filter((f) => f.status !== 'FILED')
    .map((f) => {
      const days = daysUntil(f.due, now);
      if (days > 3) return null; // only emit when overdue or close
      const severity = days < 0 ? 'CRITICAL' : 'WARNING';
      return {
        id:        `gen-filing-${f.id}`,
        opened_at: new Date(now).toISOString(),
        severity,
        type:      'filing_overdue',
        title:     days < 0
          ? `${f.agency} filing overdue (${Math.abs(days)}d)`
          : `${f.agency} filing due in ${days}d`,
        hauler_id: null,
        asset_ref: f.id,
        body:      `${f.detail.split('·')[0].trim()} · due ${f.due}.`,
        impact:    days < 0
          ? 'Agency filing past due. Late submission risks compliance flag and potential penalty.'
          : 'Window closing. Submit before due date to keep clean filing record.',
        action:    `Submit ${f.agency} filing ${f.id}`,
        status:    'NEEDS_ACTION',
        link:      { label: 'Open compliance', path: '/compliance' },
        default_owner_role: 'axis_admin',
        generated: true,
      };
    })
    .filter(Boolean);
}

// ── 3. Critical-maintenance clusters ─────────────────────────────────

function synthMaintenance() {
  // Rigs under an active workorder are "being worked on" — they don't
  // count against the cluster threshold. Alerts should fire on backlog
  // that isn't being addressed, not backlog that workshop has absorbed.
  const remediating = workorderState.rigsInRemediation();

  const critByHauler = FLEET
    .filter((r) => r.maintenance_flag === 'critical' && !remediating.has(r.id))
    .reduce((m, r) => {
      (m[r.hauler_id] = m[r.hauler_id] || []).push(r);
      return m;
    }, {});

  return Object.entries(critByHauler)
    .filter(([, rigs]) => rigs.length >= 3)
    .map(([haulerId, rigs]) => ({
      id:        `gen-maint-${haulerId}`,
      opened_at: new Date().toISOString(),
      severity:  rigs.length >= 5 ? 'CRITICAL' : 'WARNING',
      type:      'maintenance_cluster',
      title:     `${nameOf(haulerId)} maintenance backlog`,
      hauler_id: haulerId,
      asset_ref: null,
      body:      `${rigs.length} rigs flagged critical with no active workorder. Active fleet capacity reduced accordingly.`,
      impact:    'Sustained backlog erodes contracted truck count and depresses run-rate against take-or-pay floor.',
      action:    `Open workorders at ${nameOf(haulerId)} or expedite workshop release`,
      status:    'NEEDS_ACTION',
      link:      { label: 'Open maintenance', path: '/maintenance' },
      default_owner_role: 'hauler_admin',
      generated: true,
    }));
}

// ── 4. Integration probe failures ────────────────────────────────────

function synthIntegrationFailures() {
  const out = [];
  for (const h of haulers) {
    const s = integrationStore.summary(h.id);
    if (!s.has_credentials) continue;
    if (s.live) continue;
    if (!s.last_probe) continue; // no probe yet — pending, not failure
    out.push({
      id:        `gen-integration-${h.id}`,
      opened_at: s.last_probe.probed_at || new Date().toISOString(),
      severity:  'WARNING',
      type:      'integration_failure',
      title:     `${h.display_name} integration probe failed`,
      hauler_id: h.id,
      asset_ref: null,
      body:      `Last probe at ${s.last_probe.probed_at} did not return live. Adapter: ${s.last_probe.adapter || 'unknown'}.`,
      impact:    'Telemetry gap. Aggregator falls back to last sync; trip and convoy data may stale.',
      action:    `Re-probe ${h.display_name} adapter or rotate credentials`,
      status:    'NEEDS_ACTION',
      link:      { label: 'Open settings', path: '/settings' },
      default_owner_role: 'axis_admin',
      generated: true,
    });
  }
  return out;
}

// ── Lifecycle suppression for static alerts ──────────────────────────
//
// Generated alerts already auto-close when their condition clears (the
// synth just stops emitting). Static alerts in mock/alerts.js never
// stop on their own — but several of them have a one-to-one mapping
// onto a lifecycle entity the operator now has tools to resolve:
//
//   licence_expiry   → suppress when the matching driver's licence has
//                       been renewed via licenceState
//   axle_load_breach → suppress when the hauler has been coached in
//                       the last COACHING_COOLDOWN_DAYS (matches the
//                       gen-axle suppression policy)
//   hse_event        → suppress when there's a CLOSED HSE incident on
//                       the same hauler in the lookback window
//                       (post-coaching closure means the static rollup
//                       no longer reflects what's actually open)
//
// Suppressed alerts are dropped from the API entirely. The lifecycle's
// own audit row (renew, coaching, close) is the durable record of why
// the alert went away.
//
// `whyCleared` returns a structured reason + deep-link to the remediating
// entity, or null if the alert is still live. `suppressedByLifecycle`
// is just the boolean for filter callers — it delegates here so the
// suppression policy lives in exactly one place.
function whyCleared(alert, now) {
  if (alert.status === 'RESOLVED' || alert.status === 'MONITORING') return null;

  if (alert.type === 'licence_expiry' && alert.asset_ref) {
    const match = LICENCE_EXPIRY.find((l) => l.driver === alert.asset_ref);
    const overlay = match ? licenceState.getState(match.id) : null;
    if (overlay) {
      return {
        kind:    'licence_renewed',
        reason:  `Driver licence renewed — new expiry ${overlay.expiry_iso?.slice(0, 10)}`,
        actor:   overlay.renewed_by ?? null,
        when:    overlay.renewed_at ?? null,
        link:    { label: 'View renewal', path: '/compliance' },
      };
    }
  }

  if (alert.type === 'axle_load_breach' && alert.hauler_id) {
    const session = coachingState.recentForHauler(alert.hauler_id, COACHING_COOLDOWN_DAYS, now);
    if (session) {
      return {
        kind:    'coaching_logged',
        reason:  `Dispatcher coached within ${COACHING_COOLDOWN_DAYS}d — ${session.topic || 'pre-departure axle verification'}`,
        actor:   session.created_by_display ?? null,
        when:    session.held_at ?? session.created_at ?? null,
        link:    { label: 'View coaching log', path: '/compliance' },
      };
    }
  }

  if (alert.type === 'hse_event' && alert.hauler_id) {
    const closed = incidentState
      .since(HSE_CLOSEOUT_LOOKBACK_DAYS, now)
      .filter((i) => i.hauler_id === alert.hauler_id && i.status === 'CLOSED')
      .sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0];
    if (closed) {
      return {
        kind:    'hse_closed',
        reason:  `HSE incident closed — ${closed.corrective_action || 'corrective action recorded'}`,
        actor:   closed.closed_by_display ?? null,
        when:    closed.closed_at ?? null,
        link:    { label: 'View incident', path: '/compliance' },
      };
    }
  }

  return null;
}

function suppressedByLifecycle(alert, now) {
  return whyCleared(alert, now) !== null;
}

// ── Public ────────────────────────────────────────────────────────────

// ── Phase 120 — Live weighbridge hold alerts ─────────────────────────
// One alert per live hold event (not batched by hauler like synthAxleHolds).
// HIGH severity when overage > 3 t; otherwise WARNING.
// These are distinct IDs from synthAxleHolds so they never collide.

function synthLiveWbHolds(now) {
  let events;
  try {
    const since24h = new Date(now - ONE_DAY_MS).toISOString();
    events = weighbridgeEvents.since(since24h);
  } catch (_) { return []; }
  if (!events.length) return [];

  return events.map((e) => {
    const severity = e.overage_t > 3 ? 'CRITICAL' : 'HIGH';
    const ovStr    = e.overage_t > 0 ? ` (+${e.overage_t} t over limit)` : '';
    const holdStr  = e.hold_minutes ? ` · ${e.hold_minutes} min hold` : '';
    return {
      id:        `live-wb-${e.id}`,
      opened_at: e.logged_at,
      severity,
      type:      'axle_load_breach',
      title:     `Weighbridge hold · ${e.plate}`,
      hauler_id: e.hauler_id ?? null,
      asset_ref: e.plate,
      body:      `${e.plate} recorded ${e.gross_weight_t} t GVW${ovStr}${holdStr}.${e.weighbridge ? ` Weighbridge: ${e.weighbridge}.` : ''}`,
      impact:    'Overload events breach LI 2180 and risk GIBDLC SLA penalties.',
      action:    `Follow up with ${e.hauler_id ? nameOf(e.hauler_id) : 'hauler'} dispatcher on pre-departure loading compliance.`,
      status:    'NEEDS_ACTION',
      link:      { label: 'Open compliance', path: '/compliance' },
      default_owner_role: 'axis_ops',
      generated: true,
      is_live:   true,
    };
  });
}

/* ── Phase 134: Covenant breach alerts ────────────────────────────────
 * Calls buildCovenants() on every alerts read. WATCH or BREACH covenants
 * emit a synthetic alert with a stable id (`synth-cov-{id}`) so alertState
 * overlay (snooze, assign, notes) sticks across requests. When the covenant
 * returns to PASS the alert stops emitting — auto-cleared by lifecycle.
 */
function synthCovenantBreaches() {
  let covenants;
  try { covenants = buildCovenants(roster.list(), new Date()); } catch (_) { return []; }

  return covenants
    .filter((c) => c.status === 'WATCH' || c.status === 'BREACH')
    .map((c) => {
      const isBreached = c.status === 'BREACH';
      return {
        id:        `synth-cov-${c.id}`,
        opened_at: new Date().toISOString(),
        severity:  isBreached ? 'CRITICAL' : 'HIGH',
        type:      'covenant_breach',
        title:     `${isBreached ? 'Covenant breach' : 'Covenant watch'} · ${c.name}`,
        body:      `${c.name} is ${c.status}. Current: ${c.metric ?? '—'}.${c.detail ? ' ' + c.detail : ''}`,
        impact:    isBreached
          ? 'Breach triggers lender step-in rights under the side-letter covenant schedule.'
          : 'WATCH status means a breach may be imminent — lender notification may be required.',
        action:    isBreached
          ? 'Notify GIBDLC and DFI lender immediately. Prepare remediation plan.'
          : 'Monitor daily and brief AXIS admin before the next lender call.',
        status:    'NEEDS_ACTION',
        link:      { label: 'Open financials', path: '/financials' },
        default_owner_role: 'axis_admin',
        generated: true,
        is_live:   true,
      };
    });
}

function generated(now = Date.now()) {
  return [
    ...synthAxleHolds(now),
    ...synthLiveWbHolds(now),
    ...synthFilings(now),
    ...synthMaintenance(),
    ...synthIntegrationFailures(),
    ...synthCovenantBreaches(),
  ];
}

// All alerts — static fixture + synthesized — de-duped on id (static
// wins). Static alerts whose underlying lifecycle has been resolved
// are filtered out here so the cockpit doesn't double-shout the
// operator after they've already actioned the root cause.
function allAlerts(now = Date.now()) {
  const seen = new Set(STATIC_ALERTS.map((a) => a.id));
  const gens = generated(now).filter((a) => !seen.has(a.id));
  const live = STATIC_ALERTS.filter((a) => !suppressedByLifecycle(a, now));
  return [...live, ...gens];
}

// Telemetry for the cockpit / reports — which static alerts the
// suppression filter cleared on this read. Each entry carries the
// remediating reason (cleared_by) so the Alerts page can render an
// "Auto-cleared by lifecycle" section that explains why an alert
// silently went away — instead of leaving operators wondering.
function autoClearedAlerts(now = Date.now()) {
  return STATIC_ALERTS
    .map((a) => {
      const reason = whyCleared(a, now);
      if (!reason) return null;
      return { ...a, cleared_by: reason };
    })
    .filter(Boolean);
}

module.exports = { generated, allAlerts, autoClearedAlerts, whyCleared };
