'use strict';

/*
 * Lender briefing pack — Phase 70.
 *
 * The lender persona is read-deep across DSCR, covenants,
 * receivables, forecast, alerts, and audit. What they couldn't do
 * before this phase was take a *snapshot* of corridor state away
 * with them — for credit committee, board prep, regulator
 * inquiries, or quarterly review. They had to screenshot the
 * cockpit. That isn't archival output.
 *
 * This service composes a single self-contained payload bundling
 * the lender-relevant slice of the corridor: an executive summary,
 * live DSCR + recent series, the full covenant table, receivables
 * ageing + chase activity counts, the forecast trajectory + verdict,
 * open critical alerts, and a hauler attainment ranking. Pure
 * read-side composition over existing primitives — no new state.
 *
 * Consumed by routes/lender.js (GET /api/lender/pack) and rendered
 * client-side by pages/LenderPack.jsx as a print-friendly
 * single-page document mirroring HaulerScorecard's pattern.
 */

const { aggregate, CONTRACT } = require('./aggregator');
const { buildForecast } = require('./forecast');
const { buildCovenants } = require('./covenants');
const dscrService = require('./dscr');
const roster = require('../state/roster');
const forecastSnapshots = require('../state/forecastSnapshots');
const receivableFollowups = require('../state/receivableFollowups');
const alertState = require('../state/alertState');
const riskRegister = require('../state/riskRegister');
const riskSteps    = require('../state/riskSteps');
const riskComments = require('../state/riskComments');
const { allAlerts } = require('./alertSynth');

const { PNL_MTD, PNL_YTD, CASHFLOW_FORECAST } = require('../mock/financials');
const { PAYMENT_SECURITY } = require('../mock/contract');
const { CAPITAL_STRUCTURE } = require('../mock/tranches');

// ── Helpers ───────────────────────────────────────────────────────

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

function periodFor(now) {
  // Pack is dated as "month-to-date" — common cadence for credit
  // committee and board reporting. Other windows could be added
  // later via a query param.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    label:    'Month-to-date',
    start:    start.toISOString(),
    end:      now.toISOString(),
    month:    now.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

function mergedAlertStatus(alert) {
  const st = alertState.getState(alert.id);
  let status = st.status_override ?? alert.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) status = alert.status;
  }
  return { ...alert, status };
}

// ── Composition ───────────────────────────────────────────────────

function executiveSummary({ dscr, covenants, forecast, receivables, agg }) {
  const breaches = covenants.filter((c) => c.status === 'BREACH');
  const watches  = covenants.filter((c) => c.status === 'WATCH');
  const lines = [];

  // 1. Headline DSCR + verdict.
  if (dscr.current < dscr.target_min) {
    lines.push(`DSCR at ${dscr.current.toFixed(2)}× is ${(dscr.target_min - dscr.current).toFixed(2)}× below the ${dscr.target_min.toFixed(2)}× covenant floor.`);
  } else if (dscr.current < dscr.target_min + 0.1) {
    lines.push(`DSCR at ${dscr.current.toFixed(2)}× is within 0.10× of the ${dscr.target_min.toFixed(2)}× covenant floor — close monitoring warranted.`);
  } else {
    lines.push(`DSCR at ${dscr.current.toFixed(2)}× clears the ${dscr.target_min.toFixed(2)}× floor with ${dscr.headroom_pct.toFixed(1)}% headroom.`);
  }

  // 2. Take-or-pay verdict from forecast.
  const floorPct = (forecast.projection.pct_of_floor).toFixed(1);
  if (forecast.projection.eom_tonnes >= forecast.targets.floor) {
    lines.push(`Take-or-pay floor projects to clear at ${floorPct}% with ${forecast.horizon.days_remaining} days remaining.`);
  } else {
    const shortKt = ((forecast.targets.floor - forecast.projection.eom_tonnes) / 1000).toFixed(1);
    lines.push(`Take-or-pay shortfall of ${shortKt}kt projected — ${floorPct}% of floor with ${forecast.horizon.days_remaining} days remaining.`);
  }

  // 3. Receivables.
  const overdueUsd = receivables.ageing.band_31_60 + receivables.ageing.band_61_90 + receivables.ageing.band_90p;
  const overduePct = pct(overdueUsd, receivables.current_balance_usd);
  if (overduePct > 8) {
    lines.push(`Receivables overdue at ${overduePct}% of book ($${overdueUsd.toLocaleString()}) — exceeds the 8% covenant threshold.`);
  } else if (overduePct > 0) {
    lines.push(`Receivables overdue at ${overduePct}% of book ($${overdueUsd.toLocaleString()}) — within covenant.`);
  } else {
    lines.push(`Receivables ageing clean — no balance past terms.`);
  }

  // 4. Covenant roll-up.
  if (breaches.length === 0 && watches.length === 0) {
    lines.push(`All ${covenants.length} covenants pass.`);
  } else if (breaches.length > 0) {
    lines.push(`${breaches.length} covenant breach${breaches.length === 1 ? '' : 'es'}, ${watches.length} on watch.`);
  } else {
    lines.push(`All covenants in pass; ${watches.length} on watch.`);
  }

  // 5. Risk register call-out (Phase 72).
  const riskCounts = riskRegister.counts();
  if (riskCounts && riskCounts.open_count > 0) {
    if (riskCounts.high_open_count > 0) {
      lines.push(`${riskCounts.open_count} open risk${riskCounts.open_count === 1 ? '' : 's'} on the register, ${riskCounts.high_open_count} rated high or critical.`);
    } else {
      lines.push(`${riskCounts.open_count} open risk${riskCounts.open_count === 1 ? '' : 's'} on the register; none rated high.`);
    }
  }

  return {
    lines,
    headline_status:
      breaches.length > 0 ? 'BREACH' :
      watches.length  > 0 ? 'WATCH'  :
                            'PASS',
    open_breaches:  breaches.length,
    open_watches:   watches.length,
  };
}

