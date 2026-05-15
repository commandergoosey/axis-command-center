'use strict';

/*
 * GET /api/today
 * Composed corridor briefing. Phase 26 wires brief_strip, observations, and
 * action_items to live state — alerts (with triage overlay), axle events,
 * filings (with filing_state overlay), receivables, and fleet maintenance
 * flags. Each action item carries a `link.path` so the right rail deep-links
 * back into the originating page.
 */

const express = require('express');
const router = express.Router();

const roster = require('../state/roster');
const alertState = require('../state/alertState');
const filingState = require('../state/filingState');
const licenceState = require('../state/licenceState');
const incidentState = require('../state/incidentState');
const workorderState = require('../state/workorderState');
const fleetStatus    = require('../state/fleetStatus');
const driverStatus   = require('../state/driverStatus');
const convoyState    = require('../state/convoyState');
const dailyTargets   = require('../state/dailyTargets');
const { aggregate, CONTRACT } = require('../services/aggregator');
const { allAlerts, autoClearedAlerts } = require('../services/alertSynth');
const { buildForecast, buildForecastScenario } = require('../services/forecast');
const { buildCovenants } = require('../services/covenants');
const forecastSnapshots = require('../state/forecastSnapshots');
const actionAssignments = require('../state/actionAssignments');
const actionComments    = require('../state/actionComments');
const notifications     = require('../state/notifications');
const handoverNotes     = require('../state/handoverNotes');
const haulerContacts    = require('../state/haulerContacts');
const forecastScenarios = require('../state/forecastScenarios');
const riskRegister      = require('../state/riskRegister');
const weeklySynthesis   = require('../services/weeklySynthesis');
const upcomingEvents    = require('../services/upcomingEvents');
const coachingPipeline  = require('../services/coachingPipeline');
const users = require('../state/users');
const { writeAudit, listAudit } = require('../db/audit');
const { requireAuth, requireRole } = require('../middleware/auth');

const { AXLE_EVENTS, FILINGS, LICENCE_EXPIRY } = require('../mock/compliance');
const { PAYMENT_SECURITY } = require('../mock/contract');
const { FLEET } = require('../mock/fleet');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const FOURTEEN_DAYS_MS = 14 * ONE_DAY_MS;

// Deterministic pseudo-random derived from an integer seed, for stable mock series
function seeded(i) {
  const x = Math.sin(i * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function convoyCycleSeries(days = 7) {
  const out = [];
  const now = new Date();
  for (let d = days - 1; d >= 0; d -= 1) {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - d);
    const jitter = seeded(d + 1) * 2 - 1; // -1 .. +1
    const cycleH = Number((25.6 - d * 0.15 + jitter * 0.6).toFixed(1));
    const tripsLaden = Math.round(42 + jitter * 6 + (days - d) * 0.2);
    const tripsEmpty = Math.round(44 + jitter * 5 + (days - d) * 0.3);
    out.push({
      date: date.toISOString().slice(0, 10),
      cycle_hours: cycleH,
      trips_laden: tripsLaden,
      trips_empty: tripsEmpty,
    });
  }
  return out;
}

function haulerContributionWeek(agg) {
  // Approximate a 7-day window: scale the MTD figure back to one week share.
  // Deterministic, so the chart is stable during demo.
  const weekFraction = 7 / 20; // demo date is 20 April; 7/20 of the MTD so far
  return agg.haulers
    .filter((h) => h.status === 'active')
    .map((h) => ({
      id: h.id,
      display_name: h.display_name,
      tonnes_week: Math.round(h.tonnes_delivered_mtd * weekFraction),
      on_time_pct: h.performance.on_time_pct,
    }));
}

function dominantStory(agg) {
  const deliveredPct = agg.tonnes.contracted_mtd > 0
    ? (agg.tonnes.delivered_mtd / agg.tonnes.contracted_mtd) * 100
    : 0;
  const floorPct = CONTRACT.take_or_pay_floor_pct * 100;
  const gapHauler = [...agg.haulers]
    .filter((h) => h.status === 'active' && h.tonnes_contracted_mtd > 0)
    .sort(
      (a, b) =>
        a.tonnes_delivered_mtd / a.tonnes_contracted_mtd -
        b.tonnes_delivered_mtd / b.tonnes_contracted_mtd,
    )[0];

  return {
    severity: deliveredPct < floorPct ? 'warn' : 'info',
    headline:
      deliveredPct < floorPct
        ? `Run-rate is ${deliveredPct.toFixed(1)}% of contracted — under the ${floorPct.toFixed(0)}% take-or-pay floor.`
        : `Run-rate is ${deliveredPct.toFixed(1)}% of contracted — ${(deliveredPct - floorPct).toFixed(1)} points above the take-or-pay floor.`,
    body: gapHauler
      ? `${gapHauler.display_name} is the largest gap: ${Math.round((gapHauler.tonnes_delivered_mtd / gapHauler.tonnes_contracted_mtd) * 100)}% of its contracted share, ${gapHauler.fleet.active_trucks} of ${gapHauler.fleet.contracted_trucks} trucks active.`
      : 'All haulers are on or above their contracted share.',
    action: gapHauler
      ? `Escalate ${gapHauler.display_name} activation — ${gapHauler.fleet.contracted_trucks - gapHauler.fleet.active_trucks} trucks idle against contract.`
      : 'Hold current dispatch pattern.',
    metric: {
      label: 'Delivered MTD',
      value_pct: Number(deliveredPct.toFixed(1)),
      floor_pct: Number(floorPct.toFixed(0)),
    },
  };
}

// ── Live merge helpers ─────────────────────────────────────────────

function mergedAlert(alert) {
  const st = alertState.getState(alert.id);
  let status = st.status_override ?? alert.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) {
      status = alert.status;
    }
  }
  return { ...alert, status };
}

function mergedFiling(filing) {
  const st = filingState.getState(filing.id);
  return st ? { ...filing, status: st.status, submitted_at: st.submitted_at } : filing;
}

function isOpen(status) {
  return status !== 'RESOLVED' && status !== 'SNOOZED';
}

function aggedReceivables() {
  const ag = PAYMENT_SECURITY.receivables.ageing;
  return (ag.band_31_60 || 0) + (ag.band_61_90 || 0) + (ag.band_90p || 0);
}

function holdsLast7Days(now = Date.now()) {
  return AXLE_EVENTS.filter((e) =>
    e.action === 'HOLD' && (now - new Date(e.timestamp).getTime()) <= SEVEN_DAYS_MS,
  );
}

// Licence overlay: fold renewal state on top of the fixture so a
// freshly-renewed licence drops out of the urgency window.
function liveLicences(now = Date.now()) {
  return LICENCE_EXPIRY.map((l) => {
    const st = licenceState.getState(l.id);
    const expiry = st?.expiry_iso ?? l.expiry;
    return {
      ...l,
      expiry,
      days_remaining: Math.ceil((new Date(expiry).getTime() - now) / ONE_DAY_MS),
      renewed: !!st,
    };
  });
}

// Critical-flag rigs net of those that already have an OPEN/IN_PROGRESS
// workorder — once the workshop owns the rig, the cockpit shouldn't
// keep nagging the operator about it.
function criticalRigsNetOfRemediation() {
  const inRem = workorderState.rigsInRemediation();
  return FLEET.filter((r) => r.maintenance_flag === 'critical' && !inRem.has(r.id));
}

function nameByIdMap() {
  return Object.fromEntries(roster.list().map((h) => [h.id, h.display_name]));
}

// Priority rank — used to keep the highest-urgency items above the
// 5-item slice when the cockpit gets noisy.
function priorityRank(p) {
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
}

// ── Live brief strip ───────────────────────────────────────────────

function briefStrip(agg) {
  const floorTonnes = Math.round(
    agg.tonnes.contracted_monthly * CONTRACT.take_or_pay_floor_pct,
  );

  const merged = allAlerts().map(mergedAlert);
  const criticalOpen = merged.filter((a) => isOpen(a.status) && a.severity === 'CRITICAL').length;
  const totalOpen    = merged.filter((a) => isOpen(a.status) && a.status !== 'MONITORING').length;

  const holds7d = holdsLast7Days();
  const overloadKgTotal = holds7d.reduce((acc, e) => acc + (e.overload_kg || 0), 0);

  const overdue = aggedReceivables();
  const ag = PAYMENT_SECURITY.receivables.ageing;
  const overdueBucketCount =
    (ag.band_31_60 ? 1 : 0) + (ag.band_61_90 ? 1 : 0) + (ag.band_90p ? 1 : 0);

  return [
    {
      key: 'tor_cushion',
      label: 'Take-or-pay cushion',
      value_tonnes: agg.tonnes.delivered_mtd - Math.round(
        floorTonnes * (agg.tonnes.contracted_mtd / agg.tonnes.contracted_monthly),
      ),
      sub: `Floor: ${Math.round(floorTonnes).toLocaleString('en-GB')} t / month`,
    },
    {
      key: 'axle_breaches',
      label: 'Axle-load breaches',
      value: holds7d.length,
      sub: holds7d.length === 0
        ? 'Last 7 days · clean'
        : `Last 7 days · ${(overloadKgTotal / 1000).toFixed(1)} t aggregate overload`,
    },
    {
      key: 'alerts_critical',
      label: 'Unresolved alerts',
      value: criticalOpen,
      sub: criticalOpen === 0
        ? `${totalOpen} open · no criticals`
        : `${criticalOpen} critical · ${totalOpen} total open`,
    },
    {
      key: 'receivables_aged',
      label: 'Receivables > 30 days',
      value_usd: overdue,
      sub: overdue === 0
        ? 'All within terms'
        : `${overdueBucketCount} ageing band${overdueBucketCount === 1 ? '' : 's'}`,
    },
  ];
}

// ── Live observations ──────────────────────────────────────────────

