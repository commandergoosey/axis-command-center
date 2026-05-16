'use strict';

/*
 * GET   /api/fleet            — full truck roster (filterable by hauler_id)
 * GET   /api/fleet/summary    — counts + averages for the summary strip
 * PATCH /api/fleet/:rigId/status — set truck status + maintenance flag (Phase 102)
 *
 * Hauler admins are auto-scoped to their own hauler_id by the handler.
 * The status override is an SQLite upsert; GET endpoints merge the
 * override layer on top of the mock fleet on every read.
 *
 * Phase 102 — status write path.
 */

const express = require('express');
const router = express.Router();

const { FLEET }   = require('../mock/fleet');
const { DRIVERS } = require('../mock/drivers');
const { TRIPS }   = require('../mock/trips');
const fleetStatus    = require('../state/fleetStatus');
const rigAssignments = require('../state/rigAssignments');
const fuelLogs       = require('../state/fuelLogs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../db/audit');

const STATUS_WRITE_ROLES  = ['axis_admin', 'axis_ops', 'hauler_admin'];
const ASSIGN_WRITE_ROLES  = ['axis_admin', 'axis_ops', 'hauler_admin'];

// ── Helpers ────────────────────────────────────────────────────────

function scopedFleet(req) {
  const user = req.user;
  if (user?.role === 'hauler_admin' && user.hauler_id) {
    return FLEET.filter((t) => t.hauler_id === user.hauler_id);
  }
  const filter = req.query.hauler_id;
  if (typeof filter === 'string' && filter) return FLEET.filter((t) => t.hauler_id === filter);
  return FLEET;
}

/** Merge the status-override layer onto a list of mock truck records. */
function withOverrides(trucks) {
  const overrides = fleetStatus.getAllOverrides();
  if (overrides.size === 0) return trucks;
  return trucks.map((t) => fleetStatus.applyOverride(t, overrides.get(t.id)));
}

// ── Routes ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = withOverrides(scopedFleet(req));

  // Phase 157 — per-hauler fleet availability breakdown.
  // Groups each truck by hauler and counts active/garage/idle/flagged
  // so the Fleet page can show utilisation at a glance without the
  // operator having to count rows in the table.
  const byHauler = {};
  rows.forEach((t) => {
    if (!byHauler[t.hauler_id]) {
      byHauler[t.hauler_id] = {
        hauler_id:    t.hauler_id,
        display_name: t.hauler_display ?? t.hauler_id,
        total:   0,
        active:  0,
        garage:  0,
        idle:    0,
        flagged: 0,
      };
    }
    const b = byHauler[t.hauler_id];
    b.total++;
    if (t.status === 'active' || t.status === 'in_transit') b.active++;
    else if (t.status === 'garage') b.garage++;
    else b.idle++;
    if (t.maintenance_flag) b.flagged++;
  });
  const availability_by_hauler = Object.values(byHauler)
    .sort((a, b) => b.total - a.total);

  // Phase 164 — maintenance forecast: trucks within 5,000 km of their
  // next scheduled service (or already overdue). At the corridor's
  // approximate daily run rate (~150 km/day) this gives roughly a
  // 33-day look-ahead — enough for ops to pre-book workshop slots.
  const SERVICE_LOOKAHEAD_KM = 5_000;
  const AVG_KM_PER_DAY       = 150;
  const maintenance_forecast = rows
    .filter((t) => t.status !== 'garage')
    .map((t) => {
      const kmToService   = (t.next_service_km_due ?? 0) - (t.total_km ?? 0);
      const daysToService = Math.round(kmToService / AVG_KM_PER_DAY);
      return {
        rig_id:           t.id,
        plate:            t.plate,
        hauler_id:        t.hauler_id,
        hauler_display:   t.hauler_display,
        total_km:         t.total_km,
        km_to_service:    kmToService,
        days_to_service:  daysToService,
        maintenance_flag: t.maintenance_flag,
        overdue:          kmToService < 0,
      };
    })
    .filter((t) => t.km_to_service <= SERVICE_LOOKAHEAD_KM)
    .sort((a, b) => a.km_to_service - b.km_to_service);

  // Phase 199 — payload efficiency: actual vs rated capacity per hauler.
  // Pairs each hauler's fleet average payload_capacity_t with the mean
  // tonnage_t across their southbound trips, giving an utilisation %.
  const tripPayloadByHauler = {};
  TRIPS
    .filter((t) => t.direction === 'southbound' && (t.tonnage_t ?? 0) > 0)
    .forEach((t) => {
      if (!tripPayloadByHauler[t.hauler_id]) tripPayloadByHauler[t.hauler_id] = { sum: 0, count: 0 };
      tripPayloadByHauler[t.hauler_id].sum   += t.tonnage_t;
      tripPayloadByHauler[t.hauler_id].count += 1;
    });
  const capacityByHauler = {};
  rows.forEach((t) => {
    if (!capacityByHauler[t.hauler_id]) {
      capacityByHauler[t.hauler_id] = {
        hauler_id:      t.hauler_id,
        hauler_display: t.hauler_display ?? t.hauler_id,
        sum: 0, count: 0,
      };
    }
    capacityByHauler[t.hauler_id].sum   += t.payload_capacity_t ?? 40;
    capacityByHauler[t.hauler_id].count += 1;
  });
  const payload_efficiency = Object.values(capacityByHauler).map((h) => {
    const avg_capacity_t = h.count > 0 ? Number((h.sum / h.count).toFixed(1)) : 40;
    const trips = tripPayloadByHauler[h.hauler_id];
    const avg_payload_t = trips && trips.count > 0
      ? Number((trips.sum / trips.count).toFixed(1)) : null;
    const efficiency_pct = avg_payload_t != null && avg_capacity_t > 0
      ? Math.round((avg_payload_t / avg_capacity_t) * 100) : null;
    return {
      hauler_id:      h.hauler_id,
      hauler_display: h.hauler_display,
      avg_capacity_t,
      avg_payload_t,
      efficiency_pct,
      trip_count: trips?.count ?? 0,
    };
  })
    .filter((h) => h.efficiency_pct != null)
    .sort((a, b) => (b.efficiency_pct ?? 0) - (a.efficiency_pct ?? 0));

  res.json({
    generated_at: new Date().toISOString(),
    total:  rows.length,
    trucks: rows,
    availability_by_hauler,
    maintenance_forecast,
    payload_efficiency,
  });
});

