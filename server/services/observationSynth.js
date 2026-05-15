'use strict';

/*
 * Observation synthesizer — Phase 28.
 *
 * Composes per-page observation cards from live corridor state so the
 * AXIS Intelligence panel says something honest even in demo mode
 * (no Anthropic API key). Voice register mirrors the prompt in
 * intelligence.js: specific, ≤25 words, named hauler or asset, named
 * numbers with units, one recommended action where natural.
 *
 * Each page handler returns an array of { id, severity, body }. The
 * intelligence service uses these as the fallback when the LLM isn't
 * available and as grounding when it is.
 */

const { AXLE_EVENTS, FILINGS, LICENCE_EXPIRY, OVERLOAD_BY_HAULER } = require('../mock/compliance');
const { PAYMENT_SECURITY, CONTRACT_TERMS } = require('../mock/contract');
const { FLEET } = require('../mock/fleet');
const haulers = require('../mock/haulers');
const alertState = require('../state/alertState');
const filingState = require('../state/filingState');
const licenceState = require('../state/licenceState');
const incidentState = require('../state/incidentState');
const integrationStore = require('../state/integrationStore');
const workorderState = require('../state/workorderState');
const coachingState = require('../state/coachingState');
const { allAlerts } = require('./alertSynth');
const forecastAnomalies = require('./forecastAnomalies');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function nameOf(haulerId) {
  return haulers.find((h) => h.id === haulerId)?.display_name ?? haulerId;
}

function mergedAlert(alert) {
  const st = alertState.getState(alert.id);
  let status = st.status_override ?? alert.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) status = alert.status;
  }
  return { ...alert, status };
}

function isOpen(a) {
  return a.status !== 'RESOLVED' && a.status !== 'SNOOZED';
}

function mergedFiling(f) {
  const st = filingState.getState(f.id);
  return st ? { ...f, status: st.status, submitted_at: st.submitted_at } : f;
}

function daysUntil(iso, now) {
  return Math.ceil((new Date(iso).getTime() - now) / ONE_DAY_MS);
}

function holdsLast(n_days, now) {
  const cutoff = now - n_days * ONE_DAY_MS;
  return AXLE_EVENTS.filter((e) => e.action === 'HOLD' && new Date(e.timestamp).getTime() >= cutoff);
}

function overdueReceivables() {
  const a = PAYMENT_SECURITY.receivables.ageing;
  return (a.band_31_60 || 0) + (a.band_61_90 || 0) + (a.band_90p || 0);
}

// ── Page composers ────────────────────────────────────────────────────