function observations(agg) {
  const out = [];

  const merged = allAlerts().map(mergedAlert);
  const openCriticals = merged.filter((a) => isOpen(a.status) && a.severity === 'CRITICAL');

  // 1. Highest-severity open alert (if any), keyed off real triage state.
  if (openCriticals[0]) {
    const a = openCriticals[0];
    out.push({
      id: `obs-alert-${a.id}`,
      severity: 'warn',
      body: `${a.title} — ${a.body}`,
    });
  }

  // 2. Axle-load posture — last 7 days, real events.
  const holds7d = holdsLast7Days();
  if (holds7d.length > 0) {
    // Hauler with the most holds drives the call-out.
    const byHauler = holds7d.reduce((m, e) => {
      m[e.hauler_id] = (m[e.hauler_id] || 0) + 1;
      return m;
    }, {});
    const [topHauler, topCount] = Object.entries(byHauler).sort((a, b) => b[1] - a[1])[0];
    const haulerName = agg.haulers.find((h) => h.id === topHauler)?.display_name ?? topHauler;
    const totalDelay = holds7d.reduce((acc, e) => acc + (e.delay_min || 0), 0);
    out.push({
      id: 'obs-axle',
      severity: 'warn',
      body: `${holds7d.length} weighbridge holds in last 7 days. ${haulerName} accounts for ${topCount}; cumulative delay ${totalDelay} min.`,
    });
  }

  // 3. Receivables exposure.
  const overdue = aggedReceivables();
  if (overdue > 0) {
    out.push({
      id: 'obs-receivables',
      severity: 'info',
      body: `Receivables ageing past 30 days at $${overdue.toLocaleString('en-GB')}. Terms ${PAYMENT_SECURITY.receivables.terms_days} days; counterparty GIBDLC.`,
    });
  }

  // 4. SLA attainment, weighted across haulers.
  out.push({
    id: 'obs-sla',
    severity: 'info',
    body: `Corridor-weighted SLA attainment ${agg.sla_attainment_pct.toFixed(1)}%. Manual-mode haulers under-report; expect a small upward correction once integrations are live.`,
  });

  // 5. Filings due in the next 7 days that aren't yet filed.
  const dueSoon = upcomingFilings();
  if (dueSoon[0]) {
    const f = dueSoon[0];
    const days = daysUntil(f.due);
    out.push({
      id: `obs-filing-${f.id}`,
      severity: days <= 3 ? 'warn' : 'info',
      body: `${f.agency} filing "${f.detail.split('·')[0].trim()}" due ${days <= 0 ? 'now' : `in ${days} days`} (${f.due}).`,
    });
  }

  // 6. Driver licence expiry — overlay-aware so a renewal clears it.
  const lic = liveLicences()
    .filter((l) => l.days_remaining <= 30 && !l.renewed)
    .sort((a, b) => a.days_remaining - b.days_remaining)[0];
  if (lic) {
    out.push({
      id: `obs-licence-${lic.id}`,
      severity: lic.days_remaining <= 14 ? 'warn' : 'info',
      body: `${lic.driver} ${lic.document} expires ${lic.expiry.slice(0, 10)} — ${lic.days_remaining} days out. Book the DVLA slot.`,
    });
  }

  // 7. HSE incidents — Cat A or unclosed events in the last 30 days.
  const incidents30 = incidentState.since(30);
  const openCatA = incidents30.filter((i) => i.status === 'OPEN' && i.category === 'A');
  const openCount = incidents30.filter((i) => i.status === 'OPEN').length;
  if (openCatA[0]) {
    const i = openCatA[0];
    const haulerName = agg.haulers.find((h) => h.id === i.hauler_id)?.display_name ?? i.hauler_id;
    out.push({
      id: `obs-hse-${i.id}`,
      severity: 'warn',
      body: `${haulerName} — Cat A "${i.type}" open without corrective action. Close before next regulator audit.`,
    });
  } else if (openCount >= 2) {
    out.push({
      id: 'obs-hse-open',
      severity: 'warn',
      body: `${openCount} HSE incidents open without corrective action. Close-out required before next regulator audit.`,
    });
  }

  // Phase 60 — forecast anomalies in the right-rail too. Same data
  // source as the Intelligence panel; observationSynth.js mirrors
  // these for the chip-question side.
  try {
    const anomalies = require('../services/forecastAnomalies').detect(new Date());
    for (const a of anomalies) out.push(a);
  } catch { /* anomalies are advisory */ }

  // Phase 69 — stale-contact warning. Active haulers we haven't
  // logged a contact with in the last 5 days are a coordination
  // risk: the relationship goes cold, commitments are forgotten,
  // and by the time we notice the silence we're already chasing
  // delivery slip. Surface the worst offender.
  try {
    const STALE_DAYS = 5;
    const now = Date.now();
    const latest = haulerContacts.latestPerHauler();
    const stale = agg.haulers
      .filter((h) => h.status === 'active')
      .map((h) => {
        const entry = latest[h.id];
        const lastMs = entry ? new Date(entry.last_contact_at).getTime() : null;
        const daysSilent = lastMs == null
          ? null
          : Math.floor((now - lastMs) / ONE_DAY_MS);
        return { hauler: h, daysSilent, lastMs };
      })
      .filter((row) => row.daysSilent == null || row.daysSilent >= STALE_DAYS)
      // Worst first: never-contacted (null) sorts above stale; among
      // stale, longest-silent first.
      .sort((a, b) => {
        if (a.daysSilent == null && b.daysSilent == null) return 0;
        if (a.daysSilent == null) return -1;
        if (b.daysSilent == null) return 1;
        return b.daysSilent - a.daysSilent;
      });
    if (stale[0]) {
      const r = stale[0];
      const moreCount = stale.length - 1;
      const moreSuffix = moreCount > 0 ? ` (${moreCount} other${moreCount === 1 ? '' : 's'} also stale)` : '';
      out.push({
        id: `obs-stale-contact-${r.hauler.id}`,
        severity: r.daysSilent == null || r.daysSilent >= 10 ? 'warn' : 'info',
        body: r.daysSilent == null
          ? `${r.hauler.display_name} — no contact ever logged. Open the contact log and reach out${moreSuffix}.`
          : `${r.hauler.display_name} — ${r.daysSilent} days since last contact. Log a check-in${moreSuffix}.`,
      });
    }
  } catch { /* contact log is advisory */ }

  // Phase 72 — stale risk reviews. Risks that haven't been touched
  // in 30+ days have gone cold; the operator should re-confirm the
  // assessment still holds. Surface the worst offender (highest
  // severity, oldest review).
  try {
    const stale = riskRegister.staleReviews(30);
    if (stale.length > 0) {
      const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
      stale.sort((a, b) => {
        const sa = SEV_RANK[a.severity] ?? 3;
        const sb = SEV_RANK[b.severity] ?? 3;
        if (sa !== sb) return sa - sb;
        const ra = a.last_reviewed_at || '0';
        const rb = b.last_reviewed_at || '0';
        return ra.localeCompare(rb);
      });
      const worst = stale[0];
      const more = stale.length - 1;
      const moreSuffix = more > 0 ? ` (${more} other${more === 1 ? '' : 's'} also stale)` : '';
      const daysSilent = worst.last_reviewed_at
        ? Math.floor((Date.now() - new Date(worst.last_reviewed_at).getTime()) / ONE_DAY_MS)
        : null;
      out.push({
        id: `obs-stale-risk-${worst.id}`,
        severity: worst.severity === 'critical' || worst.severity === 'high' ? 'warn' : 'info',
        body: daysSilent == null
          ? `Risk "${worst.title}" has no review on record. Re-confirm assessment${moreSuffix}.`
          : `Risk "${worst.title}" (${worst.severity}) hasn't been reviewed in ${daysSilent} days${moreSuffix}.`,
      });
    }
  } catch { /* risk register is advisory */ }

  // Phase 81 — drivers needing coaching. Pipeline aggregates
  // flagged drivers + drivers past their cadence; surface the
  // worst-tier entry with a count of others also flagged.
  try {
    const pipeline = coachingPipeline.compose();
    const urgent = pipeline.pipeline.filter((r) => r.tier === 'urgent' || r.tier === 'high');
    if (urgent.length > 0) {
      const worst = urgent[0];
      const more = urgent.length - 1;
      const moreSuffix = more > 0 ? ` (${more} other${more === 1 ? '' : 's'} also flagged)` : '';
      const flagLabel = worst.flag ? worst.flag.replace(/_/g, ' ') : 'overdue cadence';
      out.push({
        id: `obs-coaching-${worst.driver_id}`,
        severity: worst.tier === 'urgent' ? 'warn' : 'info',
        body: `${worst.full_name} (${worst.hauler_id}) needs coaching — ${flagLabel}${moreSuffix}.`,
      });
    } else if ((pipeline.counts?.overdue ?? 0) > 0) {
      out.push({
        id: 'obs-coaching-cadence',
        severity: 'info',
        body: `${pipeline.counts.overdue} driver${pipeline.counts.overdue === 1 ? '' : 's'} past coaching cadence — schedule routine sessions.`,
      });
    }
  } catch { /* coaching pipeline is advisory */ }

  // Warn ahead of info, then preserve insertion order. Keeps the
  // sharpest call-out above the cap when the cockpit gets crowded.
  out.sort((a, b) => (a.severity === 'warn' ? 0 : 1) - (b.severity === 'warn' ? 0 : 1));

  return out.slice(0, 6);
}

// ── Live action items ──────────────────────────────────────────────

function upcomingFilings(now = Date.now()) {
  return FILINGS
    .map(mergedFiling)
    .filter((f) => f.status !== 'FILED')
    .filter((f) => {
      const t = new Date(f.due).getTime() - now;
      return t <= SEVEN_DAYS_MS; // includes overdue (negative t)
    })
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
}

function daysUntil(iso, now = Date.now()) {
  return Math.ceil((new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000));
}

