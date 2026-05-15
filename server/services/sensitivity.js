'use strict';

/*
 * FX & cost sensitivity calculator — Phase 75.
 *
 * The corridor's tariff is USD-denominated; ~63% of opex (driver
 * wages, fuel, local maintenance) is GHS. A sustained cedi move
 * shifts the margin equation. The risk register (Phase 72)
 * tracks "Cedi devaluation exposure" qualitatively. This module
 * is the quantitative complement: take three input shifts —
 * cedi/USD, diesel price, opex inflation — and compute the
 * downstream effect on tariff effective rate, EBITDA, DSCR, and
 * take-or-pay coverage.
 *
 * Pure compute, no writes. Lender-safe.
 *
 * Composition pattern:
 *
 *   1. Take the baseline DSCR computation as-is.
 *   2. Apply input shifts to the indexation inputs:
 *      - cedi_pct: a -10% cedi (weaker cedi vs USD) means GHS
 *        diesel readings translate to a higher GHS/L price, which
 *        flows through fuel-indexation to a higher effective
 *        tariff. The fuel-component multiplier scales by
 *        (1 + |cedi_pct| / 100) when cedi weakens.
 *      - diesel_pct: a direct shift on top of the FX effect —
 *        a +5% diesel reading bumps the fuel index 5%.
 *      - opex_pct: an across-the-board opex inflation/deflation
 *        applied to the cost ratio.
 *   3. Recompute effective tariff, EBITDA, DSCR.
 *   4. Return baseline + scenario + deltas so the UI can render
 *      a side-by-side comparison without doing math itself.
 */

const { CONTRACT } = require('./aggregator');
const { buildForecast } = require('./forecast');
const { computeEffectiveRate } = require('./indexation');
const dscrService = require('./dscr');
const roster = require('../state/roster');

const { TARIFF_TERMS } = require('../mock/tariff');
const { DSCR: STATIC_DSCR, PNL_YTD } = require('../mock/financials');
const { CAPITAL_STRUCTURE } = require('../mock/tranches');

// Mirror the constants from dscr.js so we can recompute end-to-end.
const ANNUAL_INTEREST_PCT = 9.25;
const AMORT_YEARS = 7;
const MONTHLY_RATE = (ANNUAL_INTEREST_PCT / 100) / 12;
const N_PAYMENTS = AMORT_YEARS * 12;
const MONTHLY_DEBT_SERVICE_USD = (CAPITAL_STRUCTURE.debt_committed_usd * MONTHLY_RATE)
  / (1 - Math.pow(1 + MONTHLY_RATE, -N_PAYMENTS));

const BASE_OPEX_RATIO = PNL_YTD.operating_costs_usd / PNL_YTD.revenue_usd;

// Severity helpers ────────────────────────────────────────────────
function dscrVerdict(dscr, target) {
  if (dscr >= target + 0.05) return 'PASS';
  if (dscr >= target)        return 'WATCH';
  return 'BREACH';
}

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

// ── Tariff under stress ───────────────────────────────────────────
//
// Re-runs the indexation math with shifted inputs. cedi_pct and
// diesel_pct both flow through the fuel multiplier; opex_pct is
// orthogonal (applies to the cost ratio downstream).
function effectiveTariffUnderShift({ cedi_pct = 0, diesel_pct = 0 }) {
  const baseline = computeEffectiveRate();
  const fuelComponent = baseline.components.find((c) => c.key === 'fuel');
  const cpiComponent  = baseline.components.find((c) => c.key === 'cpi');
  const fixedComponent= baseline.components.find((c) => c.key === 'fixed');

  // Cedi shift: a negative cedi_pct (cedi weakens) increases the
  // GHS/L diesel reading proportionally, so the fuel index rises.
  // We model the GHS reading as scaling by (1 / (1 + cedi_pct/100))
  // — i.e. cedi_pct = -10 means the reading is divided by 0.9 = ×1.111.
  const cediMultiplier = 1 / (1 + (cedi_pct / 100));
  // Diesel shift: a direct multiplicative bump on the fuel index
  // on top of the FX-translated reading.
  const dieselMultiplier = 1 + (diesel_pct / 100);
  const shiftedFuelIndex = fuelComponent.index_current * cediMultiplier * dieselMultiplier;

  const multiplier =
      fuelComponent.weight  * shiftedFuelIndex
    + cpiComponent.weight   * cpiComponent.index_current
    + fixedComponent.weight * fixedComponent.index_current;

  // Same pass-through cap/floor as indexation.js
  const clamped = clamp(multiplier,
    TARIFF_TERMS.pass_through_floor_pct / 100,
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
    fuel_index_current:      Number(shiftedFuelIndex.toFixed(4)),
  };
}

