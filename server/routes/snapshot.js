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

router.get('/', (_req, res) => {
  const agg = aggregate(roster.list());

  res.json({
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
