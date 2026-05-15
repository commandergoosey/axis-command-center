'use strict';

/*
 * Take-or-pay forecast — Phase 42.
 *
 * Forward-looking sibling of services/aggregator.js. The aggregator says
 * "where the corridor stands TODAY"; this module says "where the corridor
 * will land at month-end if today's pace holds, and what it would take
 * to clear the take-or-pay floor."
 *
 * The contract is structured Tranche-1 1.0 Mtpa with an 80 % take-or-pay
 * floor (CONTRACT in aggregator.js). Two horizons matter for axis_admin
 * and the lender:
 *   1. Floor — the contractual minimum the offtaker has committed to.
 *     Missing it is the boundary between "operational drift" and
 *     "covenant trigger" for the GIBDLC senior debt facility.
 *   2. Contracted — the upside, the full month's nameplate.
 *
 * Math is intentionally simple — no Monte Carlo, no smoothing. We project
 * by extending the actual MTD daily average over the days remaining. The
 * point is not statistical precision; the point is to surface a single
 * legible number every morning so the operator knows whether today is a
 * "push" day or a "coast" day.
 *
 * Levers: each idle truck (contracted minus active) is sized at the
 * corridor's avg daily tonnes per truck; activating one closes the gap by
 * that much per remaining day. Gives operators a concrete handle —
 * "Hauler 05 has 7 trucks idle; activating them closes 65 % of the gap."
 */

