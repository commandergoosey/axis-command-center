'use strict';

/*
 * Covenants service — Phase 52.
 *
 * The financials route already exposed a static `COVENANTS` table from
 * the fixture — useful for shape but not actually telling the lender
 * whether the corridor is at risk. This service replaces the static
 * statuses with live computation from corridor state, and adds three
 * covenants the fixture didn't cover:
 *
 *   - Take-or-pay floor (projected month-end vs contractual minimum)
 *   - Hauler concentration (top hauler share of corridor revenue)
 *   - On-time SLA threshold (corridor-weighted vs covenant floor)
 *
 * Each covenant returns the same shape the existing `CovenantTable`
 * component already renders, so no UI changes are required to surface
 * the new live values.
 *
 * Status thresholds:
 *   PASS   — comfortable margin
 *   WATCH  — within 5–10 % of breach (operator should care)
 *   BREACH — already at or past the line (lender escalation)
 */

const { aggregate, CONTRACT } = require('./aggregator');
const { buildForecast }       = require('./forecast');
const dscrService             = require('./dscr');
const { COVENANTS: STATIC_COVENANTS, PNL_MTD, PNL_YTD } = require('../mock/financials');
const { CAPITAL_STRUCTURE }   = require('../mock/tranches');
const { PAYMENT_SECURITY }    = require('../mock/contract');

// Concentration covenant tiers — chosen to flag well before the lender
// would call it. ≥40 % top-hauler share is a real concern; ≥50 % is the
// negotiated breach line.
const CONCENTRATION_WATCH_PCT  = 40;
const CONCENTRATION_BREACH_PCT = 50;

// SLA covenant from the side letter — corridor-weighted on-time floor.
const SLA_BREACH_PCT = 88;
const SLA_WATCH_PCT  = 90;

// Receivables ageing — overdue balance can't exceed 8 % of book.
const RECEIVABLES_BREACH_PCT = 8;
const RECEIVABLES_WATCH_PCT  = 5;

