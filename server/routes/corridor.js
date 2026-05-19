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
const positionStore  = require('../state/positionStore');
const healthScorer   = require('../services/healthScorer');
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

  // LP-24 — 30-day corridor health score history.
  // Uses real computed scores where available; fills gaps with a seeded
  // deterministic fallback so the chart is never empty during early deployment.
  function seededScore(n) {
    const x = Math.sin(n * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  }
  const today = new Date();
  const BASE_SCORE = 72;

  // Build the 30-day date range.
  const dateRange = [];
  for (let d = 29; d >= 0; d--) {
    const date = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - d,
    ));
    dateRange.push(date.toISOString().slice(0, 10));
  }

  // Fetch real stored scores for the window.
  const fromDate = dateRange[0];
  const toDate   = dateRange[dateRange.length - 1];
  const realRows = healthScorer.getRange(fromDate, toDate);
  const realByDate = Object.fromEntries(realRows.map((r) => [r.date, r]));

  const health_history = dateRange.map((iso) => {
    if (realByDate[iso]) {
      const r = realByDate[iso];
      return {
        date:    r.date,
        score:   r.score,
        verdict: r.score >= 75 ? 'STRONG' : r.score >= 60 ? 'WATCH' : 'BELOW',
        real:    true,
      };
    }
    // Seeded fallback for dates not yet scored.
    const doy = Math.floor(
      (new Date(iso) - new Date(Date.UTC(new Date(iso).getUTCFullYear(), 0, 0))) / 86_400_000,
    );
    const score = Math.min(100, Math.max(42, Math.round(BASE_SCORE + seededScore(doy) * 22 - 11)));
    return {
      date:    iso,
      score,
      verdict: score >= 75 ? 'STRONG' : score >= 60 ? 'WATCH' : 'BELOW',
      real:    false,
    };
  });

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

  // Phase 191 — segment utilisation. For each segment, laden trucks are
  // heading south (loaded) and empty trucks are returning north. Utilisation
  // = laden / (laden + empty) gives a directional capacity read per segment.
  // Useful for identifying congestion pinch points on the Nyinahin–Takoradi run.
  const segment_util = SEGMENTS.map((seg) => {
    const total = (seg.laden ?? 0) + (seg.empty ?? 0);
    const util_pct = total > 0 ? Number(((seg.laden / total) * 100).toFixed(0)) : 0;
    return {
      id:         seg.id,
      from:       seg.from,
      to:         seg.to,
      laden:      seg.laden,
      empty:      seg.empty,
      total,
      util_pct,
    };
  });

  // Phase 215 — per-waypoint average dwell time (minutes). Depots are
  // origin/destination and not meaningful dwell points; all others receive a
  // seeded estimate anchored to realistic field ranges for each stop kind.
  function seededDwell(n) {
    const raw = Math.sin(n * 4127 + 43) * 71_009;
    return raw - Math.floor(raw);
  }
  const DWELL_RANGE = { weighbridge: [8, 22], junction: [3, 10], rest: [20, 48] };
  const waypoint_dwell = WAYPOINTS
    .filter((w) => DWELL_RANGE[w.kind])
    .map((w, i) => {
      const [lo, hi] = DWELL_RANGE[w.kind];
      const avg_min = Math.round(lo + seededDwell(i * 7 + 3) * (hi - lo));
      return { id: w.id, label: w.label, km: w.km, kind: w.kind, avg_min, modelled: true };
    });

  // LP-17 — real GPS positions from the FMS poller / webhook pipeline.
  // Returns an array of { vehicle_id, hauler_id, latitude, longitude,
  // speed_kmh, heading_deg, position_at } objects, one per known vehicle.
  // Empty until the FMS poller has run at least once or a position webhook
  // has been received.
  let vehicle_positions = [];
  try { vehicle_positions = positionStore.all(); } catch (_) {}

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
    vehicle_positions,
    health_history,
    throughput_forecast,
    segment_util,
    waypoint_dwell,
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

/* ── LP-41 — Corridor benchmark targets ──────────────────────────── */
//
// GET  /api/corridor/benchmarks       — list all benchmark rows
// PUT  /api/corridor/benchmarks/:key  — upsert a benchmark by key
//
// Uses the corridor_benchmarks table created in migration-008.
// Examples: cycle_time_max_h, on_time_rate_min, payload_util_min.

const db = require('../db');

let _bmStmts = null;
function bmStmts() {
  if (!_bmStmts) {
    _bmStmts = {
      list:   db.prepare('SELECT * FROM corridor_benchmarks ORDER BY key'),
      upsert: db.prepare(`
        INSERT INTO corridor_benchmarks (key, value, unit, label, updated_at)
        VALUES (@key, @value, @unit, @label, @updated_at)
        ON CONFLICT(key) DO UPDATE SET
          value      = excluded.value,
          unit       = excluded.unit,
          label      = excluded.label,
          updated_at = excluded.updated_at
      `),
      byKey:  db.prepare('SELECT * FROM corridor_benchmarks WHERE key = ?'),
      delete: db.prepare('DELETE FROM corridor_benchmarks WHERE key = ?'),
    };
  }
  return _bmStmts;
}