router.get('/summary', (req, res) => {
  const rows = withOverrides(scopedFleet(req));
  const active   = rows.filter((t) => t.status === 'active' || t.status === 'in_transit').length;
  const garage   = rows.filter((t) => t.status === 'garage').length;
  const idle     = rows.filter((t) => t.status === 'idle').length;
  const flagged  = rows.filter((t) => t.maintenance_flag).length;
  const avgEff   = rows.length
    ? Math.round((rows.reduce((s, t) => s + t.efficiency_l_per_100km, 0) / rows.length) * 10) / 10
    : 0;
  res.json({
    generated_at:        new Date().toISOString(),
    total:               rows.length,
    active_today:        active,
    in_garage:           garage,
    idle_yard:           idle,
    maintenance_flagged: flagged,
    avg_efficiency_l_per_100km: avgEff,
  });
});

// ── Phase 111 — operational fuel log ──────────────────────────────
//
// POST /api/fleet/:rigId/fuel   — record a fill event
// GET  /api/fleet/:rigId/fuel   — get recent fills (default: last 10)
//
// Role gate: axis_admin / axis_ops / hauler_admin (own fleet only).
// litres is required; cost_ghs, odometer_km, notes are optional.

router.post(
  '/:rigId/fuel',
  requireRole(...STATUS_WRITE_ROLES),
  (req, res) => {
    const { rigId } = req.params;

    const truck = FLEET.find((t) => t.id === rigId);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    if (req.user.role === 'hauler_admin' && truck.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'You can only log fuel for your own hauler\'s trucks' });
    }

    const { litres, cost_ghs, odometer_km, notes } = req.body || {};

    const litresNum = parseFloat(litres);
    if (!litres || Number.isNaN(litresNum) || litresNum <= 0) {
      return res.status(400).json({ error: 'litres must be a positive number' });
    }

    if (cost_ghs !== undefined && cost_ghs !== null) {
      const c = parseFloat(cost_ghs);
      if (Number.isNaN(c) || c < 0) {
        return res.status(400).json({ error: 'cost_ghs must be a non-negative number' });
      }
    }

    if (odometer_km !== undefined && odometer_km !== null) {
      const o = parseFloat(odometer_km);
      if (Number.isNaN(o) || o < 0) {
        return res.status(400).json({ error: 'odometer_km must be a non-negative number' });
      }
    }

    const entry = fuelLogs.add({
      rig_id:         rigId,
      hauler_id:      truck.hauler_id,
      litres:         litresNum,
      cost_ghs:       cost_ghs   != null ? parseFloat(cost_ghs)   : null,
      odometer_km:    odometer_km != null ? parseFloat(odometer_km) : null,
      notes:          typeof notes === 'string' ? notes.trim() || null : null,
      logged_by_id:   req.user.id,
      logged_by_name: req.user.display_name,
    });

    writeAudit({
      req,
      entity_type: 'fleet_truck',
      entity_id:   rigId,
      action:      'fuel_logged',
      summary:     `${rigId} (${truck.plate}) — ${litresNum.toFixed(1)} L${cost_ghs != null ? ` · GHS ${parseFloat(cost_ghs).toFixed(2)}` : ''}`,
    });

    res.status(201).json({ entry });
  },
);