const { aggregate, CONTRACT } = require('./aggregator');
const workorderState = require('../state/workorderState');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function daysInUtcMonth(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

function buildForecast(haulers, now = new Date()) {
  const agg = aggregate(haulers, now);

  const daysInMonth   = daysInUtcMonth(now);
  // Days "elapsed" includes today (in-progress) — fraction-of-day rounded
  // to the nearest whole so the daily-average denominator is honest. At
  // 06:00 we say "1 day elapsed", not "0.25 days".
  const daysElapsed   = Math.max(1, now.getUTCDate());
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  // Monthly nameplate (1.0 Mtpa / 12) and the two horizons.
  const monthlyTarget = (CONTRACT.target_mtpa * 1_000_000) / 12;
  const floorTarget   = Math.round(monthlyTarget * CONTRACT.take_or_pay_floor_pct);
  const monthlyTargetRounded = Math.round(monthlyTarget);

  const deliveredMtd  = agg.tonnes.delivered_mtd;
  const dailyActual   = deliveredMtd / daysElapsed;
  const projectedEom  = Math.round(deliveredMtd + dailyActual * daysRemaining);

  const shortfallToFloor      = Math.max(0, floorTarget - projectedEom);
  const shortfallToContracted = Math.max(0, monthlyTargetRounded - projectedEom);
  const surplusOverFloor      = Math.max(0, projectedEom - floorTarget);

  // What daily tonnage do we need from now until month-end to clear each
  // horizon? If we're already past the line, the required value is zero.
  const requiredDailyToFloor      = daysRemaining > 0
    ? Math.max(0, (floorTarget - deliveredMtd) / daysRemaining)
    : 0;
  const requiredDailyToContracted = daysRemaining > 0
    ? Math.max(0, (monthlyTargetRounded - deliveredMtd) / daysRemaining)
    : 0;

  // Outcome verdict — three buckets, used by the UI for the headline tone.
  let verdict;
  if (projectedEom >= monthlyTargetRounded)      verdict = 'on_pace_for_contracted';
  else if (projectedEom >= floorTarget)           verdict = 'above_floor';
  else if (deliveredMtd >= floorTarget)           verdict = 'banked_floor_drift';
  else                                            verdict = 'below_floor_at_pace';

  // Per-hauler gap analysis — for active haulers only, sized in trucks
  // and in tonnes-per-day-of-remainder. "If Hauler 05 activates 7 idle
  // trucks at 7.6 t/truck/day (the corridor average), that's 53 t/day
  // recovery, or 1,166 t over the next 22 days remaining."
  const tonnesPerActiveTruckPerDay = agg.fleet.active_trucks > 0
    ? dailyActual / agg.fleet.active_trucks
    : 0;
  const levers = agg.haulers
    .filter((h) => h.status === 'active')
    .map((h) => {
      const idle = Math.max(0, h.fleet.contracted_trucks - h.fleet.active_trucks);
      const dailyRecovery = idle * tonnesPerActiveTruckPerDay;
      const remainderRecovery = Math.round(dailyRecovery * daysRemaining);
      return {
        hauler_id:           h.id,
        display_name:        h.display_name,
        active_trucks:       h.fleet.active_trucks,
        contracted_trucks:   h.fleet.contracted_trucks,
        idle_trucks:         idle,
        daily_recovery:      Math.round(dailyRecovery),
        remainder_recovery:  remainderRecovery,
      };
    })
    .filter((l) => l.idle_trucks > 0)
    .sort((a, b) => b.remainder_recovery - a.remainder_recovery);

  const totalIdleRecovery = levers.reduce((s, l) => s + l.remainder_recovery, 0);

  // ── Phase 47 — workshop drag ─────────────────────────────────────
  //
  // Every open workorder is one truck not running today. The forecast
  // already captures the consequence in aggregate (active_trucks is
  // already net of garage/workshop), but it doesn't tell the operator
  // how much the workshop *backlog itself* is costing — i.e. "if you
  // close these N workorders the floor gets easier by X tonnes."
  //
  // Per workorder:
  //   days_lost_this_month = days from max(opened_at, month_start) → now
  //   days_remaining_at_risk = days_remaining (assumes rig stays out
  //                            for the rest of the month — pessimistic
  //                            upper bound; cap is bounded above by
  //                            month length).
  //   lost_so_far_tonnes  = tonnesPerActiveTruckPerDay × days_lost
  //   remainder_tonnes    = tonnesPerActiveTruckPerDay × days_remaining
  //
  // Aggregate gives a single "open work-orders cost X kt over the
  // month" number that operators can act on (resolve faster → smaller
  // drag).
  const monthStartIso = (() => {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  })();
  const openWorkorders = workorderState.allOpen();
  const workorderRows = openWorkorders.map((w) => {
    const openedAtMs = new Date(w.opened_at).getTime();
    const lostFromMs = Math.max(openedAtMs, monthStartIso);
    const daysLost   = Math.max(0, (now.getTime() - lostFromMs) / ONE_DAY_MS);
    const daysOpen   = Math.max(0, (now.getTime() - openedAtMs) / ONE_DAY_MS);
    const lostSoFar  = Math.round(daysLost * tonnesPerActiveTruckPerDay);
    const remainder  = Math.round(daysRemaining * tonnesPerActiveTruckPerDay);
    return {
      workorder_id:    w.id,
      rig_id:          w.rig_id,
      hauler_id:       w.hauler_id,
      title:           w.title,
      status:          w.status,
      opened_at:       w.opened_at,
      days_open:       Number(daysOpen.toFixed(1)),
      days_lost:       Number(daysLost.toFixed(1)),
      lost_so_far:     lostSoFar,
      remainder_drag:  remainder,
      total_drag:      lostSoFar + remainder,
    };
  })
  .sort((a, b) => b.total_drag - a.total_drag);

  const lostSoFarTotal   = workorderRows.reduce((s, w) => s + w.lost_so_far, 0);
  const remainderTotal   = workorderRows.reduce((s, w) => s + w.remainder_drag, 0);
  const totalDrag        = lostSoFarTotal + remainderTotal;
  // What share of the floor gap is explained by workshop drag? Only
  // meaningful when there IS a gap; null otherwise. ≥100 % means
  // closing the workshop alone could clear the floor.
  const pctOfFloorGap =
    shortfallToFloor > 0
      ? Number(((totalDrag / shortfallToFloor) * 100).toFixed(1))
      : null;

  // ── Phase 44 — per-hauler month-end projection ───────────────────
  //
  // Decompose the corridor forecast per hauler so operators can answer
  // "which one is dragging us down?" Each active hauler's projected EOM
  // is their MTD delivery extended at their own daily pace. Compared
  // against their contracted-share of the monthly nameplate, this gives
  // a clean run-rate verdict per hauler:
  //   - on_pace        : projected ≥ 100 % of own contracted target
  //   - drift          : 90–100 % (will miss but within tolerance)
  //   - lagging        : 75–90 %  (clearly behind)
  //   - severely_lagging : < 75 %
  // Inactive haulers are surfaced separately (no projection, just status)
  // so the page can show the full roster with the right framing.
  const haulerProjections = agg.haulers.map((h) => {
    if (h.status !== 'active') {
      return {
        hauler_id:                h.id,
        display_name:             h.display_name,
        status:                   h.status,
        delivered_mtd:            0,
        contracted_mtd:           0,
        contracted_monthly:       0,
        daily_avg:                0,
        projected_eom:            0,
        projected_pct_contracted: 0,
        verdict:                  'inactive',
      };
    }
    const dh   = h.tonnes_delivered_mtd / daysElapsed;
    const eom  = Math.round(h.tonnes_delivered_mtd + dh * daysRemaining);
    const cMo  = Math.round((h.tonnes_contracted_mtd / daysElapsed) * daysInMonth);
    const pct  = cMo > 0 ? Number(((eom / cMo) * 100).toFixed(1)) : 0;
    let v;
    if (pct >= 100)      v = 'on_pace';
    else if (pct >= 90)  v = 'drift';
    else if (pct >= 75)  v = 'lagging';
    else                  v = 'severely_lagging';
    return {
      hauler_id:                h.id,
      display_name:             h.display_name,
      status:                   h.status,
      delivered_mtd:            h.tonnes_delivered_mtd,
      contracted_mtd:           h.tonnes_contracted_mtd,
      contracted_monthly:       cMo,
      daily_avg:                Math.round(dh),
      projected_eom:            eom,
      projected_pct_contracted: pct,
      verdict:                  v,
    };
  })
  .sort((a, b) => a.projected_pct_contracted - b.projected_pct_contracted);

  return {
    generated_at:    now.toISOString(),
    horizon: {
      days_in_month:    daysInMonth,
      days_elapsed:     daysElapsed,
      days_remaining:   daysRemaining,
    },
    targets: {
      monthly:        monthlyTargetRounded,
      floor:          floorTarget,
      floor_pct:      CONTRACT.take_or_pay_floor_pct,
    },
    actual: {
      delivered_mtd:  deliveredMtd,
      daily_avg:      Math.round(dailyActual),
      // Convenience % of nameplate delivered so the UI doesn't have to
      // divide on render.
      pct_of_monthly: Number(((deliveredMtd / monthlyTargetRounded) * 100).toFixed(1)),
      pct_of_floor:   Number(((deliveredMtd / floorTarget) * 100).toFixed(1)),
    },
    projection: {
      eom_tonnes:               projectedEom,
      pct_of_monthly:           Number(((projectedEom / monthlyTargetRounded) * 100).toFixed(1)),
      pct_of_floor:             Number(((projectedEom / floorTarget) * 100).toFixed(1)),
      shortfall_to_floor:       shortfallToFloor,
      shortfall_to_contracted:  shortfallToContracted,
      surplus_over_floor:       surplusOverFloor,
      verdict,
    },
    required: {
      daily_to_floor:       Math.round(requiredDailyToFloor),
      daily_to_contracted:  Math.round(requiredDailyToContracted),
      lift_pct_to_floor: dailyActual > 0
        ? Number((((requiredDailyToFloor - dailyActual) / dailyActual) * 100).toFixed(1))
        : null,
    },
    levers: {
      tonnes_per_truck_day:  Number(tonnesPerActiveTruckPerDay.toFixed(1)),
      total_remainder_recovery_if_all_active: totalIdleRecovery,
      pct_of_floor_gap_closed: shortfallToFloor > 0
        ? Number(((totalIdleRecovery / shortfallToFloor) * 100).toFixed(1))
        : null,
      by_hauler: levers,
    },
    // Phase 44 — per-hauler projection. Sorted worst-first so consumers
    // can render "the laggards" at the top without re-sorting.
    haulers: haulerProjections,
    // Phase 47 — open work-order drag. Sorted by total_drag descending
    // so the most expensive workorder leads any per-row UI.
    workshop_drag: {
      open_count:        workorderRows.length,
      lost_so_far:       lostSoFarTotal,
      remainder_drag:    remainderTotal,
      total_drag:        totalDrag,
      pct_of_floor_gap:  pctOfFloorGap,
      by_workorder:      workorderRows,
    },
  };
}

// ── Phase 50 — Forecast scenario planner ──────────────────────────
//
// Take the baseline forecast and apply operator-controlled levers to
// answer "what if?" without writing anything. Three levers:
//
//   `hauler_truck_lifts: { hauler_id: extra_trucks }` — operator
//     activates idle trucks (capped by `idle_trucks` per hauler).
//
//   `resolve_workorders: ['wo-…', …]` — pretend these open
//     workorders are resolved. Each one removes a tonnes-per-truck-day
//     of drag for the rest of the month and restores that capacity.
//
//   `daily_avg_lift_pct: 0..50` — operator commits to an across-the-
//     board pace lift (e.g. extra shifts, longer driver hours within
//     compliance). Multiplicative on the post-truck-lift daily.
//
// Returns the same shape as buildForecast() with an additional
// `scenario` block describing what was applied and the deltas vs the
// baseline projection. No side effects — the audit log stays clean.
function buildForecastScenario(haulers, scenario, now = new Date()) {
  const baseline = buildForecast(haulers, now);
  const {
    hauler_truck_lifts = {},
    resolve_workorders = [],
    daily_avg_lift_pct = 0,
  } = scenario || {};

  // Validate + clamp inputs against baseline reality.
  const truckLifts = {};
  let totalTrucksAdded = 0;
  for (const h of baseline.haulers) {
    const requested = Math.max(0, Number(hauler_truck_lifts[h.hauler_id]) || 0);
    const idle = Math.max(0, (baseline.levers.by_hauler.find((l) => l.hauler_id === h.hauler_id)?.idle_trucks) || 0);
    const granted = Math.min(requested, idle);
    if (granted > 0) {
      truckLifts[h.hauler_id] = granted;
      totalTrucksAdded += granted;
    }
  }

  const drag = baseline.workshop_drag;
  const resolveSet = new Set(resolve_workorders);
  const resolvedRows = drag.by_workorder.filter((w) => resolveSet.has(w.workorder_id));
  // Resolving a workorder = +1 truck on the road for `daysRemaining`.
  // Approximate that as an additional truck for the rest of the
  // month, same multiplier as a hauler truck lift.
  const trucksFromResolves = resolvedRows.length;
  totalTrucksAdded += trucksFromResolves;

  // Pace lift bounded to ±50 % to keep the planner honest.
  const lift = Math.max(0, Math.min(50, Number(daily_avg_lift_pct) || 0));

  // Compose adjusted daily.
  const tpd          = baseline.levers.tonnes_per_truck_day;
  const baseDaily    = baseline.actual.daily_avg;
  const fromTrucks   = Math.round(totalTrucksAdded * tpd);
  const liftedDaily  = Math.round((baseDaily + fromTrucks) * (1 + lift / 100));
  const daysRem      = baseline.horizon.days_remaining;
  const deliveredMtd = baseline.actual.delivered_mtd;
  const projectedEom = Math.round(deliveredMtd + liftedDaily * daysRem);

  const floor          = baseline.targets.floor;
  const monthly        = baseline.targets.monthly;
  const shortfallToFloor      = Math.max(0, floor   - projectedEom);
  const shortfallToContracted = Math.max(0, monthly - projectedEom);
  const surplusOverFloor      = Math.max(0, projectedEom - floor);

  let verdict;
  if      (projectedEom >= monthly) verdict = 'on_pace_for_contracted';
  else if (projectedEom >= floor)   verdict = 'above_floor';
  else if (deliveredMtd >= floor)   verdict = 'banked_floor_drift';
  else                              verdict = 'below_floor_at_pace';

  return {
    ...baseline,
    scenario: {
      applied: {
        hauler_truck_lifts:  truckLifts,
        resolve_workorders:  resolvedRows.map((w) => ({
          workorder_id: w.workorder_id, rig_id: w.rig_id, title: w.title,
        })),
        daily_avg_lift_pct:  lift,
      },
      totals: {
        trucks_added:        totalTrucksAdded,
        from_truck_lifts:    Object.values(truckLifts).reduce((s, n) => s + n, 0),
        from_workorder_resolves: trucksFromResolves,
        daily_avg_added:     fromTrucks,
        adjusted_daily_avg:  liftedDaily,
      },
      projection: {
        eom_tonnes:               projectedEom,
        pct_of_floor:             Number(((projectedEom / floor)   * 100).toFixed(1)),
        pct_of_monthly:           Number(((projectedEom / monthly) * 100).toFixed(1)),
        shortfall_to_floor:       shortfallToFloor,
        shortfall_to_contracted:  shortfallToContracted,
        surplus_over_floor:       surplusOverFloor,
        verdict,
      },
      delta: {
        eom_tonnes:          projectedEom - baseline.projection.eom_tonnes,
        daily_avg:           liftedDaily  - baseDaily,
        verdict_changed:     verdict !== baseline.projection.verdict,
        clears_floor:        verdict !== 'below_floor_at_pace' &&
                              baseline.projection.verdict === 'below_floor_at_pace',
      },
    },
  };
}

module.exports = { buildForecast, buildForecastScenario };
