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

  res.json({ ...base, actual_burns, burn_ranking });
});

module.exports = router;
