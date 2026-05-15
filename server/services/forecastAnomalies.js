'use strict';

/*
 * Forecast anomaly detection — Phase 60.
 *
 * Reads the rolling forecast snapshot history (Phase 43) plus the
 * live forecast and flags patterns the operator should know about
 * before they have to go looking. Three classes of anomaly:
 *
 *   1. Verdict transition — projection crossed into a worse bucket
 *      since yesterday (e.g. above_floor → below_floor_at_pace).
 *   2. Sharp single-day drop — projected EOM fell ≥3% in 24h.
 *   3. Trend reversal — was climbing for ≥3 days, now falling.
 *
 * Each anomaly is shaped like an observationSynth observation card
 * (`{ id, severity, body }`) so the existing AXIS Intelligence panel
 * surfaces them with no UI changes. Severity is `warn` for verdict
 * decay and sharp drops, `info` for trend reversals.
 *
 * Defensive: returns `[]` if there's no snapshot history (early
 * deployment) or buildForecast throws. The Intelligence panel
 * tolerates an empty list.
 */

const { buildForecast }   = require('./forecast');
const forecastSnapshots   = require('../state/forecastSnapshots');
const roster              = require('../state/roster');

// Verdict severity ranking — higher number = worse outcome. Used to
// detect transitions where the projection deteriorated.
const VERDICT_RANK = {
  on_pace_for_contracted: 0,
  above_floor:            1,
  banked_floor_drift:     2,
  below_floor_at_pace:    3,
};
const VERDICT_LABEL = {
  on_pace_for_contracted: 'on pace for contracted',
  above_floor:            'above floor but below contracted',
  banked_floor_drift:     'floor banked, pace slipping',
  below_floor_at_pace:    'below floor at current pace',
};

function detect(now = new Date()) {
  let live;
  try { live = buildForecast(roster.list(), now); }
  catch { return []; }

  // Last 14 daily snapshots, ascending.
  const snaps = forecastSnapshots.recent(14, now.getTime());
  if (snaps.length < 2) return [];

  // Sort defensively (recent() should already do this, but cheap).
  snaps.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));

  const yesterday = snaps[snaps.length - 2];   // closest snapshot before today
  const today     = snaps[snaps.length - 1];   // today's row (overwritten by every read)

  const out = [];

  // ── 1. Verdict transition ───────────────────────────────────────
  if (yesterday && live.projection.verdict !== yesterday.verdict) {
    const prevRank = VERDICT_RANK[yesterday.verdict] ?? 0;
    const newRank  = VERDICT_RANK[live.projection.verdict] ?? 0;
    if (newRank > prevRank) {
      out.push({
        id: 'obs-forecast-verdict-decay',
        severity: 'warn',
        body: `Forecast verdict transitioned to ${VERDICT_LABEL[live.projection.verdict]} ` +
              `(was ${VERDICT_LABEL[yesterday.verdict]} at ${yesterday.snapshot_date}). ` +
              `${(live.projection.eom_tonnes / 1000).toFixed(1)} kt projected with ${live.horizon.days_remaining} days remaining.`,
      });
    }
  }

  // ── 2. Sharp single-day drop ────────────────────────────────────
  // Threshold 1.5% — large enough to filter routine intra-day drift,
  // tight enough to catch real material moves (a 1,000 t drop on a
  // ~65,000 t projection is genuine signal worth flagging).
  if (yesterday) {
    const drop = yesterday.eom_tonnes - live.projection.eom_tonnes;
    const dropPct = yesterday.eom_tonnes > 0
      ? (drop / yesterday.eom_tonnes) * 100
      : 0;
    if (dropPct >= 1.0) {
      out.push({
        id: 'obs-forecast-sharp-drop',
        severity: 'warn',
        body: `Projected EOM fell ${drop.toLocaleString()} t (${dropPct.toFixed(1)}%) since yesterday's reading — ` +
              `${(live.projection.eom_tonnes / 1000).toFixed(1)} kt now vs ${(yesterday.eom_tonnes / 1000).toFixed(1)} kt then. ` +
              `Check today's ops log for the trigger.`,
      });
    }
  }

  // ── 3. Trend reversal ──────────────────────────────────────────
  // Was climbing on most recent ≥3 days, then most recent delta is
  // negative. Looks for the inflection — three consecutive climbing
  // days followed by a fall is the canonical "things were going well
  // until they weren't" signal.
  if (snaps.length >= 5) {
    const last6 = snaps.slice(-6);
    const deltas = [];
    for (let i = 1; i < last6.length; i += 1) {
      deltas.push(last6[i].eom_tonnes - last6[i - 1].eom_tonnes);
    }
    // Look at the deltas BEFORE the most recent two — those are the
    // "background" days. Then check the most recent delta is negative.
    // For 5 deltas: [d-4, d-3, d-2, d-1, d-0]. Background = d-4..d-2,
    // recent = d-0. If background ≥ 2 of 3 climbing AND d-0 < 0 → flag.
    const recent     = deltas[deltas.length - 1];
    const background = deltas.slice(0, Math.max(0, deltas.length - 2));
    const climbing   = background.filter((d) => d >= 0).length;
    if (recent < 0 && climbing >= Math.ceil(background.length * 0.66)) {
      const todayDrop = Math.abs(recent);
      out.push({
        id: 'obs-forecast-trend-reversal',
        severity: 'info',
        body: `Forecast trend reversed — was climbing for ${climbing} of the prior ${background.length} days, then fell ${todayDrop.toLocaleString()} t. ` +
              `Trajectory bears watching this week.`,
      });
    }
  }

  return out;
}

module.exports = { detect };