function compose(now = new Date(), generatedBy = null) {
  const haulers   = roster.list();
  const agg       = aggregate(haulers, now);
  const forecast  = buildForecast(haulers, now);
  const covenants = buildCovenants(haulers, now);
  const dscr      = dscrService.compute(haulers, now);

  // Receivables — same shape as /api/financials so the UI can reuse
  // any helpers, plus chase counts joined per band.
  const overdueUsd = PAYMENT_SECURITY.receivables.ageing.band_31_60
                    + PAYMENT_SECURITY.receivables.ageing.band_61_90
                    + PAYMENT_SECURITY.receivables.ageing.band_90p;
  const receivables = {
    ...PAYMENT_SECURITY.receivables,
    overdue_usd: overdueUsd,
    overdue_pct: pct(overdueUsd, PAYMENT_SECURITY.receivables.current_balance_usd),
    followup_counts: receivableFollowups.countsByBand(),
  };

  // Forecast trend — last 14 days of snapshots for the trajectory chart.
  const forecastTrend = forecastSnapshots.recent(14, now.getTime());

  // Open critical alerts that touch covenants / receivables / SLA —
  // the lender-relevant slice. Filter to OPEN/IN_TRIAGE only; deduped.
  const openCriticals = allAlerts()
    .map(mergedAlertStatus)
    .filter((a) => ['OPEN', 'IN_TRIAGE'].includes(a.status))
    .filter((a) => a.severity === 'CRITICAL' || a.severity === 'WARNING')
    .map((a) => ({
      id:        a.id,
      title:     a.title,
      body:      a.body,
      severity:  a.severity,
      status:    a.status,
      hauler_id: a.hauler_id ?? null,
    }))
    .slice(0, 10);

  // Hauler attainment ranking — same shape as Phase 68 weekly synth
  // but full list (no winners/strugglers split — let the lender see
  // every active counterparty).
  const haulerRanking = agg.haulers
    .filter((h) => h.status === 'active' && h.tonnes_contracted_mtd > 0)
    .map((h) => ({
      hauler_id:        h.id,
      display_name:     h.display_name,
      attainment_pct:   pct(h.tonnes_delivered_mtd, h.tonnes_contracted_mtd),
      delivered_mtd:    h.tonnes_delivered_mtd,
      contracted_mtd:   h.tonnes_contracted_mtd,
      active_trucks:    h.fleet?.active_trucks ?? null,
      contracted_trucks:h.fleet?.contracted_trucks ?? null,
      sla_attainment_pct: h.performance?.sla_attainment_pct ?? null,
    }))
    .sort((a, b) => b.attainment_pct - a.attainment_pct);

  const summary = executiveSummary({ dscr, covenants, forecast, receivables, agg });

  return {
    generated_at: now.toISOString(),
    generated_by: generatedBy,
    period:       periodFor(now),
    corridor: {
      name:              'Nyinahin · Takoradi · 300 km',
      offtaker:          'GIBDLC',
      contracted_trucks: agg.fleet.contracted_trucks,
      active_trucks:     agg.fleet.active_trucks,
      tonnes_delivered_mtd:  agg.tonnes.delivered_mtd,
      tonnes_contracted_mtd: agg.tonnes.contracted_mtd,
      sla_attainment_pct: Number(agg.sla_attainment_pct.toFixed(1)),
      take_or_pay_floor_pct: Number((CONTRACT.take_or_pay_floor_pct * 100).toFixed(0)),
    },
    executive_summary: summary,
    dscr: {
      current:           dscr.current,
      target_min:        dscr.target_min,
      headroom_pct:      dscr.headroom_pct,
      trailing_6m_avg:   dscr.trailing_6m_avg,
      steady_state:      dscr.steady_state,
      computed:          dscr.computed,
      series:            dscr.series,
    },
    covenants,
    capital: {
      debt_committed_usd:   CAPITAL_STRUCTURE.debt_committed_usd,
      debt_drawn_usd:       CAPITAL_STRUCTURE.debt_drawn_usd,
      equity_committed_usd: CAPITAL_STRUCTURE.equity_committed_usd,
      equity_drawn_usd:     CAPITAL_STRUCTURE.equity_drawn_usd,
    },
    pnl: {
      mtd: PNL_MTD,
      ytd: PNL_YTD,
    },
    receivables,
    forecast: {
      verdict:            forecast.projection.verdict,
      projected_eom:      forecast.projection.eom_tonnes,
      pct_of_floor:       forecast.projection.pct_of_floor,
      pct_of_monthly:     forecast.projection.pct_of_monthly,
      shortfall_to_floor: forecast.projection.shortfall_to_floor,
      surplus_over_floor: forecast.projection.surplus_over_floor,
      monthly_target:     forecast.targets.monthly,
      floor_target:       forecast.targets.floor,
      days_remaining:     forecast.horizon.days_remaining,
      days_elapsed:       forecast.horizon.days_elapsed,
      delivered_mtd:      forecast.actual.delivered_mtd,
      daily_avg:          forecast.actual.daily_avg,
      required_daily_floor: forecast.required.daily_to_floor,
      trend: forecastTrend.map((s) => ({
        date:           s.snapshot_date,
        eom_tonnes:     s.eom_tonnes,
        pct_of_floor:   s.pct_of_floor,
        verdict:        s.verdict,
      })),
    },
    cashflow_90d: CASHFLOW_FORECAST,
    open_alerts:  openCriticals,
    hauler_ranking: haulerRanking,
    // Phase 72 — risk register summary in the lender pack. Active
    // risks the corridor is tracking (excluding archived). Sorted
    // server-side by severity then status. Lender sees the same
    // ledger operators are working from.
    //
    // Phase 74 — joined with mitigation step counts so credit
    // committee sees execution progress, not just plan existence.
    risks: (() => {
      const stepCounts = riskSteps.countsByRisk();
      const commentCounts = riskComments.countsByRisk();
      return riskRegister.listActive().map((r) => ({
        id:               r.id,
        title:            r.title,
        description:      r.description,
        category:         r.category,
        severity:         r.severity,
        likelihood:       r.likelihood,
        status:           r.status,
        owner:            r.owner?.display_name ?? null,
        mitigation_plan:  r.mitigation_plan,
        last_reviewed_at: r.last_reviewed_at,
        steps_summary:    stepCounts[r.id] || { done_count: 0, total_count: 0, open_count: 0 },
        // Phase 77 — latest 3 comments surface the play-by-play.
        // Reverse so the printable reads oldest-to-newest top-down.
        comment_count:    commentCounts[r.id] || 0,
        recent_comments:  riskComments.recentForRisk(r.id, 3).reverse(),
      }));
    })(),
    risk_counts: riskRegister.counts(),
  };
}

module.exports = { compose };
