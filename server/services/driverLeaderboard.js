'use strict';

/*
 * Driver Leaderboard — Phase 94.
 *
 * Ranks corridor drivers across three independent dimensions:
 *   Safety    — safety_score (0–100; higher = fewer harsh events)
 *   Road Warrior — trips_this_week (total laden + empty runs completed)
 *   On Duty   — hours_this_week (seat time; proxy for utilisation)
 *
 * A composite score is the mean of each dimension's normalised value
 * (0–100 relative to the corridor maximum), giving equal weight to
 * all three. The composite ranking is the primary sort in the full
 * corridor table.
 *
 * hauler_filter — if provided, returns only that hauler's drivers.
 *   The podiums and corridor averages always reflect the filtered
 *   set so the hauler admin sees a meaningful ranking within their
 *   own fleet; corridor_avg is also returned separately for context.
 *
 * Phase 136 — live_corridor: today's convoy dispatch count + tonnage +
 *   active convoy count blended into the response so the Leaderboard
 *   page can surface real-time corridor context alongside driver rankings.
 */

const { DRIVERS } = require('../mock/drivers');
const convoyState  = require('../state/convoyState');
const dailyTargets = require('../state/dailyTargets');

// Phase 153 — deterministic pseudo-random seed (same pattern as health_history).
function seeded(n) {
  const raw = Math.sin(n * 9301 + 49297) * 233280;
  return raw - Math.floor(raw);
}

function normalise(val, max) {
  if (!max) return 0;
  return (val / max) * 100;
}

function avg(arr, field) {
  if (!arr.length) return 0;
  const sum = arr.reduce((s, d) => s + (d[field] || 0), 0);
  return +(sum / arr.length).toFixed(1);
}

function buildRankings(pool) {
  const maxSafety = Math.max(...pool.map((d) => d.safety_score || 0), 1);
  const maxTrips  = Math.max(...pool.map((d) => d.trips_this_week || 0), 1);
  const maxHours  = Math.max(...pool.map((d) => d.hours_this_week || 0), 1);

  return pool
    .map((d) => {
      const normSafety = normalise(d.safety_score    || 0, maxSafety);
      const normTrips  = normalise(d.trips_this_week || 0, maxTrips);
      const normHours  = normalise(d.hours_this_week || 0, maxHours);
      return {
        id:              d.id,
        full_name:       d.full_name,
        hauler_id:       d.hauler_id,
        hauler_display:  d.hauler_display,
        safety_score:    d.safety_score    || 0,
        trips_this_week: d.trips_this_week || 0,
        hours_this_week: d.hours_this_week || 0,
        harsh_events_7d: d.harsh_events_7d || 0,
        flag:            d.flag            || false,
        composite:       Math.round((normSafety + normTrips + normHours) / 3),
      };
    })
    .sort((a, b) => b.composite - a.composite)
    .map((d, i) => ({ ...d, rank: i + 1 }));
}

function podiumFor(rankings, field) {
  return [...rankings]
    .sort((a, b) => b[field] - a[field])
    .slice(0, 3)
    .map((d, i) => ({ ...d, medal: i + 1 }));
}

