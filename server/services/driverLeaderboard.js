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
  };
}

module.exports = { compose };
