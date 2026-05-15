'use strict';

/*
 * GET /api/snapshot
 * Corridor-level rollup — derives every figure from the hauler roster via
 * the aggregator service. Onboarding a new hauler via POST /api/haulers
 * shows up here on the next read.
 *
 * Shape is the contract the client relies on — extend, do not rename.
 */

const express = require('express');
const router = express.Router();

const roster = require('../state/roster');
const { aggregate, CONTRACT, TRANCHE_1 } = require('../services/aggregator');
const dscrService = require('../services/dscr');

/* ── Phase 131: Corridor health score ──────────────────────────────
 * Synthetic 0-100 score built from five operational dimensions:
 *   DSCR headroom    (25 pts) — DSCR ≥ 1.5 = full; ≥ 1.3 = half; <1.3 = 0
 *   SLA attainment   (25 pts) — linear 75→100% → 0→25pts
 *   Fleet utilisation(20 pts) — active / contracted ratio → 0→20pts
 *   Driver compliance(15 pts) — avg on-time across active haulers → 0→15pts
 *   Maintenance      (15 pts) — static Tranche 1 baseline (improved in later phases)
 */
function computeHealthScore(agg, dscrRatio) {
  // DSCR component
  const dscrScore = dscrRatio >= 1.5 ? 25 : dscrRatio >= 1.3 ? 12 : dscrRatio >= 1.0 ? 6 : 0;

  // SLA attainment — 75→100% maps to 0→25pts
  const sla = Math.max(0, Math.min(100, agg.sla_attainment_pct));
  const slaScore = sla >= 75 ? ((sla - 75) / 25) * 25 : 0;

  // Fleet utilisation
  const utilPct = agg.fleet.contracted_trucks > 0
    ? agg.fleet.active_trucks / agg.fleet.contracted_trucks
    : 0;
  const utilScore = Math.round(utilPct * 20);

  // Driver compliance (on-time avg across active haulers)
  const activeHaulers = agg.haulers.filter((h) => h.status === 'active');
  const onTimePct = activeHaulers.length > 0
    ? activeHaulers.reduce((s, h) => s + h.performance.on_time_pct, 0) / activeHaulers.length
    : 0;
  const driverScore = Math.round((Math.min(100, onTimePct) / 100) * 15);

  // Maintenance — static baseline for Tranche 1 (Phase 132+ will compute live)
  const maintScore = 12; // out of 15

  const total = Math.round(dscrScore + slaScore + utilScore + driverScore + maintScore);
  const verdict = total >= 80 ? 'STRONG' : total >= 65 ? 'WATCH' : 'BELOW';
  const color   = total >= 80 ? 'green'  : total >= 65 ? 'amber'  : 'rust';

  return {
    score: total,
    max:   100,
    verdict,
    color,
    components: {
      dscr:        { score: dscrScore,  max: 25, label: 'DSCR headroom' },
      sla:         { score: Math.round(slaScore), max: 25, label: 'SLA attainment' },
      utilisation: { score: utilScore,  max: 20, label: 'Fleet utilisation' },
      driver:      { score: driverScore,max: 15, label: 'Driver on-time' },
      maintenance: { score: maintScore, max: 15, label: 'Maintenance' },
    },
  };
}

router.get('/', (_req, res) => {
  const agg  = aggregate(roster.list());
  const dscr = dscrService.compute(roster.list(), new Date());
  const health = computeHealthScore(agg, dscr?.current?.ratio ?? 0);

  res.json({
    health,          // Phase 131
    generated_at: agg.generated_at,
    corridor: {
      name: 'Nyinahin–Takoradi',
      length_km: CONTRACT.corridor_km,
      counterparty: 'GIBDLC',
      tonnes_delivered_mtd:   agg.tonnes.delivered_mtd,
      tonnes_contracted_mtd:  agg.tonnes.contracted_mtd,
      take_or_pay_floor_pct:  CONTRACT.take_or_pay_floor_pct,
      active_trucks_today:    agg.fleet.active_trucks,
      contracted_trucks:      agg.fleet.contracted_trucks,
      sla_attainment_pct:     agg.sla_attainment_pct,
    },
    haulers: agg.haulers.map((h) => ({
      id: h.id,
      display_name: h.display_name,
      contracted_trucks: h.fleet.contracted_trucks,
      active_trucks:     h.fleet.active_trucks,
      api_status:        h.api_status,
      on_time_pct:       h.performance.on_time_pct,
    })),
    contract: {
      base_tariff_usd_per_tonne_km: CONTRACT.base_tariff_usd_per_tonne_km,
      base_tariff_usd_per_tonne:    CONTRACT.base_tariff_usd_per_tonne,
      indexation: CONTRACT.indexation,
      take_or_pay_floor_pct:        CONTRACT.take_or_pay_floor_pct,
      payment_terms_days:           CONTRACT.payment_terms_days,
    },
    tranches: {
      current: TRANCHE_1.current,
      target_mtpa: TRANCHE_1.target_mtpa,
      capex_committed_usd_m: TRANCHE_1.capex_committed_usd_m,
      fleet_deployed: agg.fleet.contracted_trucks,
    },
  });
});

module.exports = router;