function todayObs(ctx, now) {
  const out = [];
  const open = allAlerts().map(mergedAlert).filter(isOpen);
  const criticals = open.filter((a) => a.severity === 'CRITICAL');

  // Run-rate vs floor.
  const deliveredPct = ctx?.tonnes?.contracted_mtd
    ? (ctx.tonnes.delivered_mtd / ctx.tonnes.contracted_mtd) * 100
    : 0;
  const floorPct = ctx?.take_or_pay_floor_pct ?? 80;
  if (deliveredPct) {
    const gapTonnes = Math.max(0, Math.round(ctx.tonnes.contracted_mtd * floorPct / 100) - ctx.tonnes.delivered_mtd);
    out.push({
      id: 'obs-runrate',
      severity: deliveredPct < floorPct ? 'warn' : 'info',
      body: deliveredPct < floorPct
        ? `Run-rate ${deliveredPct.toFixed(1)}% of contracted MTD, ${gapTonnes.toLocaleString('en-GB')} tonnes under the ${floorPct.toFixed(0)}% floor. Escalate the lagging hauler.`
        : `Run-rate ${deliveredPct.toFixed(1)}% of contracted MTD, ${(deliveredPct - floorPct).toFixed(1)} points over the ${floorPct.toFixed(0)}% take-or-pay floor.`,
    });
  }

  // Top critical alert.
  if (criticals[0]) {
    const a = criticals[0];
    out.push({
      id: `obs-alert-${a.id}`,
      severity: 'warn',
      body: `${a.severity} open — ${a.title}. ${a.action ?? 'Triage from the alerts board.'}`.slice(0, 240),
    });
  }

  // Receivables ageing.
  const overdue = overdueReceivables();
  if (overdue > 0) {
    out.push({
      id: 'obs-receivables',
      severity: 'info',
      body: `Receivables past 30 days at $${overdue.toLocaleString('en-GB')}. Terms 30 days; counterparty GIBDLC.`,
    });
  }

  // Weighbridge posture — if a hauler is under a live coaching cooldown
  // we reword so the observation reflects the intervention in flight
  // rather than asking for another one.
  const holds7 = holdsLast(7, now);
  if (holds7.length > 0) {
    const byH = holds7.reduce((m, e) => { m[e.hauler_id] = (m[e.hauler_id] || 0) + 1; return m; }, {});
    const [topId, topCount] = Object.entries(byH).sort((a, b) => b[1] - a[1])[0];
    const coached = coachingState.recentForHauler(topId, 7, now);
    out.push({
      id: 'obs-weighbridge',
      severity: coached ? 'info' : 'warn',
      body: coached
        ? `${holds7.length} weighbridge holds in 7 days. ${nameOf(topId)} carries ${topCount}; coached ${new Date(coached.held_at).toISOString().slice(0, 10)} — monitoring hold-rate delta.`
        : `${holds7.length} weighbridge holds in 7 days. ${nameOf(topId)} carries ${topCount}. Coach the dispatcher on pre-departure verification.`,
    });
  }

  // Coaching activity — surfaces when Ops has intervened recently.
  const coaching7 = coachingState.recentWindow(7, now);
  if (coaching7.length > 0) {
    const haulerSet = new Set(coaching7.map((c) => c.hauler_id));
    out.push({
      id: 'obs-coaching',
      severity: 'info',
      body: `${coaching7.length} dispatcher coaching session${coaching7.length === 1 ? '' : 's'} in 7 days across ${haulerSet.size} hauler${haulerSet.size === 1 ? '' : 's'}. Axle-hold alerts suppressed during cooldown.`,
    });
  }

  // Phase 60 — forecast anomalies. Detected from snapshot history;
  // surfaced here so axis_admin / axis_ops see them on Today's
  // Intelligence panel without checking the forecast card directly.
  for (const a of forecastAnomalies.detect(new Date(now))) {
    out.push(a);
  }

  return out.slice(0, 5); // bumped from 4 to make room for anomalies
}

function alertsObs(_ctx, _now) {
  const out = [];
  const merged = allAlerts().map(mergedAlert);
  const open = merged.filter(isOpen);
  const crit = open.filter((a) => a.severity === 'CRITICAL');
  const warn = open.filter((a) => a.severity === 'WARNING');
  const gen = merged.filter((a) => a.generated && isOpen(a));

  if (crit.length === 0 && warn.length === 0) {
    out.push({ id: 'obs-calm', severity: 'info', body: 'No critical or warning alerts open. Monitoring queue continues against the usual thresholds.' });
  } else {
    const byHauler = open.reduce((m, a) => {
      if (!a.hauler_id) return m;
      m[a.hauler_id] = (m[a.hauler_id] || 0) + 1;
      return m;
    }, {});
    const top = Object.entries(byHauler).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      out.push({
        id: 'obs-cluster',
        severity: 'warn',
        body: `${top[1]} open alerts cluster on ${nameOf(top[0])}. Upstream dispatcher pattern worth a coaching session.`,
      });
    }
    out.push({
      id: 'obs-mix',
      severity: crit.length > 0 ? 'warn' : 'info',
      body: `${crit.length} critical, ${warn.length} warning open. ${gen.length} generated from live signals; rest are curated.`,
    });
  }

  // Recently resolved.
  const resolved = merged.filter((a) => {
    const st = alertState.getState(a.id);
    return st.resolved_at_iso && (Date.now() - new Date(st.resolved_at_iso).getTime()) <= 2 * ONE_DAY_MS;
  });
  if (resolved.length > 0) {
    out.push({
      id: 'obs-resolved',
      severity: 'info',
      body: `${resolved.length} alert${resolved.length === 1 ? '' : 's'} resolved in the last 48h. Audit log carries the reasoning note.`,
    });
  }

  return out.slice(0, 4);
}