// ── DSCR + EBITDA under stress ────────────────────────────────────
//
// Holds tonnes constant (forecast doesn't react to FX in the demo
// model) but moves tariff and opex_ratio. Returns the same shape
// dscr.compute() returns plus the inputs/intermediate values so
// the UI can show a "show your work" panel.
function dscrUnderShift({ tariff_effective, opex_ratio_pct, haulers, now }) {
  const forecast = buildForecast(haulers, now);
  const projectedTonnes = forecast.projection.eom_tonnes;
  const monthRevenue    = projectedTonnes * tariff_effective;
  const monthOpCosts    = monthRevenue * opex_ratio_pct;
  const monthEbitda     = monthRevenue - monthOpCosts;
  const monthDscr       = monthEbitda / MONTHLY_DEBT_SERVICE_USD;

  // Trailing-3 same approximation as dscr.js.
  const closedMonthAvgEbitda = PNL_YTD.ebitda_usd / 4;
  const trailing3Ebitda      = monthEbitda + closedMonthAvgEbitda * 2;
  const trailing3DebtTotal   = MONTHLY_DEBT_SERVICE_USD * 3;
  const trailing3Dscr        = trailing3Ebitda / trailing3DebtTotal;

  const headroomPct = trailing3Dscr > 0
    ? Number((((trailing3Dscr - STATIC_DSCR.target_min) / STATIC_DSCR.target_min) * 100).toFixed(1))
    : 0;

  return {
    current:        Number(trailing3Dscr.toFixed(2)),
    this_month_dscr: Number(monthDscr.toFixed(2)),
    target_min:     STATIC_DSCR.target_min,
    headroom_pct:   headroomPct,
    verdict:        dscrVerdict(trailing3Dscr, STATIC_DSCR.target_min),
    revenue_usd:    Math.round(monthRevenue),
    opex_usd:       Math.round(monthOpCosts),
    ebitda_usd:     Math.round(monthEbitda),
    debt_service_usd: Math.round(MONTHLY_DEBT_SERVICE_USD),
    tariff_effective: Number(tariff_effective.toFixed(2)),
    opex_ratio_pct: Number((opex_ratio_pct * 100).toFixed(1)),
    projected_tonnes: projectedTonnes,
  };
}

// ── Compose ───────────────────────────────────────────────────────

