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
    npa_diesel: NPA_DIESEL,
    gss_cpi:    GSS_CPI,
    terms:      TARIFF_TERMS,
  });
});

module.exports = router;
