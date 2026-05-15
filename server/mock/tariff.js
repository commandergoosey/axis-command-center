'use strict';

/*
 * Tariff fixtures — NPA diesel series (GHS per litre) and GSS CPI series
 * used by services/indexation.js to compute the current effective tariff.
 * Base month is 2026-01 (contract start). Figures are modelled and carry
 * a MODELLED tag in the UI.
 */

// NPA diesel pump price — monthly average, GHS per litre.
// Base reading (2026-01) is GHS 15.72 per contract definition.
// Phase 92 — added 2026-05 reading and earlier history (2025-01..06)
// so Diesel watch has 17 months for its trajectory chart.
const NPA_DIESEL = {
  base_month: '2026-01',
  base_ghs_per_l: 15.72,
  current_ghs_per_l: 16.34,
  series: [
    { month: '2025-01', ghs_per_l: 12.20 },
    { month: '2025-02', ghs_per_l: 12.58 },
    { month: '2025-03', ghs_per_l: 12.94 },
    { month: '2025-04', ghs_per_l: 13.22 },
    { month: '2025-05', ghs_per_l: 13.48 },
    { month: '2025-06', ghs_per_l: 13.80 },
    { month: '2025-07', ghs_per_l: 14.10 },
    { month: '2025-08', ghs_per_l: 14.48 },
    { month: '2025-09', ghs_per_l: 14.76 },
    { month: '2025-10', ghs_per_l: 15.02 },
    { month: '2025-11', ghs_per_l: 15.30 },
    { month: '2025-12', ghs_per_l: 15.58 },
    { month: '2026-01', ghs_per_l: 15.72 },
    { month: '2026-02', ghs_per_l: 15.84 },
    { month: '2026-03', ghs_per_l: 15.98 },
    { month: '2026-04', ghs_per_l: 16.10 },
    { month: '2026-05', ghs_per_l: 16.34 },
  ],
};

// Ghana Statistical Service CPI — monthly index. Base reading 2026-01 = 100.
const GSS_CPI = {
  base_month: '2026-01',
  base_index: 100.0,
  current_index: 102.4,
  series: [
    { month: '2025-01', index:  93.6 },
    { month: '2025-02', index:  94.1 },
    { month: '2025-03', index:  94.7 },
    { month: '2025-04', index:  95.3 },
    { month: '2025-05', index:  95.8 },
    { month: '2025-06', index:  96.4 },
    { month: '2025-07', index:  97.2 },
    { month: '2025-08', index:  97.7 },
    { month: '2025-09', index:  98.3 },
    { month: '2025-10', index:  98.9 },
    { month: '2025-11', index:  99.4 },
    { month: '2025-12', index:  99.8 },
    { month: '2026-01', index: 100.0 },
    { month: '2026-02', index: 100.6 },
    { month: '2026-03', index: 101.2 },
    { month: '2026-04', index: 101.8 },
    { month: '2026-05', index: 102.4 },
  ],
};

const TARIFF_TERMS = {
  review_cadence: 'Monthly on the 1st',
  next_review_date: '2026-06-01',
  pass_through_cap_pct: 125,   // fuel cannot move the headline rate by more than 25%
  pass_through_floor_pct: 75,
  notes: 'Fuel indexed to NPA diesel (GHS) converted at monthly USD/GHS average. CPI indexed to GSS headline CPI.',
};

module.exports = { NPA_DIESEL, GSS_CPI, TARIFF_TERMS };