function complianceObs(_ctx, now) {
  const out = [];

  // Filings.
  const filings = FILINGS.map(mergedFiling);
  const overdue = filings.filter((f) => f.status !== 'FILED' && new Date(f.due).getTime() < now);
  const dueSoon = filings.filter((f) => f.status !== 'FILED' && daysUntil(f.due, now) >= 0 && daysUntil(f.due, now) <= 7);
  if (overdue.length > 0) {
    const f = overdue[0];
    out.push({
      id: 'obs-overdue',
      severity: 'warn',
      body: `${f.agency} filing ${f.id} is ${Math.abs(daysUntil(f.due, now))} days overdue. ${f.detail.split('·')[0].trim()}.`,
    });
  }
  if (dueSoon[0]) {
    const f = dueSoon[0];
    out.push({
      id: `obs-due-${f.id}`,
      severity: daysUntil(f.due, now) <= 3 ? 'warn' : 'info',
      body: `${f.agency} filing due in ${daysUntil(f.due, now)} days (${f.due}). ${f.detail.split('·')[0].trim()}.`,
    });
  }

  // Axle pattern — annotate with coaching cooldown when active so Ops
  // reads the outstanding pattern and the live intervention in one line.
  const worst = [...OVERLOAD_BY_HAULER].sort((a, b) => b.holds - a.holds)[0];
  if (worst && worst.holds > 0) {
    const coached = coachingState.recentForHauler(worst.hauler_id, 7, now);
    out.push({
      id: 'obs-axle-pattern',
      severity: coached ? 'info' : 'warn',
      body: coached
        ? `${nameOf(worst.hauler_id)} absorbed ${worst.holds} weighbridge holds in 30 days — dispatcher coached ${new Date(coached.held_at).toISOString().slice(0, 10)}, ${coached.expected_delta_pct != null ? `${coached.expected_delta_pct}% hold-rate delta expected` : 'tracking hold-rate delta'}.`
        : `${nameOf(worst.hauler_id)} absorbed ${worst.holds} weighbridge holds in 30 days — ${worst.delay_min_total} min off-load, $${worst.cost_usd.toLocaleString('en-GB')} opportunity cost.`,
    });
  }

  // Coaching rollup (compliance page).
  const coaching30 = coachingState.recentWindow(30, now);
  if (coaching30.length > 0) {
    const haulerSet = new Set(coaching30.map((c) => c.hauler_id));
    out.push({
      id: 'obs-coaching-30',
      severity: 'info',
      body: `${coaching30.length} coaching session${coaching30.length === 1 ? '' : 's'} logged in 30 days across ${haulerSet.size} hauler${haulerSet.size === 1 ? '' : 's'}. Audit trail carries attendees and expected hold-rate delta.`,
    });
  }

  // Licence pipeline — use live overlay so a fresh renewal drops out of
  // the pipeline and the next-oldest slot surfaces instead.
  const live = LICENCE_EXPIRY.map((l) => {
    const st = licenceState.getState(l.id);
    const expiry = st?.expiry_iso ?? l.expiry;
    return {
      ...l,
      expiry,
      days_remaining: Math.ceil((new Date(expiry).getTime() - now) / ONE_DAY_MS),
      renewed: !!st,
      renewed_at: st?.renewed_at ?? null,
    };
  });
  const lic = live.filter((l) => l.days_remaining <= 30 && !l.renewed).sort((a, b) => a.days_remaining - b.days_remaining)[0];
  if (lic) {
    out.push({
      id: 'obs-licence',
      severity: lic.days_remaining <= 14 ? 'warn' : 'info',
      body: `${lic.driver} ${lic.document} expires ${lic.expiry.slice(0, 10)} — ${lic.days_remaining} days out. Book the DVLA slot.`,
    });
  }

  // Renewal activity — 7-day rollup so Ops sees the regulatory work
  // landing on the clock and doesn't chase licences that have already
  // cleared DVLA.
  const renewed7 = live.filter((l) => l.renewed_at && (now - new Date(l.renewed_at).getTime()) <= 7 * ONE_DAY_MS);
  if (renewed7.length > 0) {
    out.push({
      id: 'obs-licence-renewed',
      severity: 'info',
      body: `${renewed7.length} driver licence${renewed7.length === 1 ? '' : 's'} renewed through DVLA in 7 days. Audit trail carries reference numbers.`,
    });
  }

  // HSE incidents — Cat A or open incidents in the last 30 days surface
  // as a coaching nudge. Closed Cat-B events count toward per-mtk but
  // don't earn an observation.
  const incidents30 = incidentState.since(30, now);
  const catA  = incidents30.filter((i) => i.category === 'A');
  const open  = incidents30.filter((i) => i.status === 'OPEN');
  if (catA.length > 0) {
    const i = catA[0];
    const coached = coachingState.recentForHauler(i.hauler_id, 7, now);
    out.push({
      id: 'obs-hse-cat-a',
      severity: 'warn',
      body: coached
        ? `${catA.length} Cat A incident${catA.length === 1 ? '' : 's'} in 30 days. ${nameOf(i.hauler_id)} dispatcher already coached — track recurrence.`
        : `${catA.length} Cat A incident${catA.length === 1 ? '' : 's'} in 30 days on ${nameOf(i.hauler_id)} (${i.type}). Coach the dispatcher this week.`,
    });
  }
  if (open.length > 0) {
    out.push({
      id: 'obs-hse-open',
      severity: open.length > 1 ? 'warn' : 'info',
      body: `${open.length} HSE incident${open.length === 1 ? '' : 's'} open without a corrective action. Close-out is required before the next regulator audit.`,
    });
  }

  // Sort warn ahead of info, then by insertion order — keeps the next
  // regulatory action above quieter rollups when the slice trims.
  out.sort((a, b) => (a.severity === 'warn' ? 0 : 1) - (b.severity === 'warn' ? 0 : 1));

  return out.slice(0, 5);
}