// Default benchmark seeds (written if table is empty on first read).
const DEFAULT_BENCHMARKS = [
  { key: 'cycle_time_max_h',  value: 26,   unit: 'h',   label: 'Max cycle time (laden + return)' },
  { key: 'on_time_rate_min',  value: 0.80, unit: 'ratio', label: 'Minimum on-time delivery rate' },
  { key: 'payload_util_min',  value: 0.85, unit: 'ratio', label: 'Minimum payload utilisation' },
  { key: 'speed_max_kmh',     value: 80,   unit: 'km/h', label: 'Maximum permitted speed' },
  { key: 'idle_max_min',      value: 30,   unit: 'min',  label: 'Maximum engine idle time' },
];

function seedBenchmarks() {
  try {
    const stmts = bmStmts();
    const existing = stmts.list.all();
    if (existing.length === 0) {
      const now = new Date().toISOString();
      for (const b of DEFAULT_BENCHMARKS) {
        stmts.upsert.run({ ...b, updated_at: now });
      }
    }
  } catch (_) {}
}
setImmediate(seedBenchmarks);

router.get('/benchmarks', (req, res) => {
  try {
    const rows = bmStmts().list.all();
    res.json({ benchmarks: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Benchmarks table not available — run migrations' });
  }
});

router.put(
  '/benchmarks/:key',
  requireRole('axis_admin', 'axis_ops'),
  (req, res) => {
    const { key } = req.params;
    const { value, unit, label } = req.body ?? {};
    if (value == null) return res.status(400).json({ error: 'value (number) is required' });
    if (!Number.isFinite(Number(value))) return res.status(400).json({ error: 'value must be a finite number' });

    bmStmts().upsert.run({
      key,
      value:      Number(value),
      unit:       unit   ?? null,
      label:      label  ?? null,
      updated_at: new Date().toISOString(),
    });
    writeAudit({
      req,
      entity_type: 'corridor_benchmark',
      entity_id:   key,
      action:      'upsert',
      summary:     `Benchmark "${key}" set to ${value}${unit ? ' ' + unit : ''}`,
      payload:     { key, value, unit, label },
    });
    const row = bmStmts().byKey.get(key);
    res.json({ benchmark: row });
  },
);

router.delete(
  '/benchmarks/:key',
  requireRole('axis_admin'),
  (req, res) => {
    const { key } = req.params;
    const existing = bmStmts().byKey.get(key);
    if (!existing) return res.status(404).json({ error: 'Benchmark not found' });
    bmStmts().delete.run(key);
    writeAudit({
      req, entity_type: 'corridor_benchmark', entity_id: key,
      action: 'delete', summary: `Deleted benchmark "${key}"`,
    });
    res.json({ deleted: true });
  },
);

/* ── LP-49 — Corridor segment utilization ────────────────────────── */
//
// GET /api/corridor/utilization
//
// Maps live vehicle positions to the nearest corridor segment and
// counts vehicles per segment. Returns segment-level occupancy
// with the percentage of total active fleet for each segment.

router.get('/utilization', (_req, res) => {
  const positions = positionStore.all();
  const activePos = positions.filter((p) => {
    if (!p.position_at) return false;
    const ageMs = Date.now() - new Date(p.position_at).getTime();
    return ageMs < 3 * 3_600_000; // only positions updated in last 3h
  });

  // Corridor segments with km markers (Nyinahin = 0, Takoradi = 300).
  // Approximate lat/lon range per segment for a simple assignment.
  const segmentMap = {};
  for (const seg of SEGMENTS) {
    segmentMap[seg.id] = { ...seg, vehicle_count: 0, vehicles: [] };
  }

  // Assign each active position to the closest segment by latitude proxy.
  // Nyinahin lat ≈ 6.83 (km 0) → Takoradi lat ≈ 4.89 (km 300).
  const LAT_NORTH = 6.83;
  const LAT_SOUTH = 4.89;
  const LAT_RANGE = LAT_NORTH - LAT_SOUTH;

  for (const pos of activePos) {
    if (pos.latitude == null) continue;
    const fraction = Math.max(0, Math.min(1, (LAT_NORTH - pos.latitude) / LAT_RANGE));
    const kmApprox = Math.round(fraction * 300);

    // Find segment that contains this km marker.
    const seg = SEGMENTS.find(
      (s) => kmApprox >= (s.km_from ?? 0) && kmApprox < (s.km_to ?? 300),
    ) ?? SEGMENTS[SEGMENTS.length - 1];

    if (seg && segmentMap[seg.id]) {
      segmentMap[seg.id].vehicle_count++;
      segmentMap[seg.id].vehicles.push({
        vehicle_id: pos.vehicle_id,
        hauler_id:  pos.hauler_id,
        speed_kmh:  pos.speed_kmh,
        position_at: pos.position_at,
      });
    }
  }

  const total = activePos.length || 1;
  const segments = Object.values(segmentMap).map((seg) => ({
    id:            seg.id,
    name:          seg.name,
    km_from:       seg.km_from,
    km_to:         seg.km_to,
    vehicle_count: seg.vehicle_count,
    utilization_pct: Number(((seg.vehicle_count / total) * 100).toFixed(1)),
    vehicles:      seg.vehicles,
  }));

  res.json({
    generated_at:   new Date().toISOString(),
    total_active:   activePos.length,
    segments,
  });
});

module.exports = router;
