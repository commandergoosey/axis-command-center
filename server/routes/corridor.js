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

  // Phase 172 — 4-week corridor throughput forecast: base / optimistic / conservative.
  // Anchored to the most recent week's corridor health score as a proxy for
  // throughput capacity. MODELLED — seeded for demo stability.
  function seededCorr(n) {
    const raw = Math.sin(n * 8221 + 67) * 183_017;
    return raw - Math.floor(raw);
  }
  const WEEKLY_BASE_TONNES = 8_400;     // baseline corridor capacity
  const lastScore = health_history[health_history.length - 1]?.score ?? 72;
  const capacityFactor = lastScore / 100;              // 0–1 scalar
  const nowForForecast = new Date();
  const throughput_forecast = [];
  for (let w = 1; w <= 4; w++) {
    const weekMs = Date.now() + w * 7 * 86_400_000;
    const monday = new Date(weekMs);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const label  = monday.toISOString().slice(0, 10);
    const wk     = Math.round(weekMs / (7 * 86_400_000));
    const noise  = (seededCorr(wk) - 0.5) * 0.08;    // ±4%
    const base   = Math.round(WEEKLY_BASE_TONNES * capacityFactor * (1 + noise));
    throughput_forecast.push({
      week:         label,
      base_tonnes:         base,
      optimistic_tonnes:   Math.round(base * (1 + 0.08 + seededCorr(wk + 100) * 0.04)),
      conservative_tonnes: Math.round(base * (1 - 0.08 - seededCorr(wk + 200) * 0.04)),
      modelled: true,
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
    throughput_forecast,
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
