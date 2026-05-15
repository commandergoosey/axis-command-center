'use strict';

/*
 * GET /api/trips
 * Query parameters:
 *   hauler_id — filter to a single hauler (optional)
 *   limit     — cap the returned trip list (default 40, max 200)
 * Always returns the cost-per-route rollup and delay heatmap for the
 * active filter set so the analytics cards re-derive on filter change.
 */

const express = require('express');
const router = express.Router();

const roster = require('../state/roster');
const convoyState = require('../state/convoyState');
const { TRIPS, delayHeatmap } = require('../mock/trips');
const { WAYPOINTS } = require('../mock/corridor');
const { FLEET }    = require('../mock/fleet');
const { DRIVERS }  = require('../mock/drivers');
const { ALERTS }   = require('../mock/alerts');

router.get('/', (req, res) => {
  const haulerId = req.params.hauler_id || req.query.hauler_id || null;
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 40);

  const filtered = haulerId
    ? TRIPS.filter((t) => t.hauler_id === haulerId)
    : TRIPS;

  // Cost-per-route: for each route × direction, aggregate cost/revenue/tonnage.
  const byRoute = {};
  filtered.forEach((t) => {
    const key = t.route_id;
    if (!byRoute[key]) {
      byRoute[key] = {
        route_id: t.route_id,
        route_label: t.route_label,
        direction: t.direction,
        trips: 0,
        tonnes: 0,
        cost_fuel_usd:   0,
        cost_driver_usd: 0,
        cost_maint_usd:  0,
        cost_tolls_usd:  0,
        cost_total_usd:  0,
        revenue_usd:     0,
      };
    }
    const r = byRoute[key];
    r.trips           += 1;
    r.tonnes          += t.tonnage_t;
    r.cost_fuel_usd   += t.cost.fuel_usd;
    r.cost_driver_usd += t.cost.driver_usd;
    r.cost_maint_usd  += t.cost.maint_usd;
    r.cost_tolls_usd  += t.cost.tolls_usd;
    r.cost_total_usd  += t.cost.total_usd;
    r.revenue_usd     += t.revenue_usd;
  });

  const haulersById = Object.fromEntries(
    roster.list().map((h) => [h.id, h.display_name]),
  );

  // Phase 123 — blend live completed convoys at the head of the ledger.
  // They are excluded from the cost/revenue aggregation (no financial data
  // available) so the analytics cards (cost_per_route, delay_heatmap) remain
  // purely model-backed. The ledger count includes live trips.
  let liveTrips = [];
  try {
    liveTrips = convoyState.liveCompletedTrips(haulerId || null)
      .map((t) => ({ ...t, hauler_display_name: haulersById[t.hauler_id] ?? t.hauler_id }));
  } catch (_) { /* non-fatal: fall back to mock-only */ }

  const mockTrips = filtered.slice(0, limit).map((t) => ({
    ...t,
    hauler_display_name: haulersById[t.hauler_id] ?? t.hauler_id,
  }));

  const trips = [...liveTrips, ...mockTrips].slice(0, limit);

  res.json({
    count: liveTrips.length + filtered.length,
    hauler_id: haulerId,
    trips,
    cost_per_route: Object.values(byRoute).sort((a, b) => b.trips - a.trips),
    delay_heatmap: delayHeatmap(filtered),
  });
});

