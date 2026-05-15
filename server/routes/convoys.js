'use strict';

/*
 * Convoys — Phase 101 extends with dispatch write path.
 *
 *   GET  /api/convoys          — active convoy list + posture summary
 *   POST /api/convoys          — dispatch a new convoy (axis_admin / axis_ops)
 *   POST /api/convoys/:id/depart  — record actual departure
 *   POST /api/convoys/:id/phase   — update phase (loading → laden → offload)
 *   POST /api/convoys/:id/arrive  — record arrival / complete
 *   GET  /api/convoys/:id      — convoy detail (mock + live)
 *
 * The GET / list merges live dispatched convoys (is_live: true, shown
 * first) with the mock ACTIVE_CONVOYS baseline so the page is never
 * empty during demos. Live convoy IDs are 'live-{dbId}'.
 *
 * When a convoy is dispatched, the hauler_admin for that hauler receives
 * a 'convoy_dispatch' notification.
 */

const express = require('express');
const router = express.Router();

const roster = require('../state/roster');
const convoyState = require('../state/convoyState');
const notifications = require('../state/notifications');
const { findById: findUser, list: listUsers } = require('../state/users');
const { ACTIVE_CONVOYS, WAYPOINTS } = require('../mock/corridor');
const { FLEET } = require('../mock/fleet');
const { DRIVERS } = require('../mock/drivers');
const { ALERTS } = require('../mock/alerts');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../db/audit');

const DISPATCH_ROLES = ['axis_admin', 'axis_ops'];
const STATUS_ROLES   = ['axis_admin', 'axis_ops', 'hauler_admin'];

// ── Helpers ────────────────────────────────────────────────────────

// Phase 140 — ETA computation for active convoys. Laden transit is
// ~16 h over 300 km; loading waiting time adds ~4 h before departure;
// offload is 2 h at port. Northbound (empty) runs are excluded — no
// delivery ETA is relevant for the return leg.
const ETA_LADEN_H   = 16;   // Nyinahin → Takoradi transit
const ETA_LOADING_H = 20;   // waiting + transit from planned departure
const ETA_OFFLOAD_H = 2;    // remaining time to clear offload

function computeETA(c) {
  if (c.direction !== 'southbound') return { eta_iso: null, eta_minutes_remaining: null, eta_status: null };
  const nowMs = Date.now();
  let etaMs = null;

  if (c.phase === 'laden' && c.actual_departure_iso) {
    etaMs = new Date(c.actual_departure_iso).getTime() + ETA_LADEN_H * 3_600_000;
  } else if (c.phase === 'loading') {
    const ref = c.planned_departure_iso ?? c.dispatched_at;
    if (ref) etaMs = new Date(ref).getTime() + ETA_LOADING_H * 3_600_000;
  } else if (c.phase === 'offload' && c.actual_departure_iso) {
    etaMs = new Date(c.actual_departure_iso).getTime() + (ETA_LADEN_H + ETA_OFFLOAD_H) * 3_600_000;
  }

  if (!etaMs) return { eta_iso: null, eta_minutes_remaining: null, eta_status: null };
  const minutesRemaining = Math.round((etaMs - nowMs) / 60_000);
  const eta_status = minutesRemaining < 0
    ? 'overdue'
    : minutesRemaining < 120 ? 'imminent' : 'en_route';
  return {
    eta_iso:              new Date(etaMs).toISOString(),
    eta_minutes_remaining: minutesRemaining,
    eta_status,
  };
}

function enrichConvoy(c, haulersById) {
  return {
    ...c,
    hauler_display_name: haulersById[c.hauler_id] ?? c.hauler_id,
    ...computeETA(c),
  };
}