function buildCovenants(haulers, now = new Date()) {
  const agg      = aggregate(haulers, now);
  const forecast = buildForecast(haulers, now);
  const out = [];

  // ── 1. DSCR (Phase 62 — live computation from forecast EOM
  //         revenue projection + monthly debt service amortization).
  //         Falls back to static fixture inside dscrService.compute()
  //         if the math throws.
  const liveDscr = dscrService.compute(haulers, now);
  out.push({
    id:     'cov-dscr',
    name:   `DSCR ≥ ${liveDscr.target_min.toFixed(2)}×`,
    metric: `${liveDscr.current.toFixed(2)}×`,
    status: liveDscr.current >= liveDscr.target_min + 0.05 ? 'PASS'
          : liveDscr.current >= liveDscr.target_min        ? 'WATCH'
          :                                                   'BREACH',
    detail: liveDscr.current >= liveDscr.target_min + 0.05
      ? `Trailing 3-month rolling. Threshold ${liveDscr.target_min.toFixed(2)}×; headroom ${liveDscr.headroom_pct.toFixed(1)}%.${liveDscr.computed ? ' (live)' : ''}`
      : liveDscr.current >= liveDscr.target_min
      ? `Within 5 % of covenant floor — schedule a remediation conversation with treasury.${liveDscr.computed ? ' (live)' : ''}`
      : `BREACH — DSCR has fallen below ${liveDscr.target_min.toFixed(2)}× covenant. Lender notification required.${liveDscr.computed ? ' (live)' : ''}`,
    threshold: liveDscr.target_min,
    current:   liveDscr.current,
  });

  // ── 2. Gearing — fixed structure, mirrors fixture.
  const debt   = CAPITAL_STRUCTURE.debt_committed_usd;
  const equity = CAPITAL_STRUCTURE.equity_committed_usd;
  const gearing = debt + equity > 0 ? Math.round((debt / (debt + equity)) * 100) : 0;
  out.push({
    id:     'cov-gearing',
    name:   'Debt / equity ≤ 70/30',
    metric: `${gearing} / ${100 - gearing}`,
    status: gearing <= 70 ? 'PASS' : 'WATCH',
    detail: gearing <= 70
      ? 'Committed structure within covenant ceiling.'
      : `Gearing at ${gearing}% — exceeds 70 % cap. Equity injection required.`,
    threshold: 70,
    current:   gearing,
  });

  // ── 3. Take-or-pay floor (Phase 52 NEW — wires forecast service).
  const floorTarget   = forecast.targets.floor;
  const projectedEom  = forecast.projection.eom_tonnes;
  const cushion       = projectedEom - floorTarget;
  const cushionPct    = Number(((cushion / floorTarget) * 100).toFixed(1));
  out.push({
    id:     'cov-take-or-pay',
    name:   `Projected EOM ≥ ${(floorTarget / 1000).toFixed(1)} kt floor`,
    metric: `${(projectedEom / 1000).toFixed(1)} kt (${cushionPct >= 0 ? '+' : ''}${cushionPct.toFixed(1)} %)`,
    status: cushion <  0                              ? 'BREACH'
          : cushionPct < 5                            ? 'WATCH'
          :                                             'PASS',
    detail: cushion < 0
      ? `BREACH — projected ${Math.abs(cushion).toLocaleString()} t short of contractual floor with ${forecast.horizon.days_remaining} days remaining.`
      : cushionPct < 5
      ? `Cushion of only ${cushion.toLocaleString()} t over ${forecast.horizon.days_remaining} days — narrow margin to covenant floor.`
      : `Comfortable cushion of ${cushion.toLocaleString()} t over the floor.`,
    threshold: floorTarget,
    current:   projectedEom,
  });

  // ── 4. Hauler concentration (Phase 52 NEW).
  // Top single hauler revenue share — concentrated reliance is a credit
  // risk even when each hauler individually performs.
  const totalRevMtd = forecast.haulers.reduce((s, h) => s + h.delivered_mtd, 0);
  const ranked = [...forecast.haulers]
    .filter((h) => h.status === 'active')
    .sort((a, b) => b.delivered_mtd - a.delivered_mtd);
  const topHauler   = ranked[0];
  const topShare    = topHauler && totalRevMtd > 0
    ? Number(((topHauler.delivered_mtd / totalRevMtd) * 100).toFixed(1))
    : 0;
  out.push({
    id:     'cov-concentration',
    name:   `No hauler > ${CONCENTRATION_BREACH_PCT}% of corridor revenue`,
    metric: topHauler ? `${topHauler.display_name} · ${topShare}%` : '—',
    status: topShare >= CONCENTRATION_BREACH_PCT ? 'BREACH'
          : topShare >= CONCENTRATION_WATCH_PCT  ? 'WATCH'
          :                                        'PASS',
    detail: topShare >= CONCENTRATION_BREACH_PCT
      ? `BREACH — ${topHauler.display_name} accounts for ${topShare}% of MTD tonnes. Diversification mandate required.`
      : topShare >= CONCENTRATION_WATCH_PCT
      ? `${topHauler.display_name} concentration at ${topShare}% — within ${CONCENTRATION_BREACH_PCT - topShare} pts of breach line.`
      : `Top hauler share ${topShare}% — well distributed across the roster.`,
    threshold: CONCENTRATION_BREACH_PCT,
    current:   topShare,
  });

  // ── 5. On-time SLA (Phase 52 NEW).
  const slaPct = agg.sla_attainment_pct;
  out.push({
    id:     'cov-sla',
    name:   `Corridor SLA ≥ ${SLA_BREACH_PCT}% on-time`,
    metric: `${slaPct.toFixed(1)}%`,
    status: slaPct <  SLA_BREACH_PCT ? 'BREACH'
          : slaPct <  SLA_WATCH_PCT  ? 'WATCH'
          :                            'PASS',
    detail: slaPct <  SLA_BREACH_PCT
      ? `BREACH — SLA at ${slaPct.toFixed(1)}% has fallen below ${SLA_BREACH_PCT}% covenant floor.`
      : slaPct <  SLA_WATCH_PCT
      ? `Within ${(SLA_WATCH_PCT - slaPct).toFixed(1)} pts of covenant floor (${SLA_BREACH_PCT}%).`
      : `Above ${SLA_WATCH_PCT}% SLA — covenant comfortably met.`,
    threshold: SLA_BREACH_PCT,
    current:   slaPct,
  });

  // ── 6. Receivables ageing (carries existing fixture; status now live).
  const r = PAYMENT_SECURITY.receivables;
  const overdue = r.ageing.band_31_60 + r.ageing.band_61_90 + r.ageing.band_90p;
  const overduePct = r.current_balance_usd > 0
    ? Number(((overdue / r.current_balance_usd) * 100).toFixed(1))
    : 0;
  out.push({
    id:     'cov-ageing',
    name:   `Overdue receivables ≤ ${RECEIVABLES_BREACH_PCT}% of book`,
    metric: `${overduePct}% ($${overdue.toLocaleString()})`,
    status: overduePct >= RECEIVABLES_BREACH_PCT ? 'BREACH'
          : overduePct >= RECEIVABLES_WATCH_PCT  ? 'WATCH'
          :                                        'PASS',
    detail: overduePct >= RECEIVABLES_BREACH_PCT
      ? `BREACH — overdue receivables at ${overduePct}% exceeds ${RECEIVABLES_BREACH_PCT}% cap.`
      : overduePct >= RECEIVABLES_WATCH_PCT
      ? `Watch zone — collections aging into 31+ day bands.`
      : `Within ageing tolerance.`,
    threshold: RECEIVABLES_BREACH_PCT,
    current:   overduePct,
  });

  // ── 7. Liquidity floor (carries fixture).
  const cov_liq = STATIC_COVENANTS.find((c) => c.id === 'cov-liquidity');
  if (cov_liq) out.push({ ...cov_liq });

  return out;
}

module.exports = { buildCovenants };
