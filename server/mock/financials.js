'use strict';

/*
 * Financials fixtures — lender-facing snapshot.
 * DSCR series, P&L (MTD + YTD), covenant compliance table, receivables
 * ageing (mirrors contract.js), and a 90-day cashflow forecast. Figures
 * reconcile to the business plan's Tranche 1 assumptions: $24.36 effective
 * tariff × ~83kt/month at full run rate ≈ $2.0M monthly revenue, debt
 * service ~$1.1M monthly on $63M @ 9.25% over 7 years.
 */

// 6-month DSCR series — ramp from near-zero in Nov '25 to ~1.4× trending.
const DSCR_SERIES = [
  { month: '2025-11', dscr: 0.28 },
  { month: '2025-12', dscr: 0.78 },
  { month: '2026-01', dscr: 1.12 },
  { month: '2026-02', dscr: 1.24 },
  { month: '2026-03', dscr: 1.31 },
  { month: '2026-04', dscr: 1.34, partial: true },
];

const DSCR = {
  current:          1.34,
  target_min:       1.30,
  steady_state:     2.50,
  trailing_6m_avg:  1.18,
  headroom_pct:     3.1,  // (current - target_min) / target_min
  series:           DSCR_SERIES,
};

// P&L — MTD (partial Apr '26) and YTD (Jan–Mar '26 closed, Apr MTD folded in by route).
const PNL_MTD = {
  period: 'Apr 2026 MTD',
  revenue_usd:         1_091_000,  // ~43,984 t × $24.80 blended
  operating_costs_usd:  684_400,
  ebitda_usd:           406_600,
  ebitda_margin_pct:    37.3,
  depreciation_usd:      92_000,
  interest_usd:         108_000,
  ebit_usd:             314_600,
  net_income_usd:       206_600,
};

const PNL_YTD = {
  period: 'Jan–Apr 2026 YTD',
  revenue_usd:         6_488_000,
  operating_costs_usd: 4_104_800,
  ebitda_usd:          2_383_200,
  ebitda_margin_pct:   36.7,
  depreciation_usd:      368_000,
  interest_usd:          432_000,
  ebit_usd:            2_015_200,
  net_income_usd:      1_230_200,
};

// Covenant table — lender side letter. All four must hold month-on-month.
const COVENANTS = [
  {
    id:     'cov-dscr',
    name:   'DSCR ≥ 1.30×',
    metric: '1.34×',
    status: 'PASS',
    detail: 'Trailing 3-month rolling. Threshold 1.30×; headroom 3.1%.',
  },
  {
    id:     'cov-gearing',
    name:   'Debt / equity ≤ 70/30',
    metric: '70 / 30',
    status: 'PASS',
    detail: 'Committed structure locked at covenant ceiling. Drawn 70/30.',
  },
  {
    id:     'cov-liquidity',
    name:   'Minimum liquidity ≥ $2.0M',
    metric: '$2.4M',
    status: 'PASS',
    detail: 'Cash + SBLC-secured facility headroom. Floor $2.0M.',
  },
  {
    id:     'cov-ageing',
    name:   'Receivables > 60d ≤ 5% of balance',
    metric: '3.2%',
    status: 'WATCH',
    detail: 'Apr 07–11 port berth queue pushed 3.2% into the 61–90 band. Clears by May 15.',
  },
];

// 90-day cashflow forecast — weekly buckets from current week.
// Inflows = GIBDLC tariff settlement (30-day terms) + tranche draw.
// Outflows = operating costs, debt service, diesel pre-payments.
const CASHFLOW_FORECAST = [
  { week: '2026-W17', inflow_usd: 0,         outflow_usd: 160_000, net_usd: -160_000, closing_cash_usd: 2_240_000 },
  { week: '2026-W18', inflow_usd: 1_091_000, outflow_usd: 198_000, net_usd:  893_000, closing_cash_usd: 3_133_000 },
  { week: '2026-W19', inflow_usd: 0,         outflow_usd: 542_000, net_usd: -542_000, closing_cash_usd: 2_591_000, note: 'Debt service' },
  { week: '2026-W20', inflow_usd: 0,         outflow_usd: 168_000, net_usd: -168_000, closing_cash_usd: 2_423_000 },
  { week: '2026-W21', inflow_usd: 0,         outflow_usd: 172_000, net_usd: -172_000, closing_cash_usd: 2_251_000 },
  { week: '2026-W22', inflow_usd: 2_058_000, outflow_usd: 202_000, net_usd: 1_856_000, closing_cash_usd: 4_107_000 },
  { week: '2026-W23', inflow_usd: 0,         outflow_usd: 548_000, net_usd: -548_000, closing_cash_usd: 3_559_000, note: 'Debt service' },
  { week: '2026-W24', inflow_usd: 0,         outflow_usd: 176_000, net_usd: -176_000, closing_cash_usd: 3_383_000 },
  { week: '2026-W25', inflow_usd: 0,         outflow_usd: 184_000, net_usd: -184_000, closing_cash_usd: 3_199_000 },
  { week: '2026-W26', inflow_usd: 2_062_000, outflow_usd: 204_000, net_usd: 1_858_000, closing_cash_usd: 5_057_000 },
  { week: '2026-W27', inflow_usd: 0,         outflow_usd: 554_000, net_usd: -554_000, closing_cash_usd: 4_503_000, note: 'Debt service' },
  { week: '2026-W28', inflow_usd: 0,         outflow_usd: 188_000, net_usd: -188_000, closing_cash_usd: 4_315_000 },
  { week: '2026-W29', inflow_usd: 0,         outflow_usd: 192_000, net_usd: -192_000, closing_cash_usd: 4_123_000 },
];

module.exports = {
  DSCR,
  PNL_MTD,
  PNL_YTD,
  COVENANTS,
  CASHFLOW_FORECAST,
};
