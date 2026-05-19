'use strict';

/*
 * GET /api/positions              — latest known position for every vehicle
 * GET /api/positions/:vehicle_id  — latest position for one vehicle
 *
 * LP-17: thin wrapper around positionStore so the map overlay (and any future
 * real-time WebSocket layer) can poll current GPS positions without loading the
 * full corridor snapshot.
 */

const express       = require('express');
const router        = express.Router();
const positionStore = require('../state/positionStore');
const roster        = require('../state/roster');
const { requireAuth }        = require('../middleware/auth');
const { enforceHaulerScope } = require('../middleware/haulerScope');

/* ── All vehicles ────────────────────────────────────────────────── */

router.get('/', requireAuth, enforceHaulerScope, (req, res) => {
  const haulerId = req.query.hauler_id || null;

  // Build display-name map for enrichment.
  const haulersById = Object.fromEntries(
    roster.list().map((h) => [h.id, h.display_name]),
  );

  try {
    const positions = haulerId
      ? positionStore.byHauler(haulerId)
      : positionStore.all();

    const enriched = positions.map((p) => ({
      vehicle_id:          p.vehicle_id,
      hauler_id:           p.hauler_id,
      hauler_display_name: haulersById[p.hauler_id] ?? p.hauler_id,
      latitude:            p.latitude,
      longitude:           p.longitude,
      speed_kmh:           p.speed_kmh,
      heading_deg:         p.heading_deg,
      position_at:         p.position_at,
    }));

    res.json({ count: enriched.length, positions: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

/* ── Single vehicle ──────────────────────────────────────────────── */

router.get('/:vehicle_id', (req, res) => {
  try {
    const pos = positionStore.byVehicle(req.params.vehicle_id);
    if (!pos) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(pos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch position' });
  }
});

module.exports = router;