function actionItems(agg, forecast = null, { includeSnoozed = false } = {}) {
  const out = [];
  const nameOf = nameByIdMap();
  // Phase 45 — load all assignments once, join inline below. Keeps the
  // per-item synth O(1) on the lookup and means re-emitted items
  // (filing tomorrow, licence next week) re-attach automatically.
  const assignments = actionAssignments.map();
  // Phase 46 — forecast-driven action item. Caller can pass the already
  // computed forecast so we don't double-build; if not, fall back to a
  // fresh build (lazy callers like /action-items/mine).
  const fc = forecast ?? buildForecast(roster.list(), new Date());

  // 0. Phase 46 — Take-or-pay forecast trigger. Leads the synth so a
  //    `high`-priority below-floor projection isn't pushed off the
  //    5-item cap by the rest of the queue. Source key is stable
  //    (`act-forecast-eom`) so an assignment made yesterday re-attaches
  //    today even as the projection moves.
  //
  //    Verdict → priority:
  //      below_floor_at_pace    → high   (projection misses the floor)
  //      banked_floor_drift     → medium (delivered ≥ floor but pace dropping)
  //      above_floor            → low    (under nameplate, covenant safe)
  //      on_pace_for_contracted → not surfaced (nothing to do)
  if (fc && fc.projection.verdict !== 'on_pace_for_contracted') {
    const v        = fc.projection.verdict;
    const priority = v === 'below_floor_at_pace' ? 'high'
                   : v === 'banked_floor_drift'  ? 'medium'
                   : 'low';
    const eomKt   = (fc.projection.eom_tonnes / 1000).toFixed(1);
    const pctFlr  = fc.projection.pct_of_floor.toFixed(0);
    const daysRem = fc.horizon.days_remaining;
    const lift    = fc.required.lift_pct_to_floor;
    const topLever = fc.levers.by_hauler[0];

    const headline =
      v === 'below_floor_at_pace'
        ? `Projected EOM ${eomKt} kt — ${pctFlr}% of floor, ${fc.projection.shortfall_to_floor.toLocaleString()} t short over ${daysRem}d.`
        : v === 'banked_floor_drift'
          ? `Floor banked but pace dropping — projected ${eomKt} kt, only ${(fc.projection.surplus_over_floor).toLocaleString()} t cushion over ${daysRem}d.`
          : `Above floor but ${pctFlr}% of contracted — ${(fc.projection.shortfall_to_contracted / 1000).toFixed(1)} kt below nameplate.`;

    const recommendation =
      lift != null && lift > 0
        ? ` Need +${lift.toFixed(1)}% lift to ${fc.required.daily_to_floor.toLocaleString()} t/d.`
        : '';

    const lever =
      topLever
        ? ` ${topLever.display_name} has ${topLever.idle_trucks} idle trucks (+${topLever.remainder_recovery.toLocaleString()} t recoverable).`
        : '';

    out.push({
      id:       'act-forecast-eom',
      priority,
      body:     `${headline}${recommendation}${lever}`,
      link:     { label: 'Open forecast', path: '/' },
      source:   { type: 'forecast', id: v },
    });
  }

  // 0b. Phase 53 — covenant BREACH triggers. Same pattern as the
  //     forecast item above: stable ID `act-cov-{covenantId}` so an
  //     assignment re-attaches across reads. Skips `cov-take-or-pay`
  //     because the Phase 46 forecast item already covers the same
  //     signal — surfacing both would be noise. WATCH-tier covenants
  //     are intentionally NOT promoted to action items: WATCH is the
  //     advisory tier, BREACH is the ownable tier.
  try {
    const breaches = buildCovenants(roster.list(), new Date())
      .filter((c) => c.status === 'BREACH' && c.id !== 'cov-take-or-pay');
    for (const c of breaches) {
      out.push({
        id:       `act-${c.id}`,
        priority: 'high',
        body:     `Covenant ${c.name} — ${c.metric}. ${c.detail}`,
        link:     { label: 'Open financials', path: '/financials' },
        source:   { type: 'covenant', id: c.id },
      });
    }
  } catch { /* covenants are advisory; never block the synth */ }

  // 1. Open critical/warning alerts — assignable, deep-linked.
  const merged = allAlerts().map(mergedAlert)
    .filter((a) => isOpen(a.status) && (a.severity === 'CRITICAL' || a.severity === 'WARNING'))
    .sort((a, b) => {
      const sev = (s) => (s === 'CRITICAL' ? 0 : 1);
      if (sev(a.severity) !== sev(b.severity)) return sev(a.severity) - sev(b.severity);
      return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime();
    });

  for (const a of merged.slice(0, 3)) {
    out.push({
      id: `act-${a.id}`,
      priority: a.severity === 'CRITICAL' ? 'high' : 'medium',
      body: a.action || a.title,
      link: a.link || { label: 'Open alerts', path: '/alerts' },
      source: { type: 'alert', id: a.id },
    });
  }

  // 2. Filings due in the next 7 days that aren't filed.
  for (const f of upcomingFilings().slice(0, 2)) {
    const days = daysUntil(f.due);
    out.push({
      id: `act-${f.id}`,
      priority: days <= 3 ? 'high' : 'medium',
      body: `${f.agency} — ${f.detail.split('·')[0].trim()} (due ${days <= 0 ? 'now' : `in ${days}d`})`,
      link: { label: 'Open compliance', path: '/compliance' },
      source: { type: 'filing', id: f.id },
    });
  }

  // 3. Driver licence expiry — overlay-aware. Once renewed it drops
  //    out of the cockpit on the next briefing tick.
  const lic = liveLicences()
    .filter((l) => l.days_remaining <= 14 && !l.renewed)
    .sort((a, b) => a.days_remaining - b.days_remaining)[0];
  if (lic) {
    out.push({
      id: `act-${lic.id}`,
      priority: lic.days_remaining <= 7 ? 'high' : 'medium',
      body: `${nameOf[lic.hauler_id] ?? lic.hauler_id} — ${lic.driver} ${lic.document} expires in ${lic.days_remaining}d. Book DVLA renewal.`,
      link: { label: 'Open compliance', path: '/compliance' },
      source: { type: 'licence', id: lic.id },
    });
  }

  // 4. HSE open incidents — Cat A is high-urgency; multiple Cat B
  //    open in 30 days is a medium-urgency rollup.
  const incidents30 = incidentState.since(30);
  const openCatA = incidents30.filter((i) => i.status === 'OPEN' && i.category === 'A');
  const openAll  = incidents30.filter((i) => i.status === 'OPEN');
  if (openCatA[0]) {
    const i = openCatA[0];
    out.push({
      id: `act-${i.id}`,
      priority: 'high',
      body: `${nameOf[i.hauler_id] ?? i.hauler_id} — Cat A "${i.type}" open without corrective action. Close before next regulator audit.`,
      link: { label: 'Open compliance', path: '/compliance' },
      source: { type: 'hse_incident', id: i.id },
    });
  } else if (openAll.length >= 2) {
    out.push({
      id: 'act-hse-open',
      priority: 'medium',
      body: `${openAll.length} HSE incidents open without corrective action. Close-out required before regulator audit.`,
      link: { label: 'Open compliance', path: '/compliance' },
      source: { type: 'hse_incident', id: 'open-rollup' },
    });
  }

  // 5. Critical-maintenance rigs — net of those already in remediation.
  //    Rigs with an OPEN/IN_PROGRESS workorder are excluded; the
  //    workshop owns them and the cockpit shouldn't double-count.
  const criticalRigs = criticalRigsNetOfRemediation();
  if (criticalRigs.length > 0) {
    const byHauler = criticalRigs.reduce((m, r) => {
      m[r.hauler_display] = (m[r.hauler_display] || 0) + 1;
      return m;
    }, {});
    const top = Object.entries(byHauler).sort((a, b) => b[1] - a[1])[0];
    out.push({
      id: 'act-maint-critical',
      priority: criticalRigs.length >= 3 ? 'high' : 'medium',
      body: `${criticalRigs.length} rig${criticalRigs.length === 1 ? '' : 's'} flagged critical without a workorder (${top[0]} leads with ${top[1]}). Open a workorder so the workshop owns it.`,
      link: { label: 'Open maintenance', path: '/maintenance' },
      source: { type: 'maintenance', id: 'critical' },
    });
  }

  // 6. Receivables, if any are aged.
  const overdue = aggedReceivables();
  if (overdue > 0) {
    out.push({
      id: 'act-receivables',
      priority: overdue >= 100_000 ? 'medium' : 'low',
      body: `Chase $${overdue.toLocaleString('en-GB')} overdue receivables with GIBDLC AP.`,
      link: { label: 'Open financials', path: '/financials' },
      source: { type: 'receivables' },
    });
  }

  // Final sort: high → medium → low, preserving insertion order
  // within each tier. Keeps urgency above the 5-item cap when the
  // cockpit gets crowded with mixed-priority items.
  out.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

  // Phase 45 — attach assignment overlay to each item.
  // Phase 48 — by default, drop items whose assignment is snoozed into
  // the future. The assignment row stays in the DB; it just doesn't
  // crowd Today. Wakes up automatically once `snoozed_until <= now`.
  // Callers that need the unfiltered set (the inbox, audit) pass
  // `{ includeSnoozed: true }`.
  // Phase 57 — also attach comment_count (single GROUP BY, no N+1).
  const nowMs = Date.now();
  const isSnoozed = (a) => a?.snooze?.until && new Date(a.snooze.until).getTime() > nowMs;
  const commentCounts = actionComments.countsByItem();

  const enriched = out.map((it) => ({
    ...it,
    assignment:    assignments[it.id] ?? null,
    comment_count: commentCounts[it.id] ?? 0,
  }));

  if (includeSnoozed) return enriched.slice(0, 5);
  return enriched.filter((it) => !isSnoozed(it.assignment)).slice(0, 5);
}

// ── Operations log — Phase 38 ──────────────────────────────────────
//
// "Today says what to do; the operations log says what got done."
// Composes audit_log writes since UTC start-of-day with the auto-
// cleared alerts from alertSynth (Phase 37 telemetry) into a single
// reverse-chronological feed.
//
// Scope: axis_admin / axis_ops see the full corridor feed.
//        hauler_admin sees writes whose payload mentions their hauler_id.
//        lender sees nothing (compliance-restricted intel).
function startOfTodayUtc(now = Date.now()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function payloadMentionsHauler(payload, haulerId) {
  if (!payload || !haulerId) return false;
  if (payload.hauler_id === haulerId) return true;
  // Some payloads carry hauler_id nested (e.g. workorder payload has it
  // directly; HSE payload has hauler_id as a top-level field set on
  // create). Best-effort: stringify + substring scan.
  try {
    return JSON.stringify(payload).includes(`"${haulerId}"`);
  } catch {
    return false;
  }
}

router.get('/operations-log', requireAuth, (req, res) => {
  if (req.user.role === 'lender') {
    return res.status(403).json({ error: 'Operations log is restricted' });
  }

  const since = startOfTodayUtc();
  const { rows: audit } = listAudit({ since, limit: 100 });

  // Filter for hauler scope.
  const haulerScoped = req.user.role === 'hauler_admin' && req.user.hauler_id
    ? audit.filter((r) => payloadMentionsHauler(r.payload, req.user.hauler_id))
    : audit;

  // Auto-cleared alerts as synthetic entries. These don't have a real
  // ts (they're stateless — computed live each request). We anchor
  // them at "now" so they sort to the top and the operator sees that
  // suppression is active right now.
  const synthetic = autoClearedAlerts().map((a) => ({
    id:          `auto-${a.id}`,
    ts:          new Date().toISOString(),
    actor:       { display_name: 'Auto-cleared by lifecycle', role: 'system' },
    entity_type: 'alert',
    entity_id:   a.id,
    action:      'auto_clear',
    summary:     `Suppressed ${a.title} — root cause remediated`,
    payload:     { alert_type: a.type, hauler_id: a.hauler_id, asset_ref: a.asset_ref },
  }));

  // Filter synthetic rows for hauler scope too.
  const syntheticScoped = req.user.role === 'hauler_admin' && req.user.hauler_id
    ? synthetic.filter((s) => s.payload.hauler_id === req.user.hauler_id)
    : synthetic;

  const merged = [...syntheticScoped, ...haulerScoped]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 30);

  // Counts for the header — gives operators a one-glance feel for
  // how active the corridor's been today.
  const counts = {
    writes:       haulerScoped.length,
    auto_cleared: syntheticScoped.length,
    by_type:      haulerScoped.reduce((m, r) => {
      m[r.entity_type] = (m[r.entity_type] || 0) + 1;
      return m;
    }, {}),
  };

  res.json({
    since,
    counts,
    entries: merged,
  });
});

// ── Action item assignment — Phase 45 ──────────────────────────────
//
// Action items are synthesized live, but ownership is durable. We key
// the overlay on the synthetic action item ID (`act-…`) and re-attach
// on every synth pass; if the underlying entity resolves, the synth
// stops emitting that ID and the assignment becomes a paper trail.
// Lender is read-only (no assignment); axis_admin/axis_ops/hauler_admin
// can assign to anyone with a writable role.
const ASSIGN_ROLES = ['axis_admin', 'axis_ops', 'hauler_admin'];