function financialsObs(_ctx, _now) {
  const out = [];
  const ag = PAYMENT_SECURITY.receivables.ageing;
  const total = (ag.band_0_30 || 0) + (ag.band_31_60 || 0) + (ag.band_61_90 || 0) + (ag.band_90p || 0);
  const overdue = overdueReceivables();
  const band6190pct = total ? (ag.band_61_90 / total) * 100 : 0;

  if (overdue > 0) {
    out.push({
      id: 'obs-ageing',
      severity: ag.band_61_90 > 0 || ag.band_90p > 0 ? 'warn' : 'info',
      body: `Receivables past 30 days at $${overdue.toLocaleString('en-GB')} against $${total.toLocaleString('en-GB')} book. 61–90 band at ${band6190pct.toFixed(1)}% — covenant ceiling 5%.`,
    });
  }

  const sblc = PAYMENT_SECURITY.sblc;
  const daysToExp = Math.ceil((new Date(sblc.expiry).getTime() - Date.now()) / ONE_DAY_MS);
  out.push({
    id: 'obs-sblc',
    severity: daysToExp <= 60 ? 'warn' : 'info',
    body: `SBLC $${(sblc.face_value_usd / 1e6).toFixed(1)}M from ${sblc.issuer} expires ${sblc.expiry} — ${daysToExp} days out. Coverage ${sblc.coverage_months}× monthly tariff.`,
  });

  out.push({
    id: 'obs-terms',
    severity: 'info',
    body: `Contract term ${CONTRACT_TERMS.term_years} years with ${CONTRACT_TERMS.currency} settlement. ${CONTRACT_TERMS.review_cadence}`,
  });

  // Phase 60 — forecast anomalies are lender-relevant: a verdict
  // transition into below_floor is a covenant warning, a sharp drop
  // is volatility worth pricing.
  for (const a of forecastAnomalies.detect()) {
    out.push(a);
  }

  return out.slice(0, 5);
}

