'use strict';

/*
 * Contract fixtures for the GIBDLC contract dashboard.
 * Historical delivery series is the last 12 months (back-fill for ramp
 * period); SLA and payment-security figures are modelled off the business
 * plan's Tranche 1 assumptions. Monthly contracted volume is derived from
 * the aggregator's CONTRACT.target_mtpa so Contract and Today reconcile.
 */

// 12-month delivered-tonnes series for the YTD chart.
// Ramp begins Jan 2026; target is 83.3 kt per month at Tranche 1 steady state.
const DELIVERY_HISTORY = [
  { month: '2025-05', delivered: 0,     contracted: 0,     floor: 0 },
  { month: '2025-06', delivered: 0,     contracted: 0,     floor: 0 },
  { month: '2025-07', delivered: 0,     contracted: 0,     floor: 0 },
  { month: '2025-08', delivered: 0,     contracted: 0,     floor: 0 },
  { month: '2025-09', delivered: 0,     contracted: 0,     floor: 0 },
  { month: '2025-10', delivered: 0,     contracted: 0,     floor: 0 },
  { month: '2025-11', delivered: 14200, contracted: 41667, floor: 33333 },
  { month: '2025-12', delivered: 38400, contracted: 62500, floor: 50000 },
  { month: '2026-01', delivered: 68200, contracted: 83333, floor: 66666 },
  { month: '2026-02', delivered: 75400, contracted: 83333, floor: 66666 },
  { month: '2026-03', delivered: 79100, contracted: 83333, floor: 66666 },
  // 2026-04 is the current partial month; aggregator fills this live.
];

const SLA_BREAKDOWN = {
  loading_on_time_pct:   92.4,
  offloading_on_time_pct: 88.6,
  cycle_completion_pct:  94.1,
  notes: 'Target 90% on all three. Offloading drags — port berth queue Apr 07–11.',
};

const PAYMENT_SECURITY = {
  sblc: {
    face_value_usd: 4_800_000,
    issuer: 'Ecobank Ghana',
    expiry: '2026-11-30',
    days_to_expiry: null,   // filled at request time
    coverage_months: 2.4,   // face value ÷ monthly tariff revenue
  },
  receivables: {
    current_balance_usd: 1_240_000,
    terms_days: 30,
    ageing: {
      band_0_30:  920_000,
      band_31_60: 280_000,
      band_61_90:  40_000,
      band_90p:        0,
    },
    overdue_pct: null, // filled at request time
  },
};

const CONTRACT_TERMS = {
  counterparty: 'GIBDLC',
  oversight:    'GIADEC',
  start_date:   '2026-01-01',
  term_years:   10,
  renewal:      '5-year extension option, joint agreement',
  corridor:     'Nyinahin–Takoradi (300 km, N6/N8 via Kumasi)',
  commodity:    'Bauxite (wet, 40 t payload per rig)',
  currency:     'USD',
  review_cadence: 'Tariff reviewed monthly against NPA diesel + GSS CPI. Volumes reviewed quarterly.',
};

module.exports = {
  DELIVERY_HISTORY,
  SLA_BREAKDOWN,
  PAYMENT_SECURITY,
  CONTRACT_TERMS,
};