router.post('/action-items/:id/assign', requireRole(...ASSIGN_ROLES), (req, res) => {
  const action_item_id = req.params.id;
  const { assignee_user_id, due_date, notes } = req.body ?? {};
  if (typeof assignee_user_id !== 'string' || !assignee_user_id) {
    return res.status(400).json({ error: 'assignee_user_id is required' });
  }
  const assignee = users.list().find((u) => u.id === assignee_user_id);
  if (!assignee || assignee.role === 'lender') {
    return res.status(400).json({ error: 'Assignee must be a writable user' });
  }
  // Hauler admins can only assign to themselves (no cross-hauler dispatch).
  if (req.user.role === 'hauler_admin' && assignee.id !== req.user.id) {
    return res.status(403).json({ error: 'Hauler admins can only self-assign' });
  }
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
    return res.status(400).json({ error: 'due_date must be YYYY-MM-DD' });
  }
  const row = actionAssignments.assign({
    action_item_id,
    assignee_user_id:      assignee.id,
    assignee_display_name: assignee.display_name,
    assignee_role:         assignee.role,
    due_date:              due_date || null,
    notes:                 notes || null,
    assigned_by_user_id:   req.user.id,
    assigned_by_display:   req.user.display_name,
  });
  writeAudit({
    req,
    entity_type: 'action_item',
    entity_id:   action_item_id,
    action:      'assign',
    summary:     `Assigned to ${assignee.display_name}${due_date ? ` · due ${due_date}` : ''}`,
    payload:     { assignee_user_id: assignee.id, due_date: due_date || null },
  });
  // Phase 59 — notify the new assignee (skipped automatically if they
  // self-assigned). Carries the action item body so the dropdown reads
  // self-contained without an extra fetch.
  try {
    const liveItem = actionItems(aggregate(roster.list()), null, { includeSnoozed: true })
      .find((it) => it.id === action_item_id);
    notifications.emit({
      user_id:       assignee.id,
      event_type:    'assignment',
      body:          `${req.user.display_name} assigned you: ${liveItem?.body ?? action_item_id}`,
      link:          { path: liveItem?.link?.path || '/', label: 'Open' },
      payload:       { action_item_id, due_date: due_date || null },
      actor_user_id: req.user.id,
      actor_display: req.user.display_name,
    });
  } catch { /* notification is advisory — never block the write */ }
  res.json({ assignment: row });
});

// Phase 48 — snooze. Pushes the wake-up date into the future; the
// item stays in the DB (assignment intact) but the synth treats it as
// dormant until `snoozed_until` is reached. Audit-logged so a snooze
// that gets re-snoozed isn't quietly hidden — the trail explains why
// the item disappeared.
router.post('/action-items/:id/snooze', requireRole(...ASSIGN_ROLES), (req, res) => {
  const action_item_id = req.params.id;
  const { until, reason } = req.body ?? {};
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return res.status(400).json({ error: 'until (YYYY-MM-DD) required' });
  }
  if (new Date(until).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'until must be a future date' });
  }
  const existing = actionAssignments.findById(action_item_id);
  if (!existing) return res.status(404).json({ error: 'Item is not assigned; assign before snoozing' });
  // Only the assignee or an axis_admin/axis_ops can snooze.
  const allowed =
    req.user.role === 'axis_admin' || req.user.role === 'axis_ops' ||
    existing.assignee.user_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: 'Not allowed to snooze' });
  const row = actionAssignments.snooze({
    action_item_id,
    until,
    reason,
    by_user_id:  req.user.id,
    by_display:  req.user.display_name,
  });
  writeAudit({
    req,
    entity_type: 'action_item',
    entity_id:   action_item_id,
    action:      'snooze',
    summary:     `Snoozed until ${until}${reason ? ` — ${reason}` : ''}`,
    payload:     { until, reason: reason || null },
  });
  res.json({ assignment: row });
});

router.delete('/action-items/:id/snooze', requireRole(...ASSIGN_ROLES), (req, res) => {
  const action_item_id = req.params.id;
  const existing = actionAssignments.findById(action_item_id);
  if (!existing || !existing.snooze) {
    return res.status(404).json({ error: 'Not snoozed' });
  }
  const allowed =
    req.user.role === 'axis_admin' || req.user.role === 'axis_ops' ||
    existing.assignee.user_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: 'Not allowed to unsnooze' });
  actionAssignments.unsnooze(action_item_id);
  writeAudit({
    req,
    entity_type: 'action_item',
    entity_id:   action_item_id,
    action:      'unsnooze',
    summary:     `Unsnoozed (was until ${existing.snooze.until})`,
    payload:     { previous_until: existing.snooze.until },
  });
  res.json({ unsnoozed: true });
});

router.delete('/action-items/:id/assign', requireRole(...ASSIGN_ROLES), (req, res) => {
  const action_item_id = req.params.id;
  const existing = actionAssignments.findById(action_item_id);
  if (!existing) return res.status(404).json({ error: 'Not assigned' });
  // Only the assignee, the assigner, or an axis_admin can unassign.
  const allowed =
    req.user.role === 'axis_admin' ||
    existing.assignee.user_id === req.user.id ||
    existing.assigned_by.user_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: 'Not allowed to unassign' });
  actionAssignments.unassign(action_item_id);
  writeAudit({
    req,
    entity_type: 'action_item',
    entity_id:   action_item_id,
    action:      'unassign',
    summary:     `Unassigned from ${existing.assignee.display_name}`,
    payload:     { previous_assignee: existing.assignee.user_id },
  });
  res.json({ unassigned: true });
});

// User's own assigned items — both raw assignments AND a join against
// the live synthesized feed so the caller can show "your queue with
// what's still active." Items whose underlying entity has resolved are
// returned with `live: false` so the UI can grey them out.
router.get('/action-items/mine', requireAuth, (req, res) => {
  const mine = actionAssignments.forUser(req.user.id);
  // Phase 48 — pass `includeSnoozed: true` so snoozed assignments can
  // still be matched against their underlying live item. The Today
  // page proper hides snoozed items via the default filter; the inbox
  // surfaces them with a "Snoozed until X" chip.
  const liveAll = actionItems(aggregate(roster.list()), null, { includeSnoozed: true });
  const liveById = liveAll.reduce((m, it) => { m[it.id] = it; return m; }, {});
  const nowMs = Date.now();
  res.json({
    items: mine.map((a) => {
      const live = Boolean(liveById[a.action_item_id]);
      const dueMs = a.due_date ? new Date(a.due_date).getTime() : null;
      const snoozedUntilMs = a.snooze?.until ? new Date(a.snooze.until).getTime() : null;
      const snoozed = snoozedUntilMs != null && snoozedUntilMs > nowMs;
      const overdue = live && !snoozed && dueMs != null && dueMs < nowMs;
      return {
        ...a,
        live,
        snoozed,
        overdue,
        action_item: liveById[a.action_item_id] ?? null,
      };
    }),
  });
});

// ── Acknowledge escalation — Phase 61 ─────────────────────────────
//
// Admin marks an escalation as reviewed. Doesn't unassign or close
// anything — just records that the issue is on someone's radar. Audit
// trail keeps the chain visible.
router.post('/action-items/:id/escalation/acknowledge', requireRole('axis_admin'), (req, res) => {
  const action_item_id = req.params.id;
  const existing = actionAssignments.findById(action_item_id);
  if (!existing || !existing.escalation) {
    return res.status(404).json({ error: 'Item is not escalated' });
  }
  actionAssignments.acknowledgeEscalation(action_item_id);
  writeAudit({
    req,
    entity_type: 'action_item',
    entity_id:   action_item_id,
    action:      'escalation_ack',
    summary:     `Escalation reviewed by ${req.user.display_name}`,
    payload:     { assignee_user_id: existing.assignee.user_id },
  });
  res.json({ acknowledged: true });
});

// ── Action item comments — Phase 57 ────────────────────────────────
//
// Comment thread per action item. Operators log progress over multiple
// days ("called GIBDLC AP, awaiting callback Tuesday"); the next person
// on the desk sees the trail. Read-open to anyone with assignment
// privileges (the same set who can act on these items); writes audited.
const COMMENT_ROLES = ASSIGN_ROLES; // axis_admin, axis_ops, hauler_admin

router.get('/action-items/:id/comments', requireAuth, (req, res) => {
  if (req.user.role === 'lender') {
    return res.status(403).json({ error: 'Comments restricted for the lender persona' });
  }
  const action_item_id = req.params.id;
  res.json({ comments: actionComments.forItem(action_item_id) });
});

