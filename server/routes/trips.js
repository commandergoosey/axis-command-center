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

  // Phase 141 — 12-week rolling cost-efficiency trend. Groups mock trips
  // by ISO week (Monday-based) and computes avg cost/tonne + delay rate
  // per week. The last 12 complete weeks are returned in ascending order.
  const byWeek = {};
  filtered.forEach((t) => {
    const d = new Date(t.departed_at ?? t.completed_at ?? 0);
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // ISO Mon
    mon.setUTCHours(0, 0, 0, 0);
    const key = mon.toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { week: key, trips: 0, cost_usd: 0, tonnes: 0, delayed: 0 };
    const w = byWeek[key];
    w.trips++;
    w.cost_usd += t.cost?.total_usd ?? 0;
    w.tonnes   += t.tonnage_t ?? 0;
    if ((t.delay_min ?? 0) > 0) w.delayed++;
  });
  const cost_trend = Object.values(byWeek)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-12)
    .map((w) => ({
      week:               w.week,
      avg_cost_per_tonne: w.tonnes > 0 ? Number((w.cost_usd / w.tonnes).toFixed(2)) : null,
      trip_count:         w.trips,
      delay_rate_pct:     w.trips > 0 ? Number(((w.delayed / w.trips) * 100).toFixed(1)) : 0,
    }));

  // Phase 169 — per-hauler trip performance summary.
  // Groups the full (unfiltered) TRIPS set by hauler_id so the summary
  // strip shows all haulers regardless of the active hauler filter.
  const byHauler = {};
  TRIPS.forEach((t) => {
    if (!byHauler[t.hauler_id]) {
      byHauler[t.hauler_id] = {
        hauler_id:       t.hauler_id,
        hauler_display:  haulersById[t.hauler_id] ?? t.hauler_id,
        trips:           0,
        tonnes:          0,
        cost_total_usd:  0,
        revenue_usd:     0,
        delay_min_total: 0,
        delayed_count:   0,
      };
    }
    const h = byHauler[t.hauler_id];
    h.trips           += 1;
    h.tonnes          += t.tonnage_t ?? 0;
    h.cost_total_usd  += t.cost?.total_usd ?? 0;
    h.revenue_usd     += t.revenue_usd ?? 0;
    h.delay_min_total += t.delay_min ?? 0;
    if ((t.delay_min ?? 0) > 0) h.delayed_count += 1;
  });
  const hauler_summary = Object.values(byHauler)
    .map((h) => ({
      hauler_id:          h.hauler_id,
      hauler_display:     h.hauler_display,
      trips:              h.trips,
      tonnes:             h.tonnes,
      avg_cost_per_tonne: h.tonnes > 0 ? Number((h.cost_total_usd / h.tonnes).toFixed(2)) : null,
      avg_delay_min:      h.trips  > 0 ? Number((h.delay_min_total / h.trips).toFixed(1)) : 0,
      margin_usd:         Number((h.revenue_usd - h.cost_total_usd).toFixed(0)),
      margin_pct:         h.revenue_usd > 0
        ? Number(((h.revenue_usd - h.cost_total_usd) / h.revenue_usd * 100).toFixed(1))
        : null,
    }))
    .sort((a, b) => b.trips - a.trips);

  // Phase 189 — Trip delay root-cause classification. Seeded assignment of
  // delayed trips to 5 operational cause buckets so the Trips page surfaces
  // where delay time is actually going, not just that delays exist. Uses a
  // deterministic hash on trip index so the breakdown is stable across requests.
  function seededCause(n) {
    const raw = Math.sin(n * 9431 + 73) * 197_003;
    return raw - Math.floor(raw);
  }
  const CAUSES = [
    { key: 'weighbridge_queue', label: 'Weighbridge queue', pCum: 0.35 },
    { key: 'traffic',           label: 'Traffic / road',    pCum: 0.60 },
    { key: 'mechanical',        label: 'Mechanical',        pCum: 0.80 },
    { key: 'driver_rest',       label: 'Driver rest',       pCum: 0.92 },
    { key: 'weather',           label: 'Weather / road closure', pCum: 1.00 },
  ];
  const causeCounts = Object.fromEntries(CAUSES.map((c) => [c.key, { label: c.label, count: 0, delay_min_total: 0 }]));
  TRIPS.filter((t) => (t.delay_min ?? 0) > 0).forEach((t, idx) => {
    const v = seededCause(idx * 7 + 3);
    const cause = CAUSES.find((c) => v <= c.pCum) ?? CAUSES[CAUSES.length - 1];
    causeCounts[cause.key].count++;
    causeCounts[cause.key].delay_min_total += t.delay_min;
  });
  const delay_causes = CAUSES
    .map((c) => ({
      key:             c.key,
      label:           c.label,
      count:           causeCounts[c.key].count,
      avg_delay_min:   causeCounts[c.key].count > 0
        ? Math.round(causeCounts[c.key].delay_min_total / causeCounts[c.key].count)
        : 0,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // Phase 188 — SLA attainment heatmap (day-of-week × hauler).
  // Groups southbound trips (laden runs, tonnage > 0) by hauler_id and
  // day-of-week (Mon=0…Sun=6, same convention as delayHeatmap). For each
  // cell: trip count + on-time rate (delay_min === 0). Uses the full TRIPS
  // set (not the display-capped `filtered`) so the heatmap reflects total
  // operating history regardless of page filters.
  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const haulerIdsSorted = [...new Set(TRIPS.map((t) => t.hauler_id))].sort();
  const slaGrid = {};
  haulerIdsSorted.forEach((hid) => {
    slaGrid[hid] = Array.from({ length: 7 }, (_, dow) => ({ dow, trips: 0, on_time: 0 }));
  });
  TRIPS.filter((t) => t.tonnage_t > 0).forEach((t) => {
    const dow = (new Date(t.departed_at).getUTCDay() + 6) % 7;
    if (slaGrid[t.hauler_id]?.[dow]) {
      slaGrid[t.hauler_id][dow].trips++;
      if ((t.delay_min ?? 0) === 0) slaGrid[t.hauler_id][dow].on_time++;
    }
  });
  const sla_heatmap = haulerIdsSorted.map((hid) => ({
    hauler_id:      hid,
    hauler_display: haulersById[hid] ?? hid,
    days: slaGrid[hid].map((cell) => ({
      dow:          cell.dow,
      label:        DOW_LABELS[cell.dow],
      trips:        cell.trips,
      on_time_pct:  cell.trips > 0 ? Number(((cell.on_time / cell.trips) * 100).toFixed(0)) : null,
    })),
  }));

  // Phase 214 — per-hauler cost component breakdown: fuel / driver / maint / tolls.
  // Groups the full TRIPS set by hauler so the totals are independent of the
  // active page filter. Sorted highest-spend hauler first.
  const compByHauler = {};
  TRIPS.forEach((t) => {
    if (!compByHauler[t.hauler_id]) {
      compByHauler[t.hauler_id] = {
        hauler_id:   t.hauler_id,
        hauler_display: haulersById[t.hauler_id] ?? t.hauler_id,
        fuel_usd:   0,
        driver_usd: 0,
        maint_usd:  0,
        tolls_usd:  0,
        total_usd:  0,
        trips:      0,
      };
    }
    const c = compByHauler[t.hauler_id];
    c.trips      += 1;
    c.fuel_usd   += t.cost?.fuel_usd   ?? 0;
    c.driver_usd += t.cost?.driver_usd ?? 0;
    c.maint_usd  += t.cost?.maint_usd  ?? 0;
    c.tolls_usd  += t.cost?.tolls_usd  ?? 0;
    c.total_usd  += t.cost?.total_usd  ?? 0;
  });
  const cost_component_by_hauler = Object.values(compByHauler)
    .map((h) => ({
      hauler_id:      h.hauler_id,
      hauler_display: h.hauler_display,
      fuel_usd:       Math.round(h.fuel_usd),
      driver_usd:     Math.round(h.driver_usd),
      maint_usd:      Math.round(h.maint_usd),
      tolls_usd:      Math.round(h.tolls_usd),
      total_usd:      Math.round(h.total_usd),
      trips:          h.trips,
    }))
    .sort((a, b) => b.total_usd - a.total_usd);

  res.json({
    count: liveTrips.length + filtered.length,
    hauler_id: haulerId,
    trips,
    cost_per_route: Object.values(byRoute).sort((a, b) => b.trips - a.trips),
    delay_heatmap: delayHeatmap(filtered),
    cost_trend,
    hauler_summary,
    delay_causes,
    sla_heatmap,
    cost_component_by_hauler,
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
