'use strict';

/*
 * Indexation — computes the current effective tariff from the base rate,
 * the three indexation components (fuel 40% / CPI 30% / fixed 30%), and
 * the latest NPA diesel and GSS CPI readings. Base month is 2026-01.
 *
 * Effective rate = base × (w_fuel × (P_fuel_now / P_fuel_base)
 *                        + w_cpi  × (I_cpi_now  / I_cpi_base)
 *                        + w_fixed × 1).
 *
 * Pass-through is capped at pass_through_cap_pct / floor_pct (tariff terms).
 */

const { CONTRACT } = require('./aggregator');
const { NPA_DIESEL, GSS_CPI, TARIFF_TERMS } = require('../mock/tariff');

function computeComponents() {
  const weights = {
    fuel:  CONTRACT.indexation.fuel_pct_of_tariff,
    cpi:   CONTRACT.indexation.cpi_pct_of_tariff,
    fixed: CONTRACT.indexation.fixed_pct_of_tariff,
  };

  const fuelIndex  = NPA_DIESEL.current_ghs_per_l / NPA_DIESEL.base_ghs_per_l;
  const cpiIndex   = GSS_CPI.current_index / GSS_CPI.base_index;
  const fixedIndex = 1.0;

  return [
    {
      key:   'fuel',
      label: 'Fuel (NPA diesel)',
      weight: weights.fuel,
      base_reading:    `${NPA_DIESEL.base_ghs_per_l.toFixed(2)} GHS/L`,
      current_reading: `${NPA_DIESEL.current_ghs_per_l.toFixed(2)} GHS/L`,
      index_current: Number(fuelIndex.toFixed(4)),
      contribution_pct: Number((weights.fuel * fuelIndex * 100).toFixed(2)),
    },
    {
      key:   'cpi',
      label: 'CPI (GSS headline)',
      weight: weights.cpi,
      base_reading:    GSS_CPI.base_index.toFixed(1),
      current_reading: GSS_CPI.current_index.toFixed(1),
      index_current: Number(cpiIndex.toFixed(4)),
      contribution_pct: Number((weights.cpi * cpiIndex * 100).toFixed(2)),
    },
    {
      key:   'fixed',
      label: 'Fixed USD',
      weight: weights.fixed,
      base_reading:    '1.000',
      current_reading: '1.000',
      index_current: Number(fixedIndex.toFixed(4)),
      contribution_pct: Number((weights.fixed * fixedIndex * 100).toFixed(2)),
    },
  ];
}

function computeEffectiveRate() {
  const components = computeComponents();
  const multiplier = components.reduce((s, c) => s + c.weight * c.index_current, 0);
  const clamped = Math.min(
    Math.max(multiplier, TARIFF_TERMS.pass_through_floor_pct / 100),
    TARIFF_TERMS.pass_through_cap_pct / 100,
  );
  const base = CONTRACT.base_tariff_usd_per_tonne;
  const effective = base * clamped;
  return {
    base_usd_per_tonne:      base,
    effective_usd_per_tonne: Number(effective.toFixed(2)),
    adjustment_pct:          Number(((clamped - 1) * 100).toFixed(2)),
    multiplier:              Number(clamped.toFixed(4)),
    clamped_at_cap:          multiplier > TARIFF_TERMS.pass_through_cap_pct / 100,
    clamped_at_floor:        multiplier < TARIFF_TERMS.pass_through_floor_pct / 100,
    components,
  };
}

// ── Phase 86 — Historical effective rate ──────────────────────────
//
// Walks each month in the source series and computes what the
// effective rate WOULD have been with that month's diesel + CPI
// reading applied to the indexation formula. Used by the Tariff
// page's history card to show the rate's trajectory rather than
// just the underlying components.
function computeEffectiveRateHistory() {
  const weights = {
    fuel:  CONTRACT.indexation.fuel_pct_of_tariff,
    cpi:   CONTRACT.indexation.cpi_pct_of_tariff,
    fixed: CONTRACT.indexation.fixed_pct_of_tariff,
  };
  const base = CONTRACT.base_tariff_usd_per_tonne;

  const dieselByMonth = new Map();
  for (const r of NPA_DIESEL.series) dieselByMonth.set(r.month, r.ghs_per_l);
  const cpiByMonth = new Map();
  for (const r of GSS_CPI.series) cpiByMonth.set(r.month, r.index);

  const allMonths = Array.from(new Set([
    ...NPA_DIESEL.series.map((r) => r.month),
    ...GSS_CPI.series.map((r) => r.month),
  ])).sort();

  return allMonths.map((month) => {
    const fuelReading = dieselByMonth.get(month);
    const cpiReading  = cpiByMonth.get(month);
    if (fuelReading == null || cpiReading == null) return null;
    const fuelIndex = fuelReading / NPA_DIESEL.base_ghs_per_l;
    const cpiIndex  = cpiReading  / GSS_CPI.base_index;
    const multiplier = weights.fuel * fuelIndex
                     + weights.cpi  * cpiIndex
                     + weights.fixed * 1.0;
    const clamped = Math.min(
      Math.max(multiplier, TARIFF_TERMS.pass_through_floor_pct / 100),
      TARIFF_TERMS.pass_through_cap_pct / 100,
    );
    return {
      month,
      effective_usd_per_tonne: Number((base * clamped).toFixed(2)),
      multiplier:              Number(clamped.toFixed(4)),
      adjustment_pct:          Number(((clamped - 1) * 100).toFixed(2)),
      fuel_index:              Number(fuelIndex.toFixed(4)),
      cpi_index:               Number(cpiIndex.toFixed(4)),
      clamped_at_cap:          multiplier > TARIFF_TERMS.pass_through_cap_pct / 100,
      clamped_at_floor:        multiplier < TARIFF_TERMS.pass_through_floor_pct / 100,
    };
  }).filter(Boolean);
}

module.exports = { computeComponents, computeEffectiveRate, computeEffectiveRateHistory };