function settingsObs(_ctx, _now) {
  const out = [];
  const rows = haulers.map((h) => ({ h, s: integrationStore.summary(h.id) }));
  const live = rows.filter(({ s }) => s.live);
  const failed = rows.filter(({ s }) => s.has_credentials && !s.live && s.last_probe);
  const pending = rows.filter(({ s }) => !s.has_credentials);

  out.push({
    id: 'obs-integrations',
    severity: failed.length > 0 ? 'warn' : 'info',
    body: `${live.length} of ${rows.length} hauler integrations live, ${failed.length} probe-failed, ${pending.length} pending credentials.`,
  });

  if (failed[0]) {
    const f = failed[0];
    out.push({
      id: `obs-probe-${f.h.id}`,
      severity: 'warn',
      body: `${f.h.display_name} ${f.h.integration?.type || 'adapter'} probe did not return live. Rotate credentials or re-probe.`,
    });
  }

  out.push({
    id: 'obs-auth',
    severity: 'info',
    body: 'Auth scheme: opaque bearer, 12-hour TTL, reissued on login. Phase 11 replaces with signed JWT and identity provider.',
  });

  return out.slice(0, 4);
}

function fleetObs(_ctx, _now) {
  const out = [];
  const crit  = FLEET.filter((r) => r.maintenance_flag === 'critical');
  const due   = FLEET.filter((r) => r.maintenance_flag === 'service_due');
  const rw30  = FLEET.filter((r) => r.maintenance_flag === 'road_worthy_30d');

  const remediating = workorderState.rigsInRemediation();
  const critWithWo   = crit.filter((r) => remediating.has(r.id));
  const critPending  = crit.filter((r) => !remediating.has(r.id));

  if (critPending.length > 0) {
    const byH = critPending.reduce((m, r) => { m[r.hauler_display] = (m[r.hauler_display] || 0) + 1; return m; }, {});
    const top = Object.entries(byH).sort((a, b) => b[1] - a[1])[0];
    out.push({
      id: 'obs-crit',
      severity: 'warn',
      body: `${critPending.length} rigs critical with no workorder. ${top[0]} carries ${top[1]}. Open workorders and expedite workshop release.`,
    });
  }
  if (critWithWo.length > 0) {
    out.push({
      id: 'obs-crit-wo',
      severity: 'info',
      body: `${critWithWo.length} critical rig${critWithWo.length === 1 ? '' : 's'} in remediation — active workorder. Track progress in maintenance.`,
    });
  } else if (crit.length === 0) {
    out.push({
      id: 'obs-crit-clean',
      severity: 'info',
      body: 'No rigs carry the critical maintenance flag. Preventive-maintenance cadence on track.',
    });
  }
  if (due.length > 0) {
    out.push({
      id: 'obs-due',
      severity: 'info',
      body: `${due.length} rigs past the 20,000 km service interval. Book before the next laden trip.`,
    });
  }
  if (rw30.length > 0) {
    out.push({
      id: 'obs-rw',
      severity: 'info',
      body: `${rw30.length} rigs carry DVLA road-worthy certificates expiring within 30 days.`,
    });
  }

  return out.slice(0, 4);
}

const PAGE_COMPOSERS = {
  today:       todayObs,
  alerts:      alertsObs,
  compliance:  complianceObs,
  financials:  financialsObs,
  settings:    settingsObs,
  fleet:       fleetObs,
  maintenance: fleetObs,
};

function synthesize(page, ctx = {}, now = Date.now()) {
  const composer = PAGE_COMPOSERS[page];
  if (!composer) return null;
  try {
    const obs = composer(ctx, now);
    return Array.isArray(obs) && obs.length > 0 ? obs : null;
  } catch (err) {
    console.error('[observationSynth]', page, err.message);
    return null;
  }
}

module.exports = { synthesize };
