'use strict';

/*
 * Corridor health scorer — LP-24.
 *
 * Computes a 0–100 health score for the corridor from real operational data:
 *
 *   Component              Weight  Source
 *   ─────────────────────  ──────  ──────────────────────────────────────
 *   On-time trip rate       40 %   trips completed in last 7 days
 *   Alert severity load     30 %   active CRITICAL/HIGH alerts (inverted)
 *   Position freshness      30 %   fraction of vehicles with pos < 45 min
 *
 * Called nightly by node-cron at 00:30 UTC (wired in index.js).
 * Also exposed as score(date) / scoreRange(from, to) for the corridor route.
 */

const db             = require('../db');
const positionStore  = require('../state/positionStore');
const log            = require('./logger');

const CYCLE_TARGET_MIN = parseInt(process.env.CYCLE_TARGET_HOURS ?? '26', 10) * 60;
const MAX_ALERTS       = parseInt(process.env.HEALTH_MAX_ALERTS    ?? '10', 10);
const POS_MAX_AGE_MIN  = 45;

/* ── DB statements ───────────────────────────────────────────────── */

// Run after the migration has created the table.
let stmts = null;
function getStmts() {
  if (stmts) return stmts;
  stmts = {
    upsert: db.prepare(`
      INSERT INTO corridor_health (date, score, on_time_rate, alert_load, pos_freshness, components, computed_at)
      VALUES (@date, @score, @on_time_rate, @alert_load, @pos_freshness, @components, @computed_at)
      ON CONFLICT(date) DO UPDATE SET
        score         = excluded.score,
        on_time_rate  = excluded.on_time_rate,
        alert_load    = excluded.alert_load,
        pos_freshness = excluded.pos_freshness,
        components    = excluded.components,
        computed_at   = excluded.computed_at
    `),
    byDate: db.prepare('SELECT * FROM corridor_health WHERE date = ?'),
    range:  db.prepare(`
      SELECT * FROM corridor_health
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `),
    tripsWindow: db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN duration_min <= @target THEN 1 ELSE 0 END) AS on_time
      FROM trips
      WHERE status = 'completed'
        AND departed_at >= @since
    `),
    activeAlerts: db.prepare(`
      SELECT COUNT(*) AS n FROM alert_state
      WHERE severity IN ('critical','high')
        AND resolved_at IS NULL
    `),
  };
  return stmts;
}

/* ── Score computation ───────────────────────────────────────────── */

function computeScore(date) {
  const s = getStmts();
  const ts = new Date().toISOString();

  // --- Component 1: on-time trip rate (7-day window) ---
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let on_time_rate = 1; // default perfect if no trip data
  try {
    const row = s.tripsWindow.get({ target: CYCLE_TARGET_MIN, since: since7d });
    if (row.total > 0) on_time_rate = row.on_time / row.total;
  } catch (_) {}

  // --- Component 2: active critical/high alert load (inverted) ---
  let alert_load = 1; // default perfect if no alert data
  try {
    const row = s.activeAlerts.get();
    // Linearly penalise: 0 alerts → 1.0, MAX_ALERTS+ → 0.0
    alert_load = Math.max(0, 1 - row.n / MAX_ALERTS);
  } catch (_) {}

  // --- Component 3: position freshness ---
  let pos_freshness = 1;
  try {
    const all   = positionStore.all();
    const stale = positionStore.staleCount(POS_MAX_AGE_MIN);
    if (all.length > 0) pos_freshness = Math.max(0, 1 - stale / all.length);
  } catch (_) {}

  // Weighted composite, rounded to integer.
  const raw   = on_time_rate * 0.40 + alert_load * 0.30 + pos_freshness * 0.30;
  const score = Math.min(100, Math.max(0, Math.round(raw * 100)));

  const components = JSON.stringify({
    on_time_rate:  Number(on_time_rate.toFixed(3)),
    alert_load:    Number(alert_load.toFixed(3)),
    pos_freshness: Number(pos_freshness.toFixed(3)),
    weights:       { on_time: 0.40, alert: 0.30, pos: 0.30 },
  });

  s.upsert.run({ date, score, on_time_rate, alert_load, pos_freshness, components, computed_at: ts });
  log.info('Health scorer: computed', { date, score, on_time_rate, alert_load, pos_freshness });
  return { date, score, on_time_rate, alert_load, pos_freshness };
}

/** Compute and store today's score. Called nightly by cron. */
function run() {
  const today = new Date().toISOString().slice(0, 10);
  return computeScore(today);
}

/** Retrieve a stored score for one date. Returns null if not yet computed. */
function get(date) {
  try { return getStmts().byDate.get(date) ?? null; }
  catch (_) { return null; }
}

/**
 * Retrieve scores for a range of dates.
 * Returns stored rows; gaps (dates without a row) are not filled here —
 * the caller (corridor route) fills them with the seeded fallback.
 */
function getRange(from, to) {
  try { return getStmts().range.all(from, to); }
  catch (_) { return []; }
}

module.exports = { run, get, getRange, computeScore };