router.post('/action-items/:id/comments', requireRole(...COMMENT_ROLES), (req, res) => {
  const action_item_id = req.params.id;
  const body = req.body?.body;
  try {
    const comment = actionComments.add({
      action_item_id,
      body,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'action_item',
      entity_id:   action_item_id,
      action:      'comment',
      summary:     `Comment: ${comment.body.slice(0, 80)}${comment.body.length > 80 ? '…' : ''}`,
      payload:     { comment_id: comment.id },
    });
    // Phase 59 — notify the assignee if a different user commented.
    // Self-notification guard inside emit() handles the "I commented on
    // my own item" case — but we still skip if the item is unassigned.
    try {
      const assignment = actionAssignments.findById(action_item_id);
      if (assignment) {
        notifications.emit({
          user_id:       assignment.assignee.user_id,
          event_type:    'comment',
          body:          `${req.user.display_name} commented: ${comment.body.slice(0, 80)}${comment.body.length > 80 ? '…' : ''}`,
          link:          { path: '/', label: 'Open' },
          payload:       { action_item_id, comment_id: comment.id },
          actor_user_id: req.user.id,
          actor_display: req.user.display_name,
        });
      }
    } catch { /* advisory */ }
    res.json({ comment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/action-items/:id/comments/:commentId', requireRole(...COMMENT_ROLES), (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
  const existing = actionComments.findById(commentId);
  if (!existing) return res.status(404).json({ error: 'Comment not found' });
  // Only the author or an axis_admin can delete.
  const allowed = req.user.role === 'axis_admin' || existing.author.user_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: 'Only the author or an admin can delete' });
  actionComments.remove(commentId);
  writeAudit({
    req,
    entity_type: 'action_item',
    entity_id:   req.params.id,
    action:      'comment_delete',
    summary:     `Deleted comment by ${existing.author.display_name}`,
    payload:     { comment_id: commentId, body_preview: existing.body.slice(0, 60) },
  });
  res.json({ deleted: true });
});

// ── Per-user queue (admin) — Phase 56 ─────────────────────────────
//
// Symmetric to /action-items/mine but reads any user's queue. Used
// by the bulk-reassign UI in Settings — axis_admin needs to see what's
// on someone else's plate before deciding who to transfer it to.
router.get('/action-items/by-user/:userId', requireRole('axis_admin'), (req, res) => {
  const target = users.list().find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const items = actionAssignments.forUser(target.id);
  const liveAll = actionItems(aggregate(roster.list()), null, { includeSnoozed: true });
  const liveById = liveAll.reduce((m, it) => { m[it.id] = it; return m; }, {});
  const nowMs = Date.now();
  res.json({
    user: {
      id:           target.id,
      display_name: target.display_name,
      role:         target.role,
      hauler_id:    target.hauler_id,
    },
    items: items.map((a) => {
      const live = Boolean(liveById[a.action_item_id]);
      const dueMs = a.due_date ? new Date(a.due_date).getTime() : null;
      const snoozedUntilMs = a.snooze?.until ? new Date(a.snooze.until).getTime() : null;
      const snoozed = snoozedUntilMs != null && snoozedUntilMs > nowMs;
      const overdue = live && !snoozed && dueMs != null && dueMs < nowMs;
      return {
        ...a,
        live,
        snoozed,
        overdue,
        action_item: liveById[a.action_item_id] ?? null,
      };
    }),
  });
});

// ── Bulk reassign — Phase 56 ──────────────────────────────────────
//
// Transfer every active assignment from one user to another in one
// shot. Use case: operator goes on leave, admin moves their queue.
// Each transfer is audited individually so the trail still reads as
// "Akosua was unassigned, Kwame was assigned" per item — bulk is a UX
// affordance, not a different audit shape.
//
// Snoozed items are transferred too (same operator might come back
// next week and need to pick up where they left off). Resolved /
// no-longer-live items skip the rewrite — they're paper trail rows
// that the synth doesn't surface anymore.
router.post('/action-items/bulk-reassign', requireRole('axis_admin'), (req, res) => {
  const { from_user_id, to_user_id } = req.body ?? {};
  if (!from_user_id || !to_user_id) {
    return res.status(400).json({ error: 'from_user_id and to_user_id required' });
  }
  if (from_user_id === to_user_id) {
    return res.status(400).json({ error: 'from and to must be different users' });
  }
  const target = users.list().find((u) => u.id === to_user_id);
  if (!target) return res.status(404).json({ error: 'Target user not found' });
  if (target.role === 'lender') {
    return res.status(400).json({ error: 'Cannot reassign to a lender (no write capability)' });
  }
  const source = users.list().find((u) => u.id === from_user_id);
  if (!source) return res.status(404).json({ error: 'Source user not found' });

  const items = actionAssignments.forUser(from_user_id);
  const liveAll = actionItems(aggregate(roster.list()), null, { includeSnoozed: true });
  const liveById = new Set(liveAll.map((it) => it.id));

  const transferred = [];
  const skipped     = [];
  for (const a of items) {
    if (!liveById.has(a.action_item_id)) {
      skipped.push({ id: a.action_item_id, reason: 'no longer live' });
      continue;
    }
    actionAssignments.assign({
      action_item_id:        a.action_item_id,
      assignee_user_id:      target.id,
      assignee_display_name: target.display_name,
      assignee_role:         target.role,
      due_date:              a.due_date,
      notes:                 a.notes,
      assigned_by_user_id:   req.user.id,
      assigned_by_display:   req.user.display_name,
    });
    writeAudit({
      req,
      entity_type: 'action_item',
      entity_id:   a.action_item_id,
      action:      'reassign',
      summary:     `Bulk-reassigned from ${source.display_name} to ${target.display_name}`,
      payload:     {
        from_user_id, to_user_id,
        previous_assignee: source.display_name,
        new_assignee:      target.display_name,
      },
    });
    transferred.push(a.action_item_id);
  }

  // Phase 59 — single rollup notification to the new assignee rather
  // than one per item. The bulk-reassign UX is "everything moved at
  // once"; the notification should match that mental model.
  if (transferred.length > 0) {
    try {
      notifications.emit({
        user_id:       target.id,
        event_type:    'bulk_reassign',
        body:          `${req.user.display_name} transferred ${transferred.length} item${transferred.length === 1 ? '' : 's'} to you from ${source.display_name}`,
        link:          { path: '/', label: 'Open inbox' },
        payload:       { from_user_id, item_ids: transferred },
        actor_user_id: req.user.id,
        actor_display: req.user.display_name,
      });
    } catch { /* advisory */ }
  }

  res.json({
    transferred_count: transferred.length,
    skipped_count:     skipped.length,
    transferred,
    skipped,
  });
});

// ── Phase 83 — Bulk action item operations ────────────────────────
//
// Multi-select sweep on the Today right rail and MyQueue. Two
// operations matter:
//   - bulk-snooze: array of action_item_ids + a single until + reason
//   - bulk-unassign: array of action_item_ids
//
// Both audit per-item so the trail stays granular. Per-item
// permission re-checked: only the assignee or axis_admin/axis_ops
// can act on a given item; items the caller doesn't own are
// skipped (not 403'd) so a partial-permission bulk doesn't fail
// loudly mid-loop.

function canActOnAssignment(user, assignment) {
  if (!assignment) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops') return true;
  return assignment.assignee?.user_id === user.id;
}

router.post('/action-items/bulk-snooze', requireRole(...ASSIGN_ROLES), (req, res) => {
  const { action_item_ids, until, reason } = req.body ?? {};
  if (!Array.isArray(action_item_ids) || action_item_ids.length === 0) {
    return res.status(400).json({ error: 'action_item_ids array required' });
  }
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return res.status(400).json({ error: 'until (YYYY-MM-DD) required' });
  }
  if (new Date(until).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'until must be a future date' });
  }
  const snoozed = [];
  const skipped = [];
  for (const id of action_item_ids) {
    const existing = actionAssignments.findById(id);
    if (!existing) { skipped.push({ id, reason: 'not assigned' }); continue; }
    if (!canActOnAssignment(req.user, existing)) {
      skipped.push({ id, reason: 'not permitted' });
      continue;
    }
    actionAssignments.snooze({
      action_item_id: id,
      until,
      reason,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
    });
    writeAudit({
      req,
      entity_type: 'action_item',
      entity_id:   id,
      action:      'snooze',
      summary:     `Bulk-snoozed until ${until}${reason ? ` — ${reason}` : ''}`,
      payload:     { until, reason: reason || null, bulk: true },
    });
    snoozed.push(id);
  }
  res.json({
    snoozed_count: snoozed.length,
    skipped_count: skipped.length,
    snoozed,
    skipped,
  });
});

router.post('/action-items/bulk-unassign', requireRole(...ASSIGN_ROLES), (req, res) => {
  const { action_item_ids } = req.body ?? {};
  if (!Array.isArray(action_item_ids) || action_item_ids.length === 0) {
    return res.status(400).json({ error: 'action_item_ids array required' });
  }
  const unassigned = [];
  const skipped    = [];
  for (const id of action_item_ids) {
    const existing = actionAssignments.findById(id);
    if (!existing) { skipped.push({ id, reason: 'not assigned' }); continue; }
    if (!canActOnAssignment(req.user, existing)) {
      skipped.push({ id, reason: 'not permitted' });
      continue;
    }
    actionAssignments.unassign(id);
    writeAudit({
      req,
      entity_type: 'action_item',
      entity_id:   id,
      action:      'unassign',
      summary:     `Bulk-unassigned (was ${existing.assignee?.display_name ?? 'unknown'})`,
      payload:     { previous_assignee: existing.assignee?.display_name ?? null, bulk: true },
    });
    unassigned.push(id);
  }
  res.json({
    unassigned_count: unassigned.length,
    skipped_count:    skipped.length,
    unassigned,
    skipped,
  });
});

// ── Take-or-pay forecast — Phase 42 ────────────────────────────────
//
// Standalone endpoint so the Today page (and the digest) can compose
// the projection alongside everything else without re-running the math.
// Visible to all authenticated roles — the lender persona depends on
// this number for debt service coverage; the hauler_admin sees the
// corridor-level view (their own contribution is the lever row keyed
// to their hauler_id).
router.get('/forecast', requireAuth, (_req, res) => {
  const forecast = buildForecast(roster.list(), new Date());
  // Phase 43 — capture today's snapshot opportunistically. Idempotent
  // upsert keyed to UTC date, so heavy traffic just refreshes the row
  // with the freshest read.
  try { forecastSnapshots.capture(forecast); } catch { /* non-fatal */ }
  res.json(forecast);
});

// ── Forecast history — Phase 43 ────────────────────────────────────
//
// Returns the last `days` daily snapshots so the UI can sparkline
// "projected EOM trend." Default 14 d — long enough to see a directional
// signal, short enough that early-month readings don't overpower the
// recent-pace narrative.
router.get('/forecast/history', requireAuth, (req, res) => {
  const days = Math.min(60, Math.max(2, Number(req.query.days) || 14));
  const rows = forecastSnapshots.recent(days);
  res.json({
    days,
    points: rows.map((r) => ({
      date:                 r.snapshot_date,
      captured_at:          r.captured_at,
      eom_tonnes:           r.eom_tonnes,
      pct_of_floor:         r.pct_of_floor,
      pct_of_monthly:       r.pct_of_monthly,
      delivered_mtd:        r.delivered_mtd,
      daily_avg:            r.daily_avg,
      required_daily_floor: r.required_daily_floor,
      verdict:              r.verdict,
      // Carry the floor target so the UI can draw the reference line
      // even if the floor changes mid-month (it doesn't, but keeping the
      // history self-describing means the trend stays correct after
      // contract renegotiation).
      floor_target:         r.floor_target,
      monthly_target:       r.monthly_target,
    })),
  });
});

// ── End-of-day close-out — Phase 51 ───────────────────────────────
//
// "Day in review" — bookend to the morning briefing on Today. Composes
// what the current user needs to see before logging off:
//
//   - their action item queue, split into overdue / due-next-48h /
//     active / snoozed-but-waking-soon
//   - what they shipped today (audit_log filtered to their user_id)
//   - the corridor forecast delta from this morning's snapshot to now
//     (did the day move the line?)
//
// Lender persona is gated out — they don't own action items and the
// "what I shipped" frame doesn't apply.
// ── Operator handover note — Phase 67 ─────────────────────────────
//
// End-of-shift narrative for the incoming operator. Written by
// outgoing axis_admin / axis_ops; visible to all authenticated
// roles on Today. Separate from action item comments (Phase 57)
// which are per-item; this is the corridor-level "what to know
// when you walk in."
const HANDOVER_WRITE_ROLES = ['axis_admin', 'axis_ops'];

