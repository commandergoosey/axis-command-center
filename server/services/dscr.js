'use strict';

/*
 * DSCR (Debt Service Coverage Ratio) — Phase 62.
 *
 * Wires the lender-facing DSCR covenant to live operational data
 * instead of the static fixture. The math uses the same shape the
 * covenant fixture had — current value, target_min, headroom — but
 * the inputs now come from corridor performance:
 *
 *   monthly EBITDA estimate = projected EOM revenue − operating costs
 *   monthly debt service    = $63M senior debt × 9.25% / 7yr amort
 *   DSCR (current)          = trailing-3 EBITDA / trailing-3 debt service
 *
 * `series` carries the historical DSCR (closed months from PNL_YTD)
 * with the current month projected from forecast — so the lender
 * dashboard reads continuously across the partial current month.
 *
 * Falls back to the static fixture if anything throws (defensive —
 * the covenant card should always render something).
 */

const { CONTRACT } = require('./aggregator');
const { buildForecast } = require('./forecast');
const { DSCR: STATIC_DSCR, PNL_MTD, PNL_YTD } = require('../mock/financials');
const { CAPITAL_STRUCTURE }                   = require('../mock/tranches');

// Senior debt facility — committed amount × interest rate / amort period.
// Drawn balance climbs through the ramp; debt service still computed
// against committed because the lender side letter prices the full
// facility regardless of how fast tranche-1 has drawn.
const ANNUAL_INTEREST_PCT = 9.25;
const AMORT_YEARS         = 7;

// Operating-cost ratio derived from PNL_YTD (4,104,800 / 6,488,000 = 63.3 %).
// We don't have a live cost feed yet — the cost fixture is the
// historical run-rate. This holds through any reasonable revenue
// projection because operating costs scale with tonnes hauled.
const OPCOST_RATIO_FALLBACK = PNL_YTD.operating_costs_usd / PNL_YTD.revenue_usd;

// Effective tariff blends the base rate + indexation. We use the
// PNL_YTD ratio (revenue / tonnes) when we can; otherwise we use the
// CONTRACT base.
function inferEffectiveTariff() {
  // PNL_YTD doesn't carry tonnes directly; assume it tracks the
  // first 4 months of contracted_monthly. Revenue / tonnes ≈ effective
  // tariff actually realised (which includes the indexation bumps).
  // 6,488,000 USD / (~ 4 × 80kt at run-rate) ≈ $24.x/t.
  const fourMonthTonnes = (CONTRACT.target_mtpa * 1_000_000) / 12 * 4 * 0.85; // ~85% run rate Jan-Apr
  return PNL_YTD.revenue_usd / fourMonthTonnes;
}
const EFFECTIVE_TARIFF_USD = inferEffectiveTariff();

// Monthly debt service — equal-payment amortization on the committed
// senior debt facility. ($63M, 9.25%, 7yr) ≈ $1.024M/mo.
const MONTHLY_RATE = (ANNUAL_INTEREST_PCT / 100) / 12;
const N_PAYMENTS   = AMORT_YEARS * 12;
const MONTHLY_DEBT_SERVICE_USD = (CAPITAL_STRUCTURE.debt_committed_usd * MONTHLY_RATE)
  / (1 - Math.pow(1 + MONTHLY_RATE, -N_PAYMENTS));

function compute(haulers, now = new Date()) {
  try {
    const forecast = buildForecast(haulers, now);

    // This month: project full-month revenue using forecast EOM tonnes.
    const projectedTonnes      = forecast.projection.eom_tonnes;
    const thisMonthRevenue     = projectedTonnes * EFFECTIVE_TARIFF_USD;
    const thisMonthOpCosts     = thisMonthRevenue * OPCOST_RATIO_FALLBACK;
    const thisMonthEbitda      = thisMonthRevenue - thisMonthOpCosts;
    const thisMonthDscr        = thisMonthEbitda / MONTHLY_DEBT_SERVICE_USD;

    // Trailing 3 months: this month (projected) + 2 closed months from
    // PNL_YTD aggregates. We don't have monthly granularity in the
    // YTD fixture, so we approximate by attributing 1/4 of YTD per
    // month for the last two closed months.
    const closedMonthAvgEbitda = PNL_YTD.ebitda_usd / 4; // Jan-Apr; April still partial
    const trailing3EbitdaTotal  = thisMonthEbitda + closedMonthAvgEbitda * 2;
    const trailing3DebtTotal    = MONTHLY_DEBT_SERVICE_USD * 3;
    const trailing3Dscr         = trailing3EbitdaTotal / trailing3DebtTotal;

    // Headroom expressed against the covenant floor.
    const headroomPct = trailing3Dscr > 0
      ? Number((((trailing3Dscr - STATIC_DSCR.target_min) / STATIC_DSCR.target_min) * 100).toFixed(1))
      : 0;

    // Series — historical from STATIC_DSCR.series (already keyed by
    // month), with the current month overwritten with the live value.
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const series = STATIC_DSCR.series.map((s) => (
      s.month === monthKey
        ? { ...s, dscr: Number(thisMonthDscr.toFixed(2)), partial: true, computed: true }
        : s
    ));

    return {
      current:          Number(trailing3Dscr.toFixed(2)),
      target_min:       STATIC_DSCR.target_min,
      steady_state:     STATIC_DSCR.steady_state,
      trailing_6m_avg:  STATIC_DSCR.trailing_6m_avg,
      headroom_pct:     headroomPct,
      series,
      // Phase 62 — surface the inputs so the UI can show "live · X×"
      // and a tooltip explaining how it composed.
      computed: {
        this_month_revenue_usd:     Math.round(thisMonthRevenue),
        this_month_ebitda_usd:      Math.round(thisMonthEbitda),
        this_month_dscr:            Number(thisMonthDscr.toFixed(2)),
        monthly_debt_service_usd:   Math.round(MONTHLY_DEBT_SERVICE_USD),
        opcost_ratio:               Number(OPCOST_RATIO_FALLBACK.toFixed(3)),
        effective_tariff_usd:       Number(EFFECTIVE_TARIFF_USD.toFixed(2)),
      },
    };
  } catch {
    // Fall back to static fixture rather than a partial response.
    return { ...STATIC_DSCR, computed: null };
  }
}

module.exports = { compute, MONTHLY_DEBT_SERVICE_USD };
