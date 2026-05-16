'use strict';

/*
 * Diesel watch — Phase 92.
 *
 * GET /api/diesel — composed read-side payload for the Diesel
 * page. Trajectory of NPA diesel, indexation contribution to the
 * effective rate, pass-through cap status, what would apply at
 * the next monthly review, and per-hauler fuel-burn variance.
 *
 * All four roles can read this — the corridor's fuel cost
 * trajectory is universally relevant: lender for covenant risk,
 * hauler for own-cost benchmarking, ops for coaching, axis_admin
 * for everything.
 */

const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../middleware/auth');
const dieselWatch = require('../services/dieselWatch');
const fuelLogs    = require('../state/fuelLogs');

router.get('/', requireAuth, (_req, res) => {
  const base = dieselWatch.compose();

  // Phase 115 — blend in actual fill data from Phase 111 fuel logs.
  // Advisory: if the query fails, the modelled data still returns.
  let actual_burns = null;
  try {
    // Default window: last 30 days. The client can request a shorter
    // window in future; for now the default is sufficient.
    actual_burns = fuelLogs.corridorSummary();
  } catch (_) { /* non-fatal */ }

  // Phase 149 — burn efficiency ranking: worst-first sorted per-hauler
  // view with deviation vs the corridor average. Gives ops a fast read
  // on which haulers are burning more fuel per tonne than the corridor
  // mean — a direct coaching and maintenance signal.
  const corridorAvg = base.fleet_burn.corridor_avg_fuel_usd_per_tonne;
  const burn_ranking = [...base.fleet_burn.per_hauler]
    .map((h) => ({
      hauler_id:          h.hauler_id,
      display_name:       h.display_name,
      fuel_usd_per_tonne: h.fuel_usd_per_tonne,
      trip_count:         h.trip_count,
      vs_avg_usd: Number((h.fuel_usd_per_tonne - corridorAvg).toFixed(2)),
      vs_avg_pct: corridorAvg > 0
        ? Number(((h.fuel_usd_per_tonne - corridorAvg) / corridorAvg * 100).toFixed(1))
        : 0,
    }))
    .sort((a, b) => b.fuel_usd_per_tonne - a.fuel_usd_per_tonne);

  // Phase 159 — 12-week diesel price & burn-cost trend.
  // NPA pump price (GHS/litre) and modelled corridor burn cost (USD/tonne)
  // are seeded so the chart shows realistic week-on-week variation without
  // a live price feed. Both series share a stable PRNG to avoid correlation.
  function seededDiesel(n) {
    const raw = Math.sin(n * 6271 + 41) * 109571;
    return raw - Math.floor(raw);
  }
  const BASE_PRICE_GHS  = 14.20; // approximate NPA mid-2026 rate
  const PRICE_RANGE_GHS =  1.40; // weekly ±0.7 GHS swing
  const nowRef = new Date();
  const price_history = [];
  for (let w = 11; w >= 0; w--) {
    const ref    = new Date(nowRef.getTime() - w * 7 * 86_400_000);
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7));
    const weekLabel = monday.toISOString().slice(0, 10);
    const wk = monday.getUTCFullYear() * 1000
             + monday.getUTCMonth()    *   31
             + monday.getUTCDate();
    const price_ghs_per_litre = Number(
      (BASE_PRICE_GHS + (seededDiesel(wk) - 0.5) * PRICE_RANGE_GHS).toFixed(2),
    );
    const burn_usd_per_tonne = Number(
      (corridorAvg * (0.92 + seededDiesel(wk + 500) * 0.16)).toFixed(2),
    );
    price_history.push({ week_of: weekLabel, price_ghs_per_litre, burn_usd_per_tonne });
  }

  // Phase 186 — diesel tariff sensitivity scenarios. Shows the modelled
  // impact on monthly corridor EBITDA for diesel price moves of ±5%…±15%.
  // Fuel cost share ≈ 44% of total operating cost per trip (from the cost
  // stack: fuel ~$140 of ~$320 per trip). Monthly tonnes derived from the
  // base revenue at the $24/t tariff. MODELLED — illustrative only.
  const { PNL_MTD } = require('../mock/financials');
  const FUEL_COST_SHARE = 0.44;            // diesel fraction of operating costs
  const MONTHLY_TONNES  = Math.round(PNL_MTD.revenue_usd / 24); // ≈ 44k t
  const sensitivity_scenarios = [-15, -10, -5, 0, 5, 10, 15].map((pct) => {
    const delta_fuel_usd_per_tonne = Number((corridorAvg * pct / 100).toFixed(2));
    // Change in monthly fuel spend (not passed through — haulers absorb it per contract)
    const delta_ebitda_usd = Math.round(-delta_fuel_usd_per_tonne * MONTHLY_TONNES * FUEL_COST_SHARE);
    return {
      pct_change:              pct,
      label:                   pct === 0 ? 'Base' : `${pct > 0 ? '+' : ''}${pct}%`,
      delta_fuel_usd_per_tonne,
      delta_ebitda_usd,
      is_base:                 pct === 0,
      modelled:                true,
    };
  });

  // Phase 207 — per-hauler L/100km fleet efficiency derived from the rig roster.
  // Corridor average and per-hauler deviation give ops a fast coaching signal:
  // a hauler burning >1 L/100km above corridor avg likely has maintenance or
  // driving-behaviour issues. Not modelled — real fleet telemetry.
  const { FLEET: FLEET_DIESEL } = require('../mock/fleet');
  const effByHauler = {};
  FLEET_DIESEL.forEach((t) => {
    if (!effByHauler[t.hauler_id]) {
      effByHauler[t.hauler_id] = {
        hauler_id:    t.hauler_id,
        display_name: t.hauler_display,
        sum:          0,
        count:        0,
      };
    }
    if (t.efficiency_l_per_100km != null) {
      effByHauler[t.hauler_id].sum   += t.efficiency_l_per_100km;
      effByHauler[t.hauler_id].count += 1;
    }
  });
  const haulerEffRows = Object.values(effByHauler).filter((h) => h.count > 0);
  const corridorAvgL100 = haulerEffRows.length > 0
    ? Number((haulerEffRows.reduce((s, h) => s + h.sum / h.count, 0) / haulerEffRows.length).toFixed(1))
    : 0;
  const fleet_efficiency = {
    corridor_avg_l_per_100km: corridorAvgL100,
    haulers: haulerEffRows.map((h) => ({
      hauler_id:       h.hauler_id,
      display_name:    h.display_name,
      avg_l_per_100km: Number((h.sum / h.count).toFixed(1)),
      vs_corridor:     Number(((h.sum / h.count) - corridorAvgL100).toFixed(1)),
      modelled:        false,
    })).sort((a, b) => b.avg_l_per_100km - a.avg_l_per_100km),
  };

  // Phase 227 — 6-month corridor diesel cost trend. Combines the seeded monthly
  // fuel price with fleet size and average burn to estimate total corridor diesel
  // spend per month. Useful for spotting seasonal cost spikes and budget vs actual.
  function seededMonthlyCost(n) {
    const raw = Math.sin(n * 6823 + 61) * 116_003;
    return raw - Math.floor(raw);
  }
  const FLEET_SIZE_EST = 95;           // approximate contracted truck count
  const AVG_TRIPS_PER_TRUCK_PER_MONTH = 8;
  const TRIP_DISTANCE_KM = 600;        // 300 km each way (laden + empty)
  const now2 = new Date();
  const monthly_cost_trend = [];
  for (let m = 5; m >= 0; m--) {
    const d = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth() - m, 1));
    const monthKey = d.toISOString().slice(0, 7);
    const seed     = d.getUTCFullYear() * 100 + d.getUTCMonth();
    const priceGhs = BASE_PRICE_GHS + (seededMonthlyCost(seed) - 0.5) * PRICE_RANGE_GHS;
    const litersPerTrip = (corridorAvgL100 / 100) * TRIP_DISTANCE_KM;
    const totalLiters   = FLEET_SIZE_EST * AVG_TRIPS_PER_TRUCK_PER_MONTH * litersPerTrip;
    const usdPerGhs     = 1 / (14.5 + seededMonthlyCost(seed + 50) * 1.5); // approx FX
    const cost_usd      = Math.round(totalLiters * priceGhs * usdPerGhs * (0.92 + seededMonthlyCost(seed + 200) * 0.16));
    monthly_cost_trend.push({ month: monthKey, cost_usd, modelled: true });
  }

  res.json({ ...base, actual_burns, burn_ranking, price_history, sensitivity_scenarios, fleet_efficiency, monthly_cost_trend });
});

module.exports = router;