function compose({ cedi_pct = 0, diesel_pct = 0, opex_pct = 0 } = {}, now = new Date()) {
  const haulers = roster.list();

  // Baseline pass — zero shifts.
  const baselineTariff = computeEffectiveRate();
  const baseline = dscrUnderShift({
    tariff_effective: baselineTariff.effective_usd_per_tonne,
    opex_ratio_pct:   BASE_OPEX_RATIO,
    haulers, now,
  });

  // Scenario pass — apply shifts.
  const scenarioTariff = effectiveTariffUnderShift({ cedi_pct, diesel_pct });
  const scenarioOpexRatio = clamp(BASE_OPEX_RATIO * (1 + opex_pct / 100), 0.30, 1.10);
  const scenario = dscrUnderShift({
    tariff_effective: scenarioTariff.effective_usd_per_tonne,
    opex_ratio_pct:   scenarioOpexRatio,
    haulers, now,
  });

  // Phase 148 — DSCR waterfall: three intermediate points isolating
  // each factor's contribution so the client can render a waterfall chart.
  const fxTariff    = effectiveTariffUnderShift({ cedi_pct, diesel_pct: 0 });
  const fxOnly      = dscrUnderShift({ tariff_effective: fxTariff.effective_usd_per_tonne, opex_ratio_pct: BASE_OPEX_RATIO, haulers, now });
  const fxDslTariff = effectiveTariffUnderShift({ cedi_pct, diesel_pct });
  const fxDslOnly   = dscrUnderShift({ tariff_effective: fxDslTariff.effective_usd_per_tonne, opex_ratio_pct: BASE_OPEX_RATIO, haulers, now });

  const waterfall = [
    { label: 'Baseline',  dscr: Number(baseline.current.toFixed(2)),   step: null,                                               type: 'start' },
    { label: 'FX (cedi)', dscr: Number(fxOnly.current.toFixed(2)),     step: Number((fxOnly.current    - baseline.current).toFixed(2)), type: 'delta' },
    { label: 'Diesel',    dscr: Number(fxDslOnly.current.toFixed(2)),  step: Number((fxDslOnly.current - fxOnly.current).toFixed(2)),    type: 'delta' },
    { label: 'Opex',      dscr: Number(scenario.current.toFixed(2)),   step: Number((scenario.current  - fxDslOnly.current).toFixed(2)), type: 'delta' },
    { label: 'Scenario',  dscr: Number(scenario.current.toFixed(2)),   step: null,                                               type: 'end'   },
  ];

  // Deltas — explicit so the UI doesn't reimplement the math.
  const deltas = {
    dscr:                 Number((scenario.current     - baseline.current).toFixed(2)),
    ebitda_usd:           scenario.ebitda_usd          - baseline.ebitda_usd,
    revenue_usd:          scenario.revenue_usd         - baseline.revenue_usd,
    opex_usd:             scenario.opex_usd            - baseline.opex_usd,
    tariff_effective:     Number((scenario.tariff_effective - baseline.tariff_effective).toFixed(2)),
    headroom_pct:         Number((scenario.headroom_pct - baseline.headroom_pct).toFixed(1)),
    verdict_changed:      scenario.verdict !== baseline.verdict,
    crosses_floor:        baseline.verdict !== 'BREACH' && scenario.verdict === 'BREACH',
  };

  return {
    generated_at: new Date(now).toISOString(),
    inputs: { cedi_pct, diesel_pct, opex_pct },
    bounds: {
      cedi_pct:   { min: -25, max: 25 },
      diesel_pct: { min: -30, max: 50 },
      opex_pct:   { min: -10, max: 30 },
    },
    baseline: {
      ...baseline,
      tariff: {
        effective_usd_per_tonne: baselineTariff.effective_usd_per_tonne,
        multiplier:              baselineTariff.multiplier,
        adjustment_pct:          baselineTariff.adjustment_pct,
      },
    },
    scenario: {
      ...scenario,
      tariff: {
        effective_usd_per_tonne: scenarioTariff.effective_usd_per_tonne,
        multiplier:              scenarioTariff.multiplier,
        adjustment_pct:          scenarioTariff.adjustment_pct,
        clamped_at_cap:          scenarioTariff.clamped_at_cap,
        clamped_at_floor:        scenarioTariff.clamped_at_floor,
      },
    },
    deltas,
    waterfall,
    presets: PRESETS,
  };
}

// Common stress scenarios — board-friendly named buttons.
const PRESETS = [
  { id: 'base',     label: 'Base case',     cedi_pct:   0, diesel_pct:   0, opex_pct:  0,
    description: 'Current readings exactly as observed.' },
  { id: 'mild',     label: 'Mild stress',   cedi_pct:  -5, diesel_pct:   5, opex_pct:  3,
    description: 'Cedi −5%, diesel +5%, opex +3%. Within ordinary quarterly variation.' },
  { id: 'moderate', label: 'Moderate',      cedi_pct: -10, diesel_pct:  10, opex_pct:  6,
    description: 'Cedi −10%, diesel +10%, opex +6%. Comparable to 2022 cedi crisis Q3.' },
  { id: 'severe',   label: 'Severe stress', cedi_pct: -20, diesel_pct:  20, opex_pct: 10,
    description: 'Cedi −20%, diesel +20%, opex +10%. Tail-risk scenario for covenant stress test.' },
];

module.exports = { compose, PRESETS };