function compose(haulerFilter = null) {
  const all     = DRIVERS;
  const pool    = haulerFilter
    ? all.filter((d) => d.hauler_id === haulerFilter)
    : all;

  if (!pool.length) {
    return {
      generated_at:    new Date().toISOString(),
      period:          'This week',
      total_drivers:   0,
      hauler_filter:   haulerFilter || null,
      podiums:         { safety: [], trips: [], hours: [] },
      corridor_avg:    { safety: 0, trips: 0, hours: 0 },
      rankings:        [],
    };
  }

  const rankings = buildRankings(pool);

  // Corridor-wide averages (always the full driver set, not the filter)
  const corridorAll = buildRankings(all);
  const corridorAvg = {
    safety: Math.round(avg(corridorAll, 'safety_score')),
    trips:  avg(corridorAll, 'trips_this_week'),
    hours:  avg(corridorAll, 'hours_this_week'),
  };

  // Phase 143 — fatigue flags: drivers approaching the 70h weekly HOS
  // ceiling. Advisory only — operators must verify against driver logs.
  const HOS_WARN_H     = 60;  // WATCH threshold (hours this week)
  const HOS_WARNING_H  = 65;  // WARNING
  const HOS_CRITICAL_H = 68;  // CRITICAL (within 2h of ceiling)
  const HOS_CEILING_H  = 70;

  const fatigue_flags = pool
    .filter((d) => (d.hours_this_week ?? 0) >= HOS_WARN_H)
    .map((d) => ({
      driver_id:       d.id,
      full_name:       d.full_name,
      hauler_id:       d.hauler_id,
      hauler_display:  d.hauler_display,
      hours_this_week: d.hours_this_week ?? 0,
      hours_to_limit:  Math.max(0, HOS_CEILING_H - (d.hours_this_week ?? 0)),
      severity: (d.hours_this_week ?? 0) >= HOS_CRITICAL_H ? 'CRITICAL'
              : (d.hours_this_week ?? 0) >= HOS_WARNING_H  ? 'WARNING'
              : 'WATCH',
    }))
    .sort((a, b) => b.hours_this_week - a.hours_this_week);

  // Phase 136 — live corridor context: today's convoy activity blended in
  // so the Leaderboard page can show live ops alongside driver rankings.
  // Advisory: failure returns zeroes so the page always has a valid shape.
  let live_corridor = { today_convoys: 0, today_tonnes: 0, active_now: 0 };
  try {
    const dateKey = dailyTargets.todayKey();
    const { total_tonnes, convoy_count } = convoyState.todayTonnage(dateKey);
    const active = convoyState.listActive();
    live_corridor = {
      today_convoys: convoy_count,
      today_tonnes:  Math.round(total_tonnes * 10) / 10,
      active_now:    active.length,
    };
  } catch { /* non-fatal */ }

  // Phase 153 — 8-week HOS tier count trend (seeded, stable across requests).
  // Shows week-by-week distribution of CRITICAL / WARNING / WATCH / OK drivers
  // so ops can spot whether HOS pressure is trending worse over time.
  const now = new Date();
  const totalDrivers = all.length;
  const hos_trend = [];
  for (let w = 7; w >= 0; w--) {
    const ref = new Date(now.getTime() - w * 7 * 86_400_000);
    // Align to Monday (ISO week start)
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7));
    const weekLabel = monday.toISOString().slice(0, 10);
    const wk = monday.getUTCFullYear() * 1000
             + monday.getUTCMonth()    *   31
             + monday.getUTCDate();

    const critCount    = Math.round(totalDrivers * (0.04 + seeded(wk + 1111) * 0.06));
    const warningCount = Math.round(totalDrivers * (0.06 + seeded(wk + 2222) * 0.08));
    const watchCount   = Math.round(totalDrivers * (0.09 + seeded(wk + 3333) * 0.10));
    const okCount      = Math.max(0, totalDrivers - critCount - warningCount - watchCount);
    hos_trend.push({
      week:     weekLabel,
      critical: critCount,
      warning:  warningCount,
      watch:    watchCount,
      ok:       okCount,
      total:    totalDrivers,
    });
  }

  // Phase 160 — per-hauler 5-axis performance radar.
  // Aggregates driver rankings within each hauler into five normalised
  // 0–100 scores: throughput, safety, hours utilisation, fatigue compliance,
  // and corridor contribution. Gives ops an at-a-glance cross-hauler
  // performance comparison across all five dimensions simultaneously.
  const maxTrips = Math.max(1, ...corridorAll.map((d) => d.trips_this_week ?? 0));
  const haulerGroups = {};
  rankings.forEach((d) => {
    if (!haulerGroups[d.hauler_id]) {
      haulerGroups[d.hauler_id] = {
        hauler_id:    d.hauler_id,
        display_name: d.hauler_display,
        drivers:      [],
      };
    }
    haulerGroups[d.hauler_id].drivers.push(d);
  });
  const hauler_radar = Object.values(haulerGroups).map((h) => {
    const ds = h.drivers;
    const n  = Math.max(1, ds.length);
    const avgSafety = ds.reduce((s, d) => s + (d.safety_score       ?? 0), 0) / n;
    const avgTrips  = ds.reduce((s, d) => s + (d.trips_this_week    ?? 0), 0) / n;
    const avgHours  = ds.reduce((s, d) => s + (d.hours_this_week    ?? 0), 0) / n;

    const safety_score      = Math.round(avgSafety);
    const throughput_score  = Math.round((avgTrips / maxTrips) * 100);
    // Ideal seat-time window: 50–62 h/wk — penalise either side
    const IDEAL_HOURS = 56;
    const hours_score = Math.min(100, Math.max(0, Math.round(100 - Math.abs(avgHours - IDEAL_HOURS) * 2.5)));
    // Fatigue compliance: share of drivers below the 60h WATCH threshold
    const watchCount = ds.filter((d) => (d.hours_this_week ?? 0) >= 60).length;
    const fatigue_compliance = Math.round(((n - watchCount) / n) * 100);
    // Corridor contribution: normalised trip-share relative to corridor avg
    const tripsShare = corridorAvg.trips > 0
      ? Math.min(150, Math.round((avgTrips / corridorAvg.trips) * 100))
      : 100;
    return {
      hauler_id:           h.hauler_id,
      display_name:        h.display_name,
      driver_count:        n,
      safety_score,
      throughput_score,
      hours_score,
      fatigue_compliance,
      corridor_contribution: tripsShare,
    };
  });

  return {
    generated_at:  new Date().toISOString(),
    period:        'This week',
    total_drivers: pool.length,
    hauler_filter: haulerFilter || null,
    podiums: {
      safety: podiumFor(rankings, 'safety_score'),
      trips:  podiumFor(rankings, 'trips_this_week'),
      hours:  podiumFor(rankings, 'hours_this_week'),
    },
    corridor_avg:  corridorAvg,
    rankings,
    live_corridor,
    fatigue_flags,
    hos_trend,
    hauler_radar,
  };
}

module.exports = { compose };
