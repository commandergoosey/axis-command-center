'use strict';

/*
 * GET /api/sensitivity?cedi_pct=&diesel_pct=&opex_pct= — Phase 75.
 *
 * Pure compute. Pass the three input shifts; return baseline +
 * scenario + deltas. All authenticated roles can read — this is
 * the kind of stress-test surface lenders explicitly want.
 *
 * Default zeros (no shift) reproduce the baseline for free.
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const sensitivity = require('../services/sensitivity');

function parsePctParam(raw, defaultValue, bounds) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, bounds.min), bounds.max);
}

router.get('/', requireAuth, (req, res) => {
  const cedi   = parsePctParam(req.query.cedi_pct,   0, { min: -25, max: 25 });
  const diesel = parsePctParam(req.query.diesel_pct, 0, { min: -30, max: 50 });
  const opex   = parsePctParam(req.query.opex_pct,   0, { min: -10, max: 30 });
  res.json(sensitivity.compose({ cedi_pct: cedi, diesel_pct: diesel, opex_pct: opex }));
});

module.exports = router;