router.post('/handover', requireRole(...HANDOVER_WRITE_ROLES), (req, res) => {
  try {
    const note = handoverNotes.add({
      body:       req.body?.body,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'handover_note',
      entity_id:   String(note.id),
      action:      'create',
      summary:     `Posted handover · ${note.body.slice(0, 80)}${note.body.length > 80 ? '…' : ''}`,
    });
    // Notify every other writable user that a handover landed —
    // covers axis_admin and axis_ops, plus hauler_admin (since they
    // also act on corridor signal). Skipped automatically for the
    // author via the self-notification guard.
    try {
      for (const u of users.list()) {
        if (u.role === 'lender' || u.id === req.user.id) continue;
        notifications.emit({
          user_id:    u.id,
          event_type: 'handover',
          body:       `${req.user.display_name} posted a shift handover: ${note.body.slice(0, 100)}${note.body.length > 100 ? '…' : ''}`,
          link:       { path: '/handovers', label: 'View handovers' },
          payload:    { handover_id: note.id },
          actor_user_id: req.user.id,
          actor_display: req.user.display_name,
        });
      }
    } catch { /* advisory */ }
    res.json({ handover: note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/handover/latest', requireAuth, (_req, res) => {
  res.json({ handover: handoverNotes.latest() });
});

// Phase 121 — live-data handover pre-fill.
// Composes a terse briefing paragraph from today's live convoy activity,
// overdue flags, and fleet state. axis_admin / axis_ops only — this is
// a write-surface aid, not a public read.
// Phase 137 — richer AI-drafted shift summary. Composes a structured
// multi-section handover brief from live convoy state, fleet status,
// alerts, and contract MTD pace. Each section is independently
// non-fatal so a partial data failure still yields a useful draft.
router.get('/handover-brief', requireRole(...HANDOVER_WRITE_ROLES), (_req, res) => {
  try {
    const sections = [];

    // ── 1. Convoy ops ─────────────────────────────────────────────
    try {
      const dateKey = dailyTargets.todayKey();
      const { total_tonnes, convoy_count } = convoyState.todayTonnage(dateKey);
      const active   = convoyState.listActive();
      const overdue  = active.filter((c) => c.is_overdue);
      const loadingC = active.filter((c) => c.phase === 'loading');
      const ladenC   = active.filter((c) => c.phase === 'laden');
      const offloadC = active.filter((c) => c.phase === 'offload');
      const target   = dailyTargets.getTarget(dateKey);
      const targetT  = target?.target_tonnes ?? null;

      const opsLines = [];
      if (convoy_count > 0) {
        const tStr   = total_tonnes > 0 ? ` — ${Math.round(total_tonnes * 10) / 10} t southbound` : '';
        const tgtStr = targetT ? ` (target: ${targetT.toLocaleString()} t)` : '';
        opsLines.push(`${convoy_count} convoy${convoy_count === 1 ? '' : 's'} dispatched today${tStr}${tgtStr}.`);
      } else {
        opsLines.push('No convoys dispatched today.');
      }
      const activeParts = [];
      if (ladenC.length)   activeParts.push(`${ladenC.length} en route`);
      if (loadingC.length) activeParts.push(`${loadingC.length} loading`);
      if (offloadC.length) activeParts.push(`${offloadC.length} offloading`);
      if (activeParts.length) opsLines.push(`Active: ${activeParts.join(', ')}.`);
      if (overdue.length) {
        const refs = overdue.map((c) => c.convoy_ref).join(', ');
        opsLines.push(`⚠ Overdue convoys: ${refs}. Confirm phase and ETA before signing off.`);
      }
      sections.push('CONVOY OPS\n' + opsLines.join(' '));
    } catch { /* non-fatal */ }

    // ── 2. Fleet pulse ────────────────────────────────────────────
    try {
      const activeRigs    = FLEET.filter((t) => t.status === 'active').length;
      const garageRigs    = FLEET.filter((t) => t.status === 'garage').length;
      const criticalRigs  = FLEET.filter((t) => t.maintenance_flag === 'critical').length;
      const serviceDueRigs = FLEET.filter((t) => t.maintenance_flag === 'service_due').length;

      const fleetLines = [`Fleet: ${activeRigs} active, ${garageRigs} in workshop.`];
      if (criticalRigs > 0)   fleetLines.push(`${criticalRigs} rig${criticalRigs > 1 ? 's' : ''} critical — pulled from corridor.`);
      if (serviceDueRigs > 0) fleetLines.push(`${serviceDueRigs} rig${serviceDueRigs > 1 ? 's' : ''} overdue service interval — schedule before next laden trip.`);
      sections.push('FLEET\n' + fleetLines.join(' '));
    } catch { /* non-fatal */ }

    // ── 3. Contract MTD pace ──────────────────────────────────────
    try {
      const now     = new Date();
      const agg     = aggregate(roster.list(), now);
      const mtdD    = agg.tonnes.delivered_mtd;
      const mtdC    = agg.tonnes.contracted_mtd;
      const floor   = Math.round(mtdC * CONTRACT.take_or_pay_floor_pct);
      const above   = mtdD >= floor;
      const gap     = Math.round(Math.abs(mtdD - floor));

      const paceStr = above
        ? `MTD: ${Math.round(mtdD).toLocaleString()} t delivered — ${gap.toLocaleString()} t above take-or-pay floor.`
        : `MTD: ${Math.round(mtdD).toLocaleString()} t delivered — ${gap.toLocaleString()} t BELOW take-or-pay floor (${floor.toLocaleString()} t). Escalate if pace worsens.`;
      sections.push('CONTRACT PULSE\n' + paceStr);
    } catch { /* non-fatal */ }

    // ── 4. Open items placeholder ─────────────────────────────────
    sections.push('OPEN ITEMS FOR INCOMING SHIFT\n[Describe outstanding issues, escalations, or actions the incoming operator must pick up.]');

    res.json({
      brief:      sections.join('\n\n'),
      ai_drafted: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/handover', requireAuth, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ handovers: handoverNotes.recent(limit) });
});

router.delete('/handover/:id', requireRole('axis_admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = handoverNotes.findById(id);
  if (!existing) return res.status(404).json({ error: 'Handover not found' });
  handoverNotes.remove(id);
  writeAudit({
    req,
    entity_type: 'handover_note',
    entity_id:   String(id),
    action:      'delete',
    summary:     `Deleted handover by ${existing.author.display_name}`,
  });
  res.json({ deleted: true });
});

// ── Upcoming events calendar — Phase 73 ───────────────────────────
//
// Aggregated forward-looking timeline. Filings, licence renewals,
// action item due dates, hauler contact follow-ups, risk review
// cadences, take-or-pay resets, and contract anniversaries all
// composed into a single ordered feed. Pure read-side; no new
// state. All roles can read — this is corridor-level governance
// data.
router.get('/calendar', requireAuth, (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  res.json(upcomingEvents.compose({ days }));
});

// ── Week in review — Phase 68 ─────────────────────────────────────
//
// Composed read-only weekly synthesis. Zoom-out from the daily
// cockpit: tonnage trajectory across the seven days, action item
// flow (opened / closed / escalated), top themes from the audit
// log, and winners + strugglers among the active haulers. All
// roles can read — lender included; this is the kind of strategic
// summary they'd want for a Friday update.
router.get('/week', requireAuth, (req, res) => {
  // Optional `ending` query param (YYYY-MM-DD) lets the caller
  // anchor the window to a past day. Default = now. Useful for
  // a "look at last Friday" view from the UI.
  let endingMs = Date.now();
  if (req.query.ending) {
    const parsed = Date.parse(req.query.ending + 'T23:59:59.999Z');
    if (Number.isFinite(parsed)) endingMs = parsed;
  }
  res.json(weeklySynthesis.compose(endingMs));
});

router.get('/closeout', requireAuth, (req, res) => {
  if (req.user.role === 'lender') {
    return res.status(403).json({ error: 'Day-in-review is restricted for the lender persona' });
  }

  const now = Date.now();
  const startOfDayIso = startOfTodayUtc(now);

  // Queue — pull the user's assignments, join against the unfiltered
  // live synth (Phase 48's includeSnoozed flag) so we can split into
  // active / overdue / snoozed buckets without losing anything.
  const mineRaw = actionAssignments.forUser(req.user.id);
  const liveAll = actionItems(aggregate(roster.list()), null, { includeSnoozed: true });
  const liveById = liveAll.reduce((m, it) => { m[it.id] = it; return m; }, {});

  const TWO_DAY_MS = 2 * ONE_DAY_MS;
  const SEVEN_DAY_MS = 7 * ONE_DAY_MS;

  const queue = {
    overdue: [], due_next_48h: [], active: [], waking_soon: [], resolved_today: [],
  };

  for (const a of mineRaw) {
    const live = Boolean(liveById[a.action_item_id]);
    const dueMs = a.due_date ? new Date(a.due_date).getTime() : null;
    const snoozedUntilMs = a.snooze?.until ? new Date(a.snooze.until).getTime() : null;
    const snoozed = snoozedUntilMs != null && snoozedUntilMs > now;
    const overdue = live && !snoozed && dueMs != null && dueMs < now;
    const dueSoon = live && !snoozed && dueMs != null && dueMs >= now && (dueMs - now) <= TWO_DAY_MS;
    const wakingSoon = snoozed && (snoozedUntilMs - now) <= SEVEN_DAY_MS;
    const enriched = {
      ...a,
      live,
      snoozed,
      overdue,
      action_item: liveById[a.action_item_id] ?? null,
    };

    if (!live) queue.resolved_today.push(enriched);
    else if (overdue) queue.overdue.push(enriched);
    else if (dueSoon) queue.due_next_48h.push(enriched);
    else if (snoozed && wakingSoon) queue.waking_soon.push(enriched);
    else if (snoozed) { /* far-out snooze — not in any active bucket */ }
    else queue.active.push(enriched);
  }

  // Audit — what the user shipped today.
  const { rows: myWritesAll } = listAudit({ since: startOfDayIso, limit: 500 });
  const myWrites = myWritesAll.filter((r) => r.actor?.user_id === req.user.id);
  const writesByType = myWrites.reduce((m, r) => {
    m[r.entity_type] = (m[r.entity_type] || 0) + 1;
    return m;
  }, {});

  // Forecast delta — first snapshot today vs latest snapshot today.
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const recentSnaps = forecastSnapshots.recent(2, now); // today + yesterday for delta context
  const todaySnap     = recentSnaps.find((s) => s.snapshot_date === todayKey) ?? null;
  const yesterdaySnap = recentSnaps.find((s) => s.snapshot_date !== todayKey) ?? null;
  // Day delta is captured-now vs yesterday's reading. (Snapshots are
  // last-write-wins, so the "morning" reading isn't preserved beyond
  // a single row.) Yesterday vs today is the closest proxy.
  const liveForecast = buildForecast(roster.list(), new Date(now));
  const forecastDelta = yesterdaySnap ? {
    yesterday_eom: yesterdaySnap.eom_tonnes,
    today_eom:     liveForecast.projection.eom_tonnes,
    delta:         liveForecast.projection.eom_tonnes - yesterdaySnap.eom_tonnes,
    today_verdict: liveForecast.projection.verdict,
  } : {
    yesterday_eom: null,
    today_eom:     liveForecast.projection.eom_tonnes,
    delta:         null,
    today_verdict: liveForecast.projection.verdict,
  };

  res.json({
    generated_at: new Date(now).toISOString(),
    user: {
      id:           req.user.id,
      display_name: req.user.display_name,
      role:         req.user.role,
    },
    queue: {
      overdue:        queue.overdue,
      due_next_48h:   queue.due_next_48h,
      active:         queue.active,
      waking_soon:    queue.waking_soon,
      counts: {
        overdue:      queue.overdue.length,
        due_next_48h: queue.due_next_48h.length,
        active:       queue.active.length,
        waking_soon:  queue.waking_soon.length,
        resolved_today: queue.resolved_today.length,
      },
    },
    shipped_today: {
      writes:        myWrites.length,
      by_type:       writesByType,
      first_at:      myWrites.length ? myWrites[myWrites.length - 1].ts : null,
      last_at:       myWrites.length ? myWrites[0].ts : null,
      recent:        myWrites.slice(0, 10),
    },
    forecast: forecastDelta,
  });
});

// ── Forecast scenario planner — Phase 50 ──────────────────────────
//
// Apply operator-controlled levers to the baseline forecast and
// return the projected outcome WITHOUT writing anything. Levers:
//
//   { hauler_truck_lifts: { haul-05: 3 }, resolve_workorders: ['wo-…'],
//     daily_avg_lift_pct: 10 }
//
// All-role visible (axis_admin, axis_ops, hauler_admin, lender) — the
// answer is corridor-level and reasoning about downside cases is
// explicitly part of the lender's job. POST not GET because the body
// can carry meaningful state and future versions might log it.
router.post('/forecast/scenario', requireAuth, (req, res) => {
  const scenario = req.body && typeof req.body === 'object' ? req.body : {};
  const result = buildForecastScenario(roster.list(), scenario, new Date());
  res.json(result);
});

// ── Phase 71 — Forecast scenario library ──────────────────────────
//
// Durable named scenarios. Each saved scenario is re-evaluated
// against current corridor state on every read so a "Hauler 05
// stays flat" scenario saved a week ago always reflects today's
// idle truck counts and workorder list with that override applied
// on top.
//
// Read open to all roles (lender included — they care about
// downside scenarios as much as ops). Write restricted to
// axis_admin / axis_ops; archive too. Delete is admin-only.
const SCENARIO_WRITE_ROLES = ['axis_admin', 'axis_ops'];

router.get('/forecast/scenarios', requireAuth, (_req, res) => {
  const now = new Date();
  const haulers = roster.list();
  const baseline = buildForecast(haulers, now);
  const items = forecastScenarios.listActive().map((scn) => {
    let evaluation = null;
    try {
      const evald = buildForecastScenario(haulers, scn.params, now);
      evaluation = {
        projection: evald.scenario.projection,
        delta:      evald.scenario.delta,
        applied:    evald.scenario.applied,
        totals:     evald.scenario.totals,
      };
    } catch { /* advisory; row stays without an eval if compute fails */ }
    return { ...scn, evaluation };
  });
  res.json({
    baseline: {
      eom_tonnes:        baseline.projection.eom_tonnes,
      pct_of_floor:      baseline.projection.pct_of_floor,
      verdict:           baseline.projection.verdict,
      floor_target:      baseline.targets.floor,
      monthly_target:    baseline.targets.monthly,
    },
    scenarios: items,
  });
});

router.post('/forecast/scenarios', requireRole(...SCENARIO_WRITE_ROLES), (req, res) => {
  try {
    const scn = forecastScenarios.add({
      name:        req.body?.name,
      description: req.body?.description,
      params:      req.body?.params,
      by_user_id:  req.user.id,
      by_display:  req.user.display_name,
      by_role:     req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'forecast_scenario',
      entity_id:   String(scn.id),
      action:      'create',
      summary:     `Saved scenario "${scn.name}"`,
      payload:     { params: scn.params },
    });
    res.json({ scenario: scn });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/forecast/scenarios/:id', requireRole(...SCENARIO_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const updated = forecastScenarios.update(id, {
    name:        req.body?.name,
    description: req.body?.description,
    params:      req.body?.params,
  });
  if (!updated) return res.status(404).json({ error: 'Scenario not found' });
  writeAudit({
    req,
    entity_type: 'forecast_scenario',
    entity_id:   String(id),
    action:      'update',
    summary:     `Updated scenario "${updated.name}"`,
  });
  res.json({ scenario: updated });
});

router.post('/forecast/scenarios/:id/archive', requireRole(...SCENARIO_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = forecastScenarios.findById(id);
  if (!existing) return res.status(404).json({ error: 'Scenario not found' });
  forecastScenarios.archive(id);
  writeAudit({
    req,
    entity_type: 'forecast_scenario',
    entity_id:   String(id),
    action:      'archive',
    summary:     `Archived scenario "${existing.name}"`,
  });
  res.json({ archived: true });
});

router.post('/forecast/scenarios/:id/unarchive', requireRole(...SCENARIO_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = forecastScenarios.findById(id);
  if (!existing) return res.status(404).json({ error: 'Scenario not found' });
  forecastScenarios.unarchive(id);
  writeAudit({
    req,
    entity_type: 'forecast_scenario',
    entity_id:   String(id),
    action:      'unarchive',
    summary:     `Restored scenario "${existing.name}"`,
  });
  res.json({ unarchived: true });
});

router.delete('/forecast/scenarios/:id', requireRole('axis_admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = forecastScenarios.findById(id);
  if (!existing) return res.status(404).json({ error: 'Scenario not found' });
  forecastScenarios.remove(id);
  writeAudit({
    req,
    entity_type: 'forecast_scenario',
    entity_id:   String(id),
    action:      'delete',
    summary:     `Deleted scenario "${existing.name}"`,
  });
  res.json({ deleted: true });
});

// ── Daily digest — Phase 40 ────────────────────────────────────────
//
// One self-contained payload that becomes the printable end-of-day
// briefing. Composes the corridor masthead + hero KPIs + dominant
// story + the observations / open follow-ups still in play + the
// full operations log (no 30-row cap — the digest is the durable
// record) + auto-cleared rollup + filings posture. Generated_by
// stamps the artifact with who exported it.
//
// Scope: same as Today + Operations log — lender restricted.
router.get('/digest', requireAuth, (req, res) => {
  if (req.user.role === 'lender') {
    return res.status(403).json({ error: 'Daily digest is restricted' });
  }

  const now = Date.now();
  const since = startOfTodayUtc(now);
  const agg = aggregate(roster.list());
  // Phase 46 — single forecast build, used both for the digest's
  // forecast section and the action item synth.
  const forecast = buildForecast(roster.list(), new Date(now));

  // Operations log — uncapped. The digest is the artifact you'd
  // hand to a regulator months later, so truncating to 30 would
  // defeat the purpose.
  const { rows: audit } = listAudit({ since, limit: 1000 });
  const haulerScoped = req.user.role === 'hauler_admin' && req.user.hauler_id
    ? audit.filter((r) => payloadMentionsHauler(r.payload, req.user.hauler_id))
    : audit;

  const cleared = autoClearedAlerts(now);
  const clearedScoped = req.user.role === 'hauler_admin' && req.user.hauler_id
    ? cleared.filter((a) => a.hauler_id === req.user.hauler_id)
    : cleared;

  // Filings posture rollup — count by status, surface the next
  // window so the digest reader sees what's coming.
  const allFilings = FILINGS.map(mergedFiling);
  const filings_posture = {
    total:    allFilings.length,
    filed:    allFilings.filter((f) => f.status === 'FILED').length,
    overdue:  allFilings.filter((f) => f.status !== 'FILED' && new Date(f.due).getTime() < now).length,
    due_in_3d: allFilings.filter((f) => {
      if (f.status === 'FILED') return false;
      const d = (new Date(f.due).getTime() - now) / ONE_DAY_MS;
      return d >= 0 && d <= 3;
    }).length,
    upcoming: upcomingFilings(now).slice(0, 5).map((f) => ({
      id: f.id, agency: f.agency, due: f.due, status: f.status,
      detail: f.detail,
    })),
  };

  res.json({
    generated_at: new Date(now).toISOString(),
    generated_by: {
      display_name: req.user.display_name,
      role:         req.user.role,
      organisation: req.user.organisation,
      email:        req.user.email,
    },
    period: {
      since,
      until: new Date(now).toISOString(),
    },
    corridor: {
      name:                  'Nyinahin–Takoradi',
      length_km:             CONTRACT.corridor_km,
      counterparty:          'GIBDLC',
      tonnes_delivered_mtd:  agg.tonnes.delivered_mtd,
      tonnes_contracted_mtd: agg.tonnes.contracted_mtd,
      take_or_pay_floor_pct: CONTRACT.take_or_pay_floor_pct,
      active_trucks_today:   agg.fleet.active_trucks,
      contracted_trucks:     agg.fleet.contracted_trucks,
      sla_attainment_pct:    agg.sla_attainment_pct,
    },
    dominant_story: dominantStory(agg),
    forecast,
    observations:   observations(agg),
    open_action_items: actionItems(agg, forecast),
    haulers: agg.haulers.map((h) => ({
      id:                h.id,
      display_name:      h.display_name,
      status:            h.status,
      active_trucks:     h.fleet.active_trucks,
      contracted_trucks: h.fleet.contracted_trucks,
      on_time_pct:       h.performance.on_time_pct,
      tonnes_mtd:        h.tonnes_delivered_mtd,
    })),
    operations_log: {
      counts: {
        writes:       haulerScoped.length,
        auto_cleared: clearedScoped.length,
        by_type:      haulerScoped.reduce((m, r) => {
          m[r.entity_type] = (m[r.entity_type] || 0) + 1;
          return m;
        }, {}),
      },
      entries: haulerScoped, // newest-first from listAudit
    },
    auto_cleared: clearedScoped, // each carries cleared_by
    filings_posture,
  });
});

// ── Phase 108: Live ops overlay ────────────────────────────────────
//
// Merge the Phase 101–103 operator-written overlays (convoy dispatches,
// fleet status overrides, driver status overrides) into a compact
// live_ops summary injected into the GET / response. The base aggregator
// reads pure mock data; this function surfaces what the operator has
// actually written this session so Today reflects real in-session state.

function computeLiveOps() {
  // ── Fleet: apply per-truck status overrides on top of FLEET mock ──
  const fleetOverrides = fleetStatus.getAllOverrides();
  let activeTrucks = 0, idleTrucks = 0, garageTrucks = 0, criticalFlags = 0;
  const byHauler = {};

  for (const truck of FLEET) {
    const ov    = fleetOverrides.get(truck.id);
    const status = ov ? ov.status : truck.status;
    const flag   = ov ? ov.maintenance_flag : truck.maintenance_flag;

    if (status === 'active' || status === 'in_transit') activeTrucks++;
    else if (status === 'idle')   idleTrucks++;
    else if (status === 'garage') garageTrucks++;
    if (flag === 'critical') criticalFlags++;

    if (!byHauler[truck.hauler_id]) byHauler[truck.hauler_id] = { active: 0, idle: 0, garage: 0 };
    if (status === 'active' || status === 'in_transit') byHauler[truck.hauler_id].active++;
    else if (status === 'idle')   byHauler[truck.hauler_id].idle++;
    else if (status === 'garage') byHauler[truck.hauler_id].garage++;
  }

  // ── Drivers: count from overrides ─────────────────────────────────
  const driverOverrides = driverStatus.getAllOverrides();
  let driversUnavailable = 0, driverBreaches = 0, driverFlagged = 0;
  for (const [, ov] of driverOverrides) {
    if (ov.availability !== 'available') driversUnavailable++;
    if (ov.rest_status === 'breach')     driverBreaches++;
    if (ov.flag)                         driverFlagged++;
  }

  // ── Convoys: live (non-complete) dispatches from Phase 101 ────────
  const liveConvoys = convoyState.listActive();
  const convoyTrucks = liveConvoys.reduce((sum, c) => sum + (c.trucks ?? 0), 0);

  const hasLiveData =
    fleetOverrides.size > 0 || driverOverrides.size > 0 || liveConvoys.length > 0;

  return {
    fleet: {
      active:          activeTrucks,
      idle:            idleTrucks,
      garage:          garageTrucks,
      critical_flags:  criticalFlags,
      total:           FLEET.length,
      overrides_count: fleetOverrides.size,
      by_hauler:       byHauler,
    },
    drivers: {
      unavailable:      driversUnavailable,
      rest_breaches:    driverBreaches,
      flagged:          driverFlagged,
      overrides_count:  driverOverrides.size,
    },
    convoys: {
      active_count:  liveConvoys.length,
      truck_count:   convoyTrucks,
      list:          liveConvoys.slice(0, 10),
    },
    has_live_data: hasLiveData,
  };
}

// Phase 112/114 — daily throughput: actual southbound tonnes dispatched today
// vs the operator-set target, with per-hauler breakdown.
// Uses live convoy_dispatches data; advisory so a query failure never blocks the briefing.
function computeThroughput() {
  const dateKey = dailyTargets.todayKey(); // YYYY-MM-DD UTC = Accra
  const { total_tonnes, convoy_count } = convoyState.todayTonnage(dateKey);
  const target   = dailyTargets.getTarget(dateKey);
  const targetT  = target?.target_tonnes ?? null;
  const names    = nameByIdMap();

  // Phase 114 — per-hauler rows (only haulers with live dispatches today).
  const byHaulerRaw = convoyState.todayTonnageByHauler(dateKey);
  const by_hauler   = byHaulerRaw.map((r) => ({
    hauler_id:     r.hauler_id,
    display_name:  names[r.hauler_id] ?? r.hauler_id,
    total_tonnes:  Math.round(r.total_tonnes * 10) / 10,
    convoy_count:  r.convoy_count,
  }));

  return {
    date:          dateKey,
    actual_tonnes: Math.round(total_tonnes * 10) / 10,
    convoy_count,
    target_tonnes: targetT,
    pct:           targetT ? Math.round((total_tonnes / targetT) * 1000) / 10 : null,
    set_by:        target?.set_by ?? null,
    by_hauler,
  };
}

// Phase 61 — escalation threshold. Items overdue by ≥3 days that
// haven't been escalated yet bubble up to admins via the notifications
// channel. Threshold tuned so a single weekend doesn't escalate; an
// item that's been ignored for >3 working days has fallen through.
const ESCALATION_OVERDUE_DAYS = 3;

// Run opportunistically on every /api/today read. Cheap (~1 SQL
// query + map iteration) and ensures the platform escalates without
// needing a real cron. Returns the count of items newly escalated
// this tick (so the route can include it in telemetry if it wants).
function runEscalationCheck() {
  const now = Date.now();
  const cutoffMs = now - ESCALATION_OVERDUE_DAYS * 24 * 60 * 60 * 1000;
  const allLive = actionItems(aggregate(roster.list()), null, { includeSnoozed: true });
  const liveById = new Set(allLive.map((it) => it.id));

  let newlyEscalated = 0;
  for (const a of actionAssignments.all()) {
    if (a.escalation) continue;                                 // already escalated
    if (!a.due_date) continue;                                  // no due date = no overdue
    if (a.snooze && new Date(a.snooze.until).getTime() > now) continue;  // snoozed
    if (!liveById.has(a.action_item_id)) continue;              // resolved or no longer surfaced
    const dueMs = new Date(a.due_date).getTime();
    if (dueMs > cutoffMs) continue;                             // not overdue enough yet

    const wasFirstEscalation = actionAssignments.markEscalated(a.action_item_id);
    if (!wasFirstEscalation) continue;
    newlyEscalated += 1;

    // Audit and notify. Body includes assignee, due date, and a hint
    // at how stale the item is so the admin doesn't have to compute it.
    const overdueDays = Math.floor((now - dueMs) / (24 * 60 * 60 * 1000));
    const item = allLive.find((it) => it.id === a.action_item_id);
    const itemBody = item?.body ? item.body.slice(0, 80) + (item.body.length > 80 ? '…' : '') : a.action_item_id;

    writeAudit({
      req: { user: { id: 'system', display_name: 'System', role: 'system' } },
      entity_type: 'action_item',
      entity_id:   a.action_item_id,
      action:      'escalate',
      summary:     `Escalated · ${overdueDays}d overdue with ${a.assignee.display_name}`,
      payload:     { assignee_user_id: a.assignee.user_id, due_date: a.due_date, overdue_days: overdueDays },
    });

    // Notify the assignee — heads up before they get pinged by admin.
    try {
      notifications.emit({
        user_id:    a.assignee.user_id,
        event_type: 'escalation',
        body:       `Your item is now ${overdueDays}d overdue and has been escalated to admin: ${itemBody}`,
        link:       { path: '/', label: 'Open' },
        payload:    { action_item_id: a.action_item_id, overdue_days: overdueDays },
      });
    } catch { /* advisory */ }

    // Fan out to every axis_admin user. axis_ops are already deep
    // enough in the workflow that adding them adds noise; admin is the
    // escalation tier.
    for (const u of users.list()) {
      if (u.role !== 'axis_admin') continue;
      if (u.id === a.assignee.user_id) continue; // already notified above
      try {
        notifications.emit({
          user_id:    u.id,
          event_type: 'escalation',
          body:       `${a.assignee.display_name}'s item is ${overdueDays}d overdue: ${itemBody}`,
          link:       { path: '/', label: 'Review' },
          payload:    { action_item_id: a.action_item_id, assignee_user_id: a.assignee.user_id, overdue_days: overdueDays },
        });
      } catch { /* advisory */ }
    }
  }
  return newlyEscalated;
}

router.get('/', (_req, res) => {
  const agg = aggregate(roster.list());
  // Phase 43 — single source of truth for the day's projection. Build
  // once, capture once, embed in the response.
  const forecast = buildForecast(roster.list(), new Date());
  try { forecastSnapshots.capture(forecast); } catch { /* non-fatal */ }
  // Phase 61 — opportunistic escalation pass. Cheap; never blocks the
  // response if it throws.
  try { runEscalationCheck(); } catch { /* advisory */ }
  // Phase 108 — live ops overlay (fleet / driver / convoy state).
  let live_ops = null;
  try { live_ops = computeLiveOps(); } catch { /* advisory; never block briefing */ }
  // Phase 112 — daily throughput (live convoy tonnes vs operator target).
  let throughput = null;
  try { throughput = computeThroughput(); } catch { /* advisory; never block briefing */ }
  // Phase 118 — today's dispatched convoys for the schedule strip.
  let today_convoys = [];
  try {
    const dateKey = dailyTargets.todayKey();
    const names   = nameByIdMap();
    today_convoys = convoyState.todayDispatches(dateKey).map((c) => ({
      id:                   c.id,
      convoy_ref:           c.convoy_ref,
      hauler_id:            c.hauler_id,
      hauler_display:       names[c.hauler_id] ?? c.hauler_id,
      trucks:               c.trucks,
      direction:            c.direction,
      phase:                c.phase,
      planned_departure_iso: c.planned_departure_iso,
      actual_departure_iso:  c.actual_departure_iso,
      arrived_at_iso:        c.arrived_at_iso,
      cargo_tonnes:          c.cargo_tonnes,
      delivered_tonnes:      c.delivered_tonnes,
      is_overdue:            c.is_overdue,
      overdue_hours:         c.overdue_hours,
    }));
  } catch { /* advisory */ }

  res.json({
    generated_at: agg.generated_at,
    dominant_story: dominantStory(agg),
    forecast,
    convoy_cycle: convoyCycleSeries(),
    hauler_contribution: haulerContributionWeek(agg),
    brief_strip: briefStrip(agg),
    observations: observations(agg),
    action_items: actionItems(agg, forecast),
    live_ops,
    throughput,
    today_convoys,
    hauler_status: agg.haulers.map((h) => {
      // Phase 44 — merge per-hauler projection into the right-rail row
      // so the operator sees the verdict at a glance without expanding
      // the drawer.
      const hp = forecast.haulers.find((p) => p.hauler_id === h.id);
      // Phase 108 — prefer live fleet count (overlay-applied) when available.
      const liveH = live_ops?.fleet?.by_hauler?.[h.id];
      return {
        id: h.id,
        display_name: h.display_name,
        status: h.status,
        api_status: h.api_status,
        active_trucks:    liveH?.active    ?? h.fleet.active_trucks,
        contracted_trucks: h.fleet.contracted_trucks,
        on_time_pct: h.performance.on_time_pct,
        projected_eom_tonnes:    hp?.projected_eom ?? 0,
        projected_pct_contracted: hp?.projected_pct_contracted ?? 0,
        projection_verdict:      hp?.verdict ?? 'inactive',
      };
    }),
  });
});

// ── Phase 112 — daily throughput target ───────────────────────────
//
// POST /api/today/targets
//
// Body: { target_tonnes, date? }
//   target_tonnes — required, positive number (total southbound tonnes for the day)
//   date          — optional YYYY-MM-DD; defaults to today (UTC = Accra)
//
// Role gate: axis_admin / axis_ops only.

const TARGET_WRITE_ROLES = ['axis_admin', 'axis_ops'];

router.post('/targets', requireRole(...TARGET_WRITE_ROLES), (req, res) => {
  const { target_tonnes, date } = req.body || {};

  const tonnes = parseFloat(target_tonnes);
  if (Number.isNaN(tonnes) || tonnes <= 0) {
    return res.status(400).json({ error: 'target_tonnes must be a positive number' });
  }

  const dateKey = date
    ? String(date).slice(0, 10)
    : dailyTargets.todayKey();

  // Minimal date sanity check.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  const target = dailyTargets.setTarget(dateKey, tonnes, {
    by_name: req.user.display_name,
  });

  writeAudit({
    req,
    entity_type: 'daily_target',
    entity_id:   dateKey,
    action:      'set_target',
    summary:     `Daily target set to ${tonnes.toLocaleString()} t for ${dateKey}`,
  });

  res.json({ target });
});

module.exports = router;