function buildSummary(convoys) {
  const withCycle = convoys.filter((c) => c.cycle_h != null);
  const avgCycle  = withCycle.length
    ? withCycle.reduce((s, c) => s + c.cycle_h, 0) / withCycle.length
    : null;
  const phaseTrucks = convoys.reduce((acc, c) => {
    acc[c.phase] = (acc[c.phase] || 0) + c.trucks;
    return acc;
  }, {});
  // Phase 126 — convoy-count breakdown by phase for the UI summary strip.
  const phaseConvoys = convoys.reduce((acc, c) => {
    acc[c.phase] = (acc[c.phase] || 0) + 1;
    return acc;
  }, {});
  return {
    active_convoys:  convoys.length,
    trucks_moving:   convoys.reduce((s, c) => s + c.trucks, 0),
    avg_cycle_h:     avgCycle != null ? Number(avgCycle.toFixed(1)) : null,
    on_schedule:     convoys.filter((c) => c.on_schedule).length,
    delayed:         convoys.filter((c) => !c.on_schedule).length,
    live_dispatched: convoys.filter((c) => c.is_live).length,
    phase_counts:    phaseTrucks,   // trucks-by-phase (existing)
    convoy_by_phase: phaseConvoys,  // convoys-by-phase (new)
  };
}

// Notify the hauler_admin for the given hauler_id when a convoy is dispatched.
function notifyHaulerDispatch(convoy, senderUser) {
  try {
    const users = listUsers();
    const haulerAdmin = users.find(
      (u) => u.role === 'hauler_admin' && u.hauler_id === convoy.hauler_id,
    );
    if (!haulerAdmin) return;
    notifications.emit({
      user_id:       haulerAdmin.id,
      event_type:    'convoy_dispatch',
      body:          `Convoy ${convoy.convoy_ref} dispatched for your hauler — ${convoy.trucks} truck${convoy.trucks === 1 ? '' : 's'}, ${convoy.direction}.`,
      link:          { path: '/convoys', label: 'View convoys' },
      actor_user_id: senderUser.id,
      actor_display: senderUser.display_name,
    });
  } catch { /* non-fatal */ }
}

// ── List ───────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const haulersById = Object.fromEntries(
    roster.list().map((h) => [h.id, h.display_name]),
  );

  // Role gate: hauler_admin sees only their hauler's convoys.
  const haulerFilter = req.user?.role === 'hauler_admin'
    ? req.user.hauler_id
    : (req.query.hauler_id || null);

  // Live dispatched convoys (shown first, most recent first).
  const liveAll = convoyState.listActive();
  const live = haulerFilter
    ? liveAll.filter((c) => c.hauler_id === haulerFilter)
    : liveAll;
  const liveEnriched = live.map((c) => enrichConvoy(c, haulersById));

  // Mock baseline — omit mock convoys that belong to a filtered hauler
  // when we have live entries for that hauler (avoids double-counting).
  const liveHaulerIds = new Set(live.map((c) => c.hauler_id));
  let mockFiltered = haulerFilter
    ? ACTIVE_CONVOYS.filter((c) => c.hauler_id === haulerFilter)
    : ACTIVE_CONVOYS;
  // If there are live dispatches at all, suppress mock convoys for those
  // haulers so the board isn't a mix of real + stale demo data.
  if (liveAll.length > 0) {
    mockFiltered = mockFiltered.filter((c) => !liveHaulerIds.has(c.hauler_id));
  }
  const mockEnriched = mockFiltered.map((c) => enrichConvoy(c, haulersById));

  const allConvoys = [...liveEnriched, ...mockEnriched];

  // Phase 171 — per-hauler cycle time metrics. Groups convoys by hauler_id
  // and aggregates the cycle_h field (total round-trip hours). Convoys without
  // a cycle_h are excluded from the average but counted in the total.
  const cycleByHauler = {};
  allConvoys.forEach((c) => {
    if (!cycleByHauler[c.hauler_id]) {
      cycleByHauler[c.hauler_id] = {
        hauler_id:     c.hauler_id,
        hauler_display: c.hauler_display_name ?? c.hauler_id,
        total_convoys: 0,
        on_schedule:   0,
        cycle_vals:    [],
      };
    }
    const h = cycleByHauler[c.hauler_id];
    h.total_convoys++;
    if (c.on_schedule) h.on_schedule++;
    if (c.cycle_h != null) h.cycle_vals.push(c.cycle_h);
  });
  const hauler_cycle_metrics = Object.values(cycleByHauler)
    .map((h) => ({
      hauler_id:      h.hauler_id,
      hauler_display: h.hauler_display,
      total_convoys:  h.total_convoys,
      on_schedule:    h.on_schedule,
      on_schedule_pct: h.total_convoys > 0
        ? Number(((h.on_schedule / h.total_convoys) * 100).toFixed(0))
        : null,
      avg_cycle_h: h.cycle_vals.length > 0
        ? Number((h.cycle_vals.reduce((s, v) => s + v, 0) / h.cycle_vals.length).toFixed(1))
        : null,
      min_cycle_h: h.cycle_vals.length > 0 ? Math.min(...h.cycle_vals) : null,
      max_cycle_h: h.cycle_vals.length > 0 ? Math.max(...h.cycle_vals) : null,
    }))
    .sort((a, b) => (a.avg_cycle_h ?? 999) - (b.avg_cycle_h ?? 999));

  res.json({
    summary: buildSummary(allConvoys),
    convoys:  allConvoys,
    hauler_cycle_metrics,
  });
});

