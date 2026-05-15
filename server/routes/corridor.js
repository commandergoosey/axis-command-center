'use strict';

/*
 * GET  /api/corridor                         — Topology, conditions, active convoys.
 * GET  /api/corridor/advisories              — All advisories (axis_admin / axis_ops).
 * POST /api/corridor/advisories              — Post a new advisory (axis_admin / axis_ops).
 * POST /api/corridor/advisories/:id/resolve  — Resolve an advisory (axis_admin / axis_ops).
 * DELETE /api/corridor/advisories/:id        — Hard delete (axis_admin only).
 *
 * Phase 98 — live advisory write path added to the existing read route.
 */

const express = require('express');
const router = express.Router();

const { WAYPOINTS, SEGMENTS, CONDITIONS, ACTIVE_CONVOYS } = require('../mock/corridor');
const { CONTRACT }   = require('../services/aggregator');
const roster         = require('../state/roster');
const advisories     = require('../state/corridorAdvisories');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../db/audit');

/* ── Corridor snapshot ───────────────────────────────────────────── */

router.get('/', (_req, res) => {
  const haulersById = Object.fromEntries(
    roster.list().map((h) => [h.id, h.display_name]),
  );

  const activeConvoys = ACTIVE_CONVOYS.map((c) => ({
    ...c,
    hauler_display_name: haulersById[c.hauler_id] ?? c.hauler_id,
  }));

  // Merge live advisories on top of the mock baseline.
  // Live advisories always come first (sorted by severity inside listActive()).
  const liveAdvisories = advisories.listActive();
  const mockAdvisories = CONDITIONS.advisories ?? [];

  // If there are live advisories, replace the mock list entirely so the
  // operator's real field reports aren't buried under stale demo content.
  // If no live entries exist, fall back to mock so the page is never empty.
  const mergedAdvisories = liveAdvisories.length > 0
    ? liveAdvisories
    : mockAdvisories;

  // Phase 147 — synthetic 30-day corridor health score history.
  // Seeded deterministically by day-of-year so the chart is stable
  // across requests but still shows realistic variation. A real
  // implementation would store these in the DB as they are computed.
  function seeded(n) {
    const x = Math.sin(n * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  }
  const today = new Date();
  const BASE_SCORE = 72;
  const health_history = [];
  for (let d = 29; d >= 0; d--) {
    const date = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - d,
    ));
    const doy = Math.floor((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 0))) / 86_400_000);
    const score = Math.min(100, Math.max(42, Math.round(BASE_SCORE + seeded(doy) * 22 - 11)));
    health_history.push({
      date:  date.toISOString().slice(0, 10),
      score,
      verdict: score >= 75 ? 'STRONG' : score >= 60 ? 'WATCH' : 'BELOW',
    });
  }

  res.json({
    corridor: {
      name:         'Nyinahin–Takoradi',
      length_km:    CONTRACT.corridor_km,
      counterparty: 'GIBDLC',
    },
    waypoints:     WAYPOINTS,
    segments:      SEGMENTS,
    conditions:    { ...CONDITIONS, advisories: mergedAdvisories },
    active_convoys: activeConvoys,
    health_history,
  });
});

/* ── Advisory management — read ────────────────────────────────── */

router.get(
  '/advisories',
  requireRole('axis_admin', 'axis_ops'),
  (_req, res) => {
    res.json({ advisories: advisories.listAll() });
  },
);

/* ── Advisory management — create ──────────────────────────────── */

router.post(
  '/advisories',
  requireRole('axis_admin', 'axis_ops'),
  (req, res) => {
    const { severity, body, km_from, km_to, expires_at } = req.body || {};
    try {
      const advisory = advisories.add({
        severity,
        body,
        km_from: km_from ? Number(km_from) : null,
        km_to:   km_to   ? Number(km_to)   : null,
        expires_at: expires_at || null,
        by_id:   req.user.id,
        by_name: req.user.display_name,
      });
      writeAudit({
        req,
        entity_type: 'corridor_advisory',
        entity_id:   String(advisory._db_id),
        action:      'create',
        summary:     `[${advisory.severity.toUpperCase()}] Advisory posted: ${advisory.body.slice(0, 80)}`,
      });
      res.status(201).json({ advisory });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },
);

/* ── Advisory management — resolve ─────────────────────────────── */

router.post(
  '/advisories/:id/resolve',
  requireRole('axis_admin', 'axis_ops'),
  (req, res) => {
    const dbId = parseInt(req.params.id, 10);
    if (!Number.isFinite(dbId)) return res.status(400).json({ error: 'Invalid id' });

    const advisory = advisories.resolve(dbId, { by_name: req.user.display_name });
    if (!advisory) return res.status(404).json({ error: 'Advisory not found or already resolved' });

    writeAudit({
      req,
      entity_type: 'corridor_advisory',
      entity_id:   String(dbId),
      action:      'resolve',
      summary:     `Advisory resolved: ${advisory.body.slice(0, 80)}`,
    });
    res.json({ advisory });
  },
);

/* ── Advisory management — delete (axis_admin only) ────────────── */

router.delete(
  '/advisories/:id',
  requireRole('axis_admin'),
  (req, res) => {
    const dbId = parseInt(req.params.id, 10);
    if (!Number.isFinite(dbId)) return res.status(400).json({ error: 'Invalid id' });

    const existing = advisories.findById(dbId);
    if (!existing) return res.status(404).json({ error: 'Advisory not found' });

    advisories.remove(dbId);
    writeAudit({
      req,
      entity_type: 'corridor_advisory',
      entity_id:   String(dbId),
      action:      'delete',
      summary:     `Advisory deleted: ${existing.body.slice(0, 80)}`,
    });
    res.json({ deleted: true });
  },
);

module.exports = router;