router.get(
  '/:rigId/fuel',
  (req, res) => {
    const { rigId } = req.params;

    const truck = FLEET.find((t) => t.id === rigId);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    if (req.user?.role === 'hauler_admin' && truck.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'You can only view fuel logs for your own hauler\'s trucks' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const logs = fuelLogs.getByRig(rigId, limit);

    // Summarise: total litres, fill count, cost, last odometer.
    const totalLitres   = logs.reduce((s, l) => s + l.litres, 0);
    const totalCostGhs  = logs.reduce((s, l) => s + (l.cost_ghs ?? 0), 0);
    const lastOdometer  = logs.find((l) => l.odometer_km != null)?.odometer_km ?? null;

    res.json({
      rig_id:      rigId,
      plate:       truck.plate,
      logs,
      summary: {
        fill_count:       logs.length,
        total_litres:     Math.round(totalLitres * 10) / 10,
        total_cost_ghs:   totalCostGhs > 0 ? Math.round(totalCostGhs * 100) / 100 : null,
        last_odometer_km: lastOdometer,
      },
    });
  },
);

// ── Phase 110 — live driver assignment ────────────────────────────
//
// POST   /api/fleet/:rigId/assign   — assign a driver to a rig (upserts)
// DELETE /api/fleet/:rigId/assign   — remove the live assignment
//
// Role gate: axis_admin / axis_ops / hauler_admin (own fleet only).
// The driver must belong to the same hauler as the rig.

router.post(
  '/:rigId/assign',
  requireRole(...ASSIGN_WRITE_ROLES),
  (req, res) => {
    const { rigId } = req.params;
    const { driver_id, notes } = req.body || {};

    const truck = FLEET.find((t) => t.id === rigId);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    if (req.user.role === 'hauler_admin' && truck.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'You can only assign drivers to your own hauler\'s trucks' });
    }

    if (!driver_id) return res.status(400).json({ error: 'driver_id is required' });

    const driver = DRIVERS.find((d) => d.id === driver_id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    // Enforce same-hauler constraint — drivers cannot cross corridors.
    if (driver.hauler_id !== truck.hauler_id) {
      return res.status(400).json({ error: 'Driver must belong to the same hauler as the rig' });
    }

    const assignment = rigAssignments.assign(rigId, driver_id, {
      notes:   notes?.trim() || null,
      by_name: req.user.display_name,
    });

    writeAudit({
      req,
      entity_type: 'fleet_truck',
      entity_id:   rigId,
      action:      'driver_assigned',
      summary:     `${rigId} (${truck.plate}) → driver ${driver_id} (${driver.full_name})${notes ? ` — ${notes.slice(0, 60)}` : ''}`,
    });

    res.json({ assignment, driver });
  },
);

router.delete(
  '/:rigId/assign',
  requireRole(...ASSIGN_WRITE_ROLES),
  (req, res) => {
    const { rigId } = req.params;

    const truck = FLEET.find((t) => t.id === rigId);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    if (req.user.role === 'hauler_admin' && truck.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'You can only manage your own hauler\'s trucks' });
    }

    const existing = rigAssignments.getAssignment(rigId);
    if (!existing) return res.status(404).json({ error: 'No live assignment to remove' });

    rigAssignments.unassign(rigId);

    writeAudit({
      req,
      entity_type: 'fleet_truck',
      entity_id:   rigId,
      action:      'driver_unassigned',
      summary:     `${rigId} (${truck.plate}) — live driver assignment removed`,
    });

    res.json({ ok: true });
  },
);

// ── Phase 102 — status write ───────────────────────────────────────
//
// PATCH /api/fleet/:rigId/status
//
// Body: { status, maintenance_flag (optional), notes (optional) }
//
// Role gate:
//   axis_admin / axis_ops  — any truck
//   hauler_admin           — only trucks belonging to their own hauler_id

router.patch(
  '/:rigId/status',
  requireRole(...STATUS_WRITE_ROLES),
  (req, res) => {
    const { rigId } = req.params;

    // Find the truck in the mock roster.
    const truck = FLEET.find((t) => t.id === rigId);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    // Hauler_admin scope: can only update their own hauler's trucks.
    if (req.user.role === 'hauler_admin' && truck.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'You can only update your own hauler\'s trucks' });
    }

    const { status, maintenance_flag, notes } = req.body || {};

    try {
      const override = fleetStatus.setStatus({
        rig_id:           rigId,
        status,
        maintenance_flag: maintenance_flag !== undefined ? maintenance_flag : null,
        notes,
        updated_by_id:    req.user.id,
        updated_by_name:  req.user.display_name,
      });

      const updated = fleetStatus.applyOverride(truck, override);

      writeAudit({
        req,
        entity_type: 'fleet_truck',
        entity_id:   rigId,
        action:      'status_update',
        summary:     `${rigId} (${truck.plate}) → ${status}${maintenance_flag ? ` [${maintenance_flag}]` : ''}${notes ? ` — ${notes.slice(0, 60)}` : ''}`,
      });

      res.json({ truck: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },
);

module.exports = router;