// ── Dispatch (create) ──────────────────────────────────────────────

router.post('/', requireRole(...DISPATCH_ROLES), (req, res) => {
  const { hauler_id, truck_count, cargo_tonnes, direction, notes,
          planned_departure_iso } = req.body || {};
  try {
    const hauler = roster.find(hauler_id);
    if (!hauler) return res.status(400).json({ error: 'Hauler not found' });

    const convoy = convoyState.dispatch({
      hauler_id,
      truck_count,
      cargo_tonnes: cargo_tonnes || null,
      direction:    direction || 'southbound',
      notes:        notes || null,
      planned_departure_iso: planned_departure_iso || null,
      dispatched_by_id:   req.user.id,
      dispatched_by_name: req.user.display_name,
    });

    writeAudit({
      req,
      entity_type: 'convoy',
      entity_id:   convoy.convoy_ref,
      action:      'dispatch',
      summary:     `${convoy.convoy_ref} dispatched — ${convoy.trucks} trucks, ${convoy.direction} (${hauler.display_name})`,
    });

    notifyHaulerDispatch(convoy, req.user);

    res.status(201).json({ convoy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Status updates ─────────────────────────────────────────────────

function resolveDbId(paramId, res) {
  if (paramId.startsWith('live-')) {
    const n = parseInt(paramId.slice(5), 10);
    if (!Number.isFinite(n)) { res.status(400).json({ error: 'Invalid convoy id' }); return null; }
    return n;
  }
  res.status(400).json({ error: 'Status updates only apply to live-dispatched convoys (live-{id})' });
  return null;
}

router.post('/:id/depart', requireRole(...STATUS_ROLES), (req, res) => {
  const dbId = resolveDbId(req.params.id, res);
  if (dbId === null) return;

  // Hauler_admin scope: can only update their own hauler's convoys.
  if (req.user.role === 'hauler_admin') {
    const existing = convoyState.findById(dbId);
    if (!existing) return res.status(404).json({ error: 'Convoy not found' });
    if (existing.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'Not your convoy' });
    }
  }

  const convoy = convoyState.depart(dbId);
  if (!convoy) return res.status(404).json({ error: 'Convoy not found or already departed' });

  writeAudit({
    req,
    entity_type: 'convoy',
    entity_id:   convoy.convoy_ref,
    action:      'depart',
    summary:     `${convoy.convoy_ref} departed`,
  });
  res.json({ convoy });
});

router.post('/:id/phase', requireRole(...STATUS_ROLES), (req, res) => {
  const dbId = resolveDbId(req.params.id, res);
  if (dbId === null) return;
  const { phase } = req.body || {};
  try {
    const convoy = convoyState.updatePhase(dbId, phase);
    if (!convoy) return res.status(404).json({ error: 'Convoy not found' });
    writeAudit({
      req,
      entity_type: 'convoy',
      entity_id:   convoy.convoy_ref,
      action:      'phase_update',
      summary:     `${convoy.convoy_ref} → ${phase}`,
    });
    res.json({ convoy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/arrive', requireRole(...STATUS_ROLES), (req, res) => {
  const dbId = resolveDbId(req.params.id, res);
  if (dbId === null) return;

  if (req.user.role === 'hauler_admin') {
    const existing = convoyState.findById(dbId);
    if (!existing) return res.status(404).json({ error: 'Convoy not found' });
    if (existing.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'Not your convoy' });
    }
  }

  // Phase 113 — accept optional delivered_tonnes at arrival.
  const { delivered_tonnes } = req.body || {};
  let dt = null;
  if (delivered_tonnes !== undefined && delivered_tonnes !== null) {
    dt = parseFloat(delivered_tonnes);
    if (Number.isNaN(dt) || dt < 0) {
      return res.status(400).json({ error: 'delivered_tonnes must be a non-negative number' });
    }
  }

  const convoy = convoyState.arrive(dbId, { delivered_tonnes: dt });
  if (!convoy) return res.status(404).json({ error: 'Convoy not found or already arrived' });

  const dtStr = convoy.delivered_tonnes != null ? ` · ${convoy.delivered_tonnes} t delivered` : '';
  writeAudit({
    req,
    entity_type: 'convoy',
    entity_id:   convoy.convoy_ref,
    action:      'arrive',
    summary:     `${convoy.convoy_ref} arrived${dtStr}`,
  });
  res.json({ convoy });
});

// ── Detail ─────────────────────────────────────────────────────────

router.get('/:id', requireAuth, (req, res) => {
  const paramId = req.params.id;

  // Live convoy detail.
  if (paramId.startsWith('live-')) {
    const dbId = parseInt(paramId.slice(5), 10);
    if (!Number.isFinite(dbId)) return res.status(400).json({ error: 'Invalid id' });
    const convoy = convoyState.findById(dbId);
    if (!convoy) return res.status(404).json({ error: 'Convoy not found' });

    const haulerDisplay = roster.list().find((h) => h.id === convoy.hauler_id)?.display_name
                       ?? convoy.hauler_id;
    const haulerRigs    = FLEET.filter((t) => t.hauler_id === convoy.hauler_id);
    const assignedTrucks = haulerRigs.slice(0, convoy.trucks).map((t) => ({
      rig_id: t.id, plate: t.plate, make: t.make, model: t.model, status: t.status,
    }));
    const haulerDrivers = DRIVERS.filter((d) => d.hauler_id === convoy.hauler_id);
    const leadDriverRec = haulerDrivers.find((d) => d.assigned_rig_id === assignedTrucks[0]?.rig_id)
                       ?? haulerDrivers[0];
    const leadDriver = leadDriverRec ? {
      id: leadDriverRec.id, display_name: leadDriverRec.full_name,
      phone: leadDriverRec.phone, licence_class: leadDriverRec.licence_class,
      safety_score: leadDriverRec.safety_score, rest_status: leadDriverRec.rest_status,
    } : null;

    // Phase 122 — construct a real phase timeline from the convoy's timestamps.
    const liveTimeline = buildLiveTimeline(convoy);

    // Payload variance: delivered vs estimated (only meaningful at completion).
    const payloadVariance = (convoy.phase === 'complete' &&
                             convoy.delivered_tonnes != null &&
                             convoy.cargo_tonnes != null)
      ? Math.round((convoy.delivered_tonnes - convoy.cargo_tonnes) * 10) / 10
      : null;

    // Progress estimate from phase for live convoys.
    const liveProgress = (() => {
      const TKM = 300;
      const km = convoy.phase === 'complete'  ? TKM
               : convoy.phase === 'offload'   ? TKM
               : convoy.phase === 'laden'     ? Math.round(TKM * 0.5)
               : 0;
      return { total_km: TKM, covered_km: km, remaining_km: TKM - km, percent: Math.round((km / TKM) * 100) };
    })();

    return res.json({
      ...convoy,
      hauler_display_name: haulerDisplay,
      assigned_trucks:     assignedTrucks,
      lead_driver:         leadDriver,
      timeline:            liveTimeline,
      related_alerts:      [],
      progress:            liveProgress,
      payload_variance_t:  payloadVariance,
    });
  }

  // Mock convoy detail (existing behaviour).
  const convoy = ACTIVE_CONVOYS.find((c) => c.id === paramId);
  if (!convoy) return res.status(404).json({ error: 'Convoy not found' });

  const haulerDisplay = roster.list().find((h) => h.id === convoy.hauler_id)?.display_name
                     ?? convoy.hauler_id;
  const haulerRigs = FLEET.filter((t) => t.hauler_id === convoy.hauler_id);
  const assignedTrucks = haulerRigs.slice(0, convoy.trucks).map((t) => ({
    rig_id: t.id, plate: t.plate, make: t.make, model: t.model, status: t.status,
  }));
  const haulerDrivers = DRIVERS.filter((d) => d.hauler_id === convoy.hauler_id);
  const leadDriverRec = haulerDrivers.find((d) => d.assigned_rig_id === assignedTrucks[0]?.rig_id)
                    ?? haulerDrivers.find((d) => d.assigned_rig_id)
                    ?? haulerDrivers[0];
  const leadDriver = leadDriverRec ? {
    id: leadDriverRec.id, display_name: leadDriverRec.full_name,
    phone: leadDriverRec.phone, licence_class: leadDriverRec.licence_class,
    safety_score: leadDriverRec.safety_score, rest_status: leadDriverRec.rest_status,
  } : null;

  const timeline = buildTimeline(convoy);
  const related = ALERTS
    .filter((a) => (
      a.asset_ref === convoy.id ||
      (a.hauler_id === convoy.hauler_id && a.status !== 'RESOLVED')
    ))
    .map((a) => ({
      id: a.id, severity: a.severity, type: a.type,
      title: a.title, status: a.status, opened_at: a.opened_at,
    }));

  res.json({
    ...convoy,
    hauler_display_name: haulerDisplay,
    assigned_trucks:     assignedTrucks,
    lead_driver:         leadDriver,
    timeline,
    related_alerts:      related,
    progress:            progressFor(convoy),
  });
});

// ── Phase 122 — live convoy phase timeline ─────────────────────────
// Builds a timeline from real ISO timestamps recorded by operators.
// Format mirrors the mock timeline entries so ConvoyDetail renders them
// without any client-side changes.

function buildLiveTimeline(convoy) {
  const entries = [];

  // Dispatched
  entries.push({
    type:      'LOADING_START',
    label:     'Convoy dispatched · Loading',
    timestamp: convoy.dispatched_at,
    note:      `Dispatched by ${convoy.dispatched_by_name}. ${convoy.trucks} truck${convoy.trucks === 1 ? '' : 's'}.${convoy.cargo_tonnes != null ? ` Planned cargo: ${convoy.cargo_tonnes} t.` : ''}`,
  });

  // Planned departure (if set and not yet departed)
  if (convoy.planned_departure_iso && !convoy.actual_departure_iso) {
    const planned = new Date(convoy.planned_departure_iso);
    const now     = new Date();
    const late    = now > planned;
    entries.push({
      type:      'PLANNED_DEPART',
      label:     late ? 'Planned departure (overdue)' : 'Planned departure',
      timestamp: convoy.planned_departure_iso,
      note:      late ? `Convoy is ${Math.round((now - planned) / 60_000)} min past planned departure.` : 'Departure window open.',
      pending:   true,
    });
  }

  // Departed
  if (convoy.actual_departure_iso) {
    const delay = convoy.planned_departure_iso
      ? Math.round((new Date(convoy.actual_departure_iso) - new Date(convoy.planned_departure_iso)) / 60_000)
      : null;
    const delayNote = delay != null
      ? (delay > 0 ? ` ${delay} min late.` : delay < 0 ? ` ${Math.abs(delay)} min early.` : ' On schedule.')
      : '';
    entries.push({
      type:      'DEPART',
      label:     'Departed Nyinahin · En route',
      timestamp: convoy.actual_departure_iso,
      note:      `Convoy departed.${delayNote}`,
    });
  }

  // Arrived / complete
  if (convoy.arrived_at_iso) {
    const travelMs  = convoy.actual_departure_iso
      ? new Date(convoy.arrived_at_iso) - new Date(convoy.actual_departure_iso)
      : null;
    const travelStr = travelMs != null
      ? ` Transit: ${Math.round(travelMs / 3_600_000 * 10) / 10} h.`
      : '';
    const delivStr = convoy.delivered_tonnes != null
      ? ` Delivered ${convoy.delivered_tonnes} t (planned ${convoy.cargo_tonnes ?? '—'} t).`
      : '';
    const variance = convoy.delivered_tonnes != null && convoy.cargo_tonnes != null
      ? convoy.delivered_tonnes - convoy.cargo_tonnes
      : null;
    const varStr = variance != null && variance !== 0
      ? ` Variance: ${variance > 0 ? '+' : ''}${Math.round(variance * 10) / 10} t.`
      : '';
    entries.push({
      type:      'ARRIVE',
      label:     'Arrived Takoradi · Complete',
      timestamp: convoy.arrived_at_iso,
      note:      `${travelStr}${delivStr}${varStr}`.trim() || 'Arrival recorded.',
    });
  }

  return entries;
}

// ── Timeline + progress helpers ────────────────────────────────────

function progressFor(convoy) {
  if (convoy.direction === 'northbound') {
    return {
      total_km:     300,
      covered_km:   300 - convoy.km,
      remaining_km: convoy.km,
      percent:      Math.max(0, Math.min(100, Math.round(((300 - convoy.km) / 300) * 100))),
    };
  }
  return {
    total_km:     300,
    covered_km:   convoy.km,
    remaining_km: 300 - convoy.km,
    percent:      Math.max(0, Math.min(100, Math.round((convoy.km / 300) * 100))),
  };
}

function buildTimeline(convoy) {
  const passed = WAYPOINTS.filter((w) => (
    convoy.direction === 'northbound'
      ? w.km >= convoy.km
      : w.km <= convoy.km
  ));
  const ordered = convoy.direction === 'northbound'
    ? [...passed].sort((a, b) => b.km - a.km)
    : [...passed].sort((a, b) => a.km - b.km);

  const depart   = new Date(convoy.actual_departure_iso ?? convoy.planned_departure_iso).getTime();
  const lastPing = new Date(convoy.last_ping_iso).getTime();
  const totalCoveredKm = convoy.direction === 'northbound' ? 300 - convoy.km : convoy.km;
  const msPerKm = totalCoveredKm > 0 ? (lastPing - depart) / totalCoveredKm : 0;

  const passes = ordered.map((w) => {
    const coveredToHere = convoy.direction === 'northbound' ? 300 - w.km : w.km;
    const ts = new Date(depart + coveredToHere * msPerKm).toISOString();
    return { type: w.kind, label: w.label, km: w.km, iso: ts, waypoint: w.id, status: 'passed' };
  });

  const onWaypoint = ordered.some((w) => w.km === convoy.km);
  if (!onWaypoint && convoy.phase !== 'loading' && convoy.phase !== 'offload') {
    passes.push({
      type: 'ping', label: `Last ping · km ${convoy.km}`,
      km: convoy.km, iso: convoy.last_ping_iso, status: 'current',
    });
  }
  return passes;
}

module.exports = router;