// ── Detail ─────────────────────────────────────────────────────────
//   GET /api/trips/:id — full trip detail with synthesised GPS timeline,
//   weighbridge events for laden runs, assigned rig + driver, and any
//   alerts whose asset_ref names the trip or whose hauler_id matches.
router.get('/:id', (req, res) => {
  const trip = TRIPS.find((t) => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const haulerDisplay = roster.list().find((h) => h.id === trip.hauler_id)?.display_name
                     ?? trip.hauler_id;

  // Pick a deterministic rig + driver from the hauler so re-loading the
  // same trip always shows the same plate/name. The mock trip fixture
  // doesn't carry rig/driver assignment, so we derive it stably from id.
  const haulerRigs = FLEET.filter((t) => t.hauler_id === trip.hauler_id);
  const rigIdx = hashOf(trip.id) % Math.max(haulerRigs.length, 1);
  const rig = haulerRigs[rigIdx] || null;
  const haulerDrivers = DRIVERS.filter((d) => d.hauler_id === trip.hauler_id);
  const driver = (rig && haulerDrivers.find((d) => d.assigned_rig_id === rig.id))
              ?? haulerDrivers[hashOf(trip.id + 'd') % Math.max(haulerDrivers.length, 1)]
              ?? null;

  const timeline   = buildTripTimeline(trip);
  const weighbridges = buildWeighbridgeEvents(trip);

  const related = ALERTS
    .filter((a) => (
      a.asset_ref === trip.id ||
      (a.hauler_id === trip.hauler_id && a.status !== 'RESOLVED')
    ))
    .map((a) => ({
      id: a.id, severity: a.severity, type: a.type,
      title: a.title, status: a.status, opened_at: a.opened_at,
    }));

  res.json({
    ...trip,
    hauler_display_name: haulerDisplay,
    assigned_rig: rig ? {
      rig_id: rig.id, plate: rig.plate, make: rig.make, model: rig.model,
      payload_capacity_t: rig.payload_capacity_t,
    } : null,
    driver: driver ? {
      id: driver.id, display_name: driver.full_name, phone: driver.phone,
      licence_class: driver.licence_class, safety_score: driver.safety_score,
    } : null,
    timeline,
    weighbridges,
    related_alerts: related,
  });
});

// ── Helpers ────────────────────────────────────────────────────────

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildTripTimeline(trip) {
  // Walk every waypoint along the trip's direction and time-stamp each pass
  // by linear interpolation between departed_at and arrived_at.
  const ordered = trip.direction === 'northbound'
    ? [...WAYPOINTS].sort((a, b) => b.km - a.km)
    : [...WAYPOINTS].sort((a, b) => a.km - b.km);

  const depart  = new Date(trip.departed_at).getTime();
  const arrive  = new Date(trip.arrived_at).getTime();
  const totalKm = 300;

  const passes = ordered.map((w, i) => {
    const coveredToHere = trip.direction === 'northbound' ? 300 - w.km : w.km;
    const ts = new Date(depart + (coveredToHere / totalKm) * (arrive - depart)).toISOString();
    const isFirst = i === 0;
    const isLast  = i === ordered.length - 1;
    return {
      type:     w.kind,
      label:    isFirst ? `${w.label} · departed`
              : isLast  ? `${w.label} · arrived`
                        : w.label,
      km:       w.km,
      iso:      ts,
      waypoint: w.id,
      status:   isFirst || isLast ? 'terminal' : 'passed',
    };
  });
  return passes;
}

function buildWeighbridgeEvents(trip) {
  // Only laden trips weigh in; empty returns just transit.
  if (trip.tonnage_t === 0) return [];

  const wbWaypoints = WAYPOINTS.filter((w) => w.kind === 'weighbridge');
  return wbWaypoints
    .sort((a, b) => trip.direction === 'northbound' ? b.km - a.km : a.km - b.km)
    .map((w, i) => {
      // Origin weighbridge takes a load reading; destination takes a clearance.
      const departReading = i === 0;
      const seed = hashOf(trip.id + w.id);
      const variance = ((seed % 61) - 30) / 100;     // ±0.30 t deterministic noise
      const reading = trip.tonnage_t > 0 ? Number((trip.tonnage_t + variance).toFixed(2)) : null;
      const overload = reading != null && reading > trip.tonnage_t + 0.5;
      const coveredToHere = trip.direction === 'northbound' ? 300 - w.km : w.km;
      const depart = new Date(trip.departed_at).getTime();
      const arrive = new Date(trip.arrived_at).getTime();
      const ts = new Date(depart + (coveredToHere / 300) * (arrive - depart)).toISOString();

      return {
        id:       `${trip.id}-${w.id}`,
        waypoint: w.id,
        label:    w.label,
        km:       w.km,
        iso:      ts,
        kind:     departReading ? 'load_check' : 'clearance',
        payload_t:  reading,
        gvw_t:     reading != null ? Number((reading + 13.4).toFixed(2)) : null, // payload + average tare
        result:    overload ? 'HOLD' : 'PASS',
        delay_min: overload ? 30 + (seed % 15) : Math.max(0, (seed % 7) - 2),
      };
    });
}

module.exports = router;
