'use strict';

/*
 * GET /api/tariff — Indexation tracker.
 * Returns the base rate, each indexation component's contribution, the
 * current effective rate, and the underlying NPA diesel / GSS CPI series
 * that drive the fuel and CPI components.
 */

const express = require('express');
const router = express.Router();

const { CONTRACT } = require('../services/aggregator');
const { computeEffectiveRate, computeEffectiveRateHistory } = require('../services/indexation');
const { NPA_DIESEL, GSS_CPI, TARIFF_TERMS } = require('../mock/tariff');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Next review date: monthly on the 1st. If today's >= the 1st of
// the current month, the next review is the 1st of next month.
function computeNextReview(now = new Date()) {
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth();
  // Always next month's 1st (the current month's 1st has already
  // happened by definition since now > YYYY-MM-01 only on the 1st
  // itself otherwise we're past it).
  const next = new Date(Date.UTC(year, month + 1, 1));
  const days = Math.ceil((next.getTime() - now.getTime()) / ONE_DAY_MS);
  return { iso: next.toISOString(), days_until: days };
}

router.get('/', (_req, res) => {
  const calc = computeEffectiveRate();
  const history = computeEffectiveRateHistory();
  const nextReview = computeNextReview();

  // Phase 86 — month-over-month deltas in the history so the UI
  // can highlight the months where the rate moved most.
  const historyWithDeltas = history.map((row, i) => ({
    ...row,
    delta_usd_per_tonne: i === 0 ? null
      : Number((row.effective_usd_per_tonne - history[i - 1].effective_usd_per_tonne).toFixed(2)),
  }));

  // Phase 152 — per-component USD breakdown per month.
  // Decomposes the effective rate into fuel / CPI / fixed contributions
  // proportional to their unclamped weight shares. When the multiplier
  // is clamped, the proportions still sum to the actual effective rate,
  // giving a stacked bar chart a clean baseline.
  const indexWeights = {
    fuel:  CONTRACT.indexation.fuel_pct_of_tariff,
    cpi:   CONTRACT.indexation.cpi_pct_of_tariff,
    fixed: CONTRACT.indexation.fixed_pct_of_tariff,
  };
  const component_history = historyWithDeltas.map((h) => {
    const rawFuel  = indexWeights.fuel  * h.fuel_index;
    const rawCpi   = indexWeights.cpi   * h.cpi_index;
    const rawFixed = indexWeights.fixed * 1.0;
    const rawTotal = rawFuel + rawCpi + rawFixed;
    const eff = h.effective_usd_per_tonne;
    const fuel_usd  = rawTotal > 0 ? Number((eff * rawFuel  / rawTotal).toFixed(2)) : 0;
    const cpi_usd   = rawTotal > 0 ? Number((eff * rawCpi   / rawTotal).toFixed(2)) : 0;
    const fixed_usd = Number((eff - fuel_usd - cpi_usd).toFixed(2));
    return { month: h.month, fuel_usd, cpi_usd, fixed_usd, effective_usd_per_tonne: eff };
  });

  // Phase 168 — 6-month tariff escalation forecast.
  // Projects what the effective rate would be under three scenarios:
  //   base   — indices held flat at current values
  //   trend  — indices grow at their recent MoM rate (from last 2 history entries)
  //   stress — trend + an extra 1% MoM fuel-price shock
  // All entries marked modelled: true per §12.4.
  function seededTariff(n) {
    const raw = Math.sin(n * 7331 + 61) * 153_017;
    return raw - Math.floor(raw);
  }
  const histLen   = historyWithDeltas.length;
  const recentMoM = histLen >= 2 && historyWithDeltas[histLen - 2].effective_usd_per_tonne > 0
    ? (historyWithDeltas[histLen - 1].effective_usd_per_tonne
       - historyWithDeltas[histLen - 2].effective_usd_per_tonne)
      / historyWithDeltas[histLen - 2].effective_usd_per_tonne
    : 0.005;
  const currentEffective = calc.effective_usd_per_tonne;
  const nowT = new Date();
  const escalation_forecast = Array.from({ length: 6 }, (_, m) => {
    const fDate    = new Date(Date.UTC(nowT.getUTCFullYear(), nowT.getUTCMonth() + m + 1, 1));
    const monthKey = fDate.toISOString().slice(0, 7);
    const mk       = fDate.getUTCFullYear() * 100 + (fDate.getUTCMonth() + 1);
    const noise    = (seededTariff(mk) - 0.5) * 0.002; // ±0.1% noise
    const months   = m + 1;
    return {
      month:       monthKey,
      base_rate:   Number(currentEffective.toFixed(2)),
      trend_rate:  Number((currentEffective * Math.pow(1 + recentMoM + noise,           months)).toFixed(2)),
      stress_rate: Number((currentEffective * Math.pow(1 + recentMoM + noise + 0.010,   months)).toFixed(2)),
      modelled:    true,
    };
  });

  // Phase 230 — 6-month pass-through cap utilisation history.
  // Shows how much of the ±15% fuel pass-through band has been consumed
  // each month. 100% = the cap was fully triggered; 0% = diesel moved
  // within contract tolerance. Seeded to show realistic variation —
  // a corridor with volatile fuel prices will cluster near the cap.
  // MODELLED — requires a live index feed to be production-accurate.
  function seededPassThru(n) {
    const raw = Math.sin(n * 7537 + 71) * 139_009;
    return raw - Math.floor(raw);
  }
  const CAP_PCT = 15; // contract pass-through cap in %
  const nowPT = new Date();
  const pass_through_history = [];
  for (let m = 5; m >= 0; m--) {
    const d = new Date(Date.UTC(nowPT.getUTCFullYear(), nowPT.getUTCMonth() - m, 1));
    const monthKey = d.toISOString().slice(0, 7);
    const seed     = d.getUTCFullYear() * 100 + d.getUTCMonth();
    // utilisation: 0 = no pass-through triggered, 1 = cap fully hit
    const utilisation_pct = Number((seededPassThru(seed) * 100).toFixed(1));
    const actual_delta_pct = Number(((utilisation_pct / 100) * CAP_PCT).toFixed(2));
    pass_through_history.push({
      month:            monthKey,
      utilisation_pct,
      actual_delta_pct,
      cap_pct:          CAP_PCT,
      cap_triggered:    utilisation_pct >= 80,
      modelled:         true,
    });
  }

  res.json({
    generated_at: new Date().toISOString(),
    base: {
      rate_usd_per_tonne:     CONTRACT.base_tariff_usd_per_tonne,
      rate_usd_per_tonne_km:  CONTRACT.base_tariff_usd_per_tonne_km,
      corridor_km:            CONTRACT.corridor_km,
    },
    effective_rate_usd_per_tonne: calc.effective_usd_per_tonne,
    adjustment_pct:               calc.adjustment_pct,
    multiplier:                   calc.multiplier,
    clamped_at_cap:               calc.clamped_at_cap,
    clamped_at_floor:             calc.clamped_at_floor,
    components:                   calc.components,
    next_review:                  nextReview,
    effective_rate_history:       historyWithDeltas,
    component_history,
    npa_diesel: NPA_DIESEL,
    gss_cpi:    GSS_CPI,
    terms:      TARIFF_TERMS,
    escalation_forecast,
    pass_through_history,
  });
});

module.exports = router;
