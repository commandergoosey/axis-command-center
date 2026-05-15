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

  res.json({ ...base, actual_burns });
});

module.exports = router;
