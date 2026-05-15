'use strict';

/*
 * convoyState — Phase 101.
 *
 * Durable record of convoys dispatched through the AXIS platform.
 * These sit on top of the mock ACTIVE_CONVOYS: the GET /api/convoys
 * response merges live dispatched convoys (shown first, is_live: true)
 * with the mock baseline (demo richness when no live entries exist).
 *
 * Lifecycle: loading → laden → offload → complete
 *   dispatch()  → phase: 'loading', actual_departure_iso: null
 *   depart()    → phase: 'laden',   actual_departure_iso: now
 *   updatePhase() → any valid phase transition
 *   arrive()    → phase: 'complete', arrived_at_iso: now
 *
 * convoy_ref is auto-generated: 'CVY-MMDD-NNN' (e.g. CVY-0513-001)
 * where NNN is a zero-padded count of today's dispatches.
 *
 * Only non-complete convoys appear in listActive(); the full ledger
 * is available via listAll() for audit / history views.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS convoy_dispatches (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    convoy_ref           TEXT NOT NULL,
    hauler_id            TEXT NOT NULL,
    truck_count          INTEGER NOT NULL,
    cargo_tonnes         REAL,
    direction            TEXT NOT NULL DEFAULT 'southbound',
    phase                TEXT NOT NULL DEFAULT 'loading',
    notes                TEXT,
    planned_departure_iso TEXT,
    actual_departure_iso  TEXT,
    arrived_at_iso        TEXT,
    delivered_tonnes      REAL,
    dispatched_by_id     TEXT NOT NULL,
    dispatched_by_name   TEXT NOT NULL,
    dispatched_at        TEXT NOT NULL
  );
`);

// Phase 113 — idempotent column addition for existing databases.
try { db.exec(`ALTER TABLE convoy_dispatches ADD COLUMN delivered_tonnes REAL`); } catch (_) { /* column already exists */ }

const VALID_PHASES = ['loading', 'laden', 'offload', 'complete'];
const VALID_DIRS   = ['southbound', 'northbound'];

// ── Prepared statements ────────────────────────────────────────────

const insertStmt = db.prepare(`
  INSERT INTO convoy_dispatches
    (convoy_ref, hauler_id, truck_count, cargo_tonnes, direction, phase,
     notes, planned_departure_iso, dispatched_by_id, dispatched_by_name,
     dispatched_at)
  VALUES
    (@convoy_ref, @hauler_id, @truck_count, @cargo_tonnes, @direction, 'loading',
     @notes, @planned_departure_iso, @dispatched_by_id, @dispatched_by_name,
     @dispatched_at)
`);

const departStmt = db.prepare(`
  UPDATE convoy_dispatches
     SET actual_departure_iso = @ts,
         phase = 'laden'
   WHERE id = @id AND actual_departure_iso IS NULL
`);

const phaseStmt = db.prepare(`
  UPDATE convoy_dispatches
     SET phase = @phase
   WHERE id = @id
`);

const arriveStmt = db.prepare(`
  UPDATE convoy_dispatches
     SET arrived_at_iso   = @ts,
         phase            = 'complete',
         delivered_tonnes = COALESCE(@delivered_tonnes, delivered_tonnes)
   WHERE id = @id AND arrived_at_iso IS NULL
`);

const activeStmt  = db.prepare(`
  SELECT * FROM convoy_dispatches
   WHERE phase != 'complete'
   ORDER BY dispatched_at DESC
`);

const allStmt = db.prepare(`
  SELECT * FROM convoy_dispatches
   ORDER BY dispatched_at DESC
   LIMIT 100
`);

const byIdStmt = db.prepare('SELECT * FROM convoy_dispatches WHERE id = ?');

// Phase 112 — daily southbound tonnage for the throughput strip.
// Phase 113 — prefer delivered_tonnes over cargo_tonnes (dispatch estimate) when recorded.
const todayTonnageStmt = db.prepare(`
  SELECT
    COALESCE(SUM(COALESCE(delivered_tonnes, cargo_tonnes)), 0) AS total_tonnes,
    COUNT(*)                                                   AS convoy_count
  FROM convoy_dispatches
  WHERE dispatched_at >= @day_start
    AND dispatched_at <  @day_end
    AND direction = 'southbound'
`);

// Phase 114 — same query grouped by hauler for the per-hauler breakdown.
const todayTonnageByHaulerStmt = db.prepare(`
  SELECT
    hauler_id,
    COALESCE(SUM(COALESCE(delivered_tonnes, cargo_tonnes)), 0) AS total_tonnes,
    COUNT(*) AS convoy_count
  FROM convoy_dispatches
  WHERE dispatched_at >= @day_start
    AND dispatched_at <  @day_end
    AND direction = 'southbound'
  GROUP BY hauler_id
  ORDER BY total_tonnes DESC
`);

// Phase 117 — month-to-date southbound tonnage for the Contract page.
const monthTonnageStmt = db.prepare(`
  SELECT
    COALESCE(SUM(COALESCE(delivered_tonnes, cargo_tonnes)), 0) AS total_tonnes,
    COUNT(*) AS convoy_count
  FROM convoy_dispatches
  WHERE dispatched_at >= @month_start
    AND dispatched_at <  @month_end
    AND direction = 'southbound'
`);

const countTodayStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM convoy_dispatches
   WHERE dispatched_at >= @day_start
`);

// Phase 118 — all dispatches for a given day (including complete), for the Today schedule strip.
const todayDispatchesStmt = db.prepare(`
  SELECT * FROM convoy_dispatches
   WHERE dispatched_at >= @day_start
     AND dispatched_at <  @day_end
   ORDER BY COALESCE(planned_departure_iso, dispatched_at) ASC
`);

// Phase 123 — completed convoys for the Trips ledger.
const completedTripsStmt = db.prepare(`
  SELECT * FROM convoy_dispatches
   WHERE phase = 'complete'
     AND arrived_at_iso IS NOT NULL
   ORDER BY arrived_at_iso DESC
   LIMIT 100
`);

const completedTripsByHaulerStmt = db.prepare(`
  SELECT * FROM convoy_dispatches
   WHERE phase = 'complete'
     AND arrived_at_iso IS NOT NULL
     AND hauler_id = ?
   ORDER BY arrived_at_iso DESC
   LIMIT 100
`);

// Phase 125 — per-hauler live stats (active count + today completed).
const liveStatsByHaulerStmt = db.prepare(`
  SELECT
    hauler_id,
    COUNT(*) FILTER (WHERE phase != 'complete') AS active_count,
    COUNT(*) FILTER (WHERE phase = 'complete' AND arrived_at_iso >= @day_start) AS completed_today,
    COALESCE(
      SUM(COALESCE(delivered_tonnes, cargo_tonnes)) FILTER (WHERE phase = 'complete' AND arrived_at_iso >= @day_start),
      0
    ) AS delivered_today_t
  FROM convoy_dispatches
  GROUP BY hauler_id
`);

// ── Ref generator ──────────────────────────────────────────────────

function genRef(now) {
  const d = now || new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const prefix = `${mm}${dd}`;
  const dayStart = `${d.getUTCFullYear()}-${mm}-${dd}T00:00:00.000Z`;
  const { n } = countTodayStmt.get({ day_start: dayStart });
  const seq = String(n + 1).padStart(3, '0');
  return `CVY-${prefix}-${seq}`;
}

// ── Shape ──────────────────────────────────────────────────────────

// Phase 119 — overdue thresholds.
// loading: overdue if planned departure was >60 min ago and convoy hasn't departed.
// laden:   overdue if departure was >16 h ago (300 km at ~20 km/h avg).
// offload: overdue if departure was >18 h ago (includes offloading margin).
const OVERDUE_LOADING_H  = 1;
const OVERDUE_LADEN_H    = 16;
const OVERDUE_OFFLOAD_H  = 18;

function computeOverdue(row) {
  if (row.phase === 'complete') return { is_overdue: false, overdue_hours: null };
  const nowMs = Date.now();
  if (row.phase === 'loading') {
    const ref = row.planned_departure_iso ?? row.dispatched_at;
    if (!ref) return { is_overdue: false, overdue_hours: null };
    const elapsed = (nowMs - new Date(ref).getTime()) / 3_600_000;
    return elapsed > OVERDUE_LOADING_H
      ? { is_overdue: true,  overdue_hours: Math.round((elapsed - OVERDUE_LOADING_H) * 10) / 10 }
      : { is_overdue: false, overdue_hours: null };
  }
  if (row.phase === 'laden' || row.phase === 'offload') {
    if (!row.actual_departure_iso) return { is_overdue: false, overdue_hours: null };
    const threshold = row.phase === 'laden' ? OVERDUE_LADEN_H : OVERDUE_OFFLOAD_H;
    const elapsed   = (nowMs - new Date(row.actual_departure_iso).getTime()) / 3_600_000;
    return elapsed > threshold
      ? { is_overdue: true,  overdue_hours: Math.round((elapsed - threshold) * 10) / 10 }
      : { is_overdue: false, overdue_hours: null };
  }
  return { is_overdue: false, overdue_hours: null };
}

function shape(row) {
  if (!row) return null;
  const overdue = computeOverdue(row);
  return {
    // Mirror the mock ACTIVE_CONVOYS shape so the client renders uniformly
    id:                    `live-${row.id}`,
    _db_id:                row.id,
    convoy_ref:            row.convoy_ref,
    hauler_id:             row.hauler_id,
    trucks:                row.truck_count,
    cargo_tonnes:          row.cargo_tonnes,
    direction:             row.direction,
    phase:                 row.phase,
    notes:                 row.notes || '',
    planned_departure_iso: row.planned_departure_iso,
    actual_departure_iso:  row.actual_departure_iso,
    arrived_at_iso:        row.arrived_at_iso,
    delivered_tonnes:      row.delivered_tonnes ?? null,
    dispatched_by_name:    row.dispatched_by_name,
    dispatched_at:         row.dispatched_at,
    // Live convoys don't have real GPS km data — show at origin
    km:            row.direction === 'northbound' ? 300 : 0,
    last_ping_iso: row.dispatched_at,
    on_schedule:   !overdue.is_overdue,
    cycle_h:       null,
    is_live:       true,
    is_overdue:    overdue.is_overdue,
    overdue_hours: overdue.overdue_hours,
  };
}

// ── API ────────────────────────────────────────────────────────────

function dispatch({ hauler_id, truck_count, cargo_tonnes, direction, notes,
  planned_departure_iso, dispatched_by_id, dispatched_by_name }) {
  if (!hauler_id) throw new Error('hauler_id required');
  const tc = parseInt(truck_count, 10);
  if (!Number.isFinite(tc) || tc < 1) throw new Error('truck_count must be ≥ 1');
  if (!VALID_DIRS.includes(direction)) throw new Error(`direction must be one of: ${VALID_DIRS.join(', ')}`);

  const now = new Date().toISOString();
  const ref = genRef(new Date());

  const result = insertStmt.run({
    convoy_ref:            ref,
    hauler_id,
    truck_count:           tc,
    cargo_tonnes:          cargo_tonnes != null ? Number(cargo_tonnes) : null,
    direction:             direction || 'southbound',
    notes:                 notes || null,
    planned_departure_iso: planned_departure_iso || null,
    dispatched_by_id,
    dispatched_by_name,
    dispatched_at:         now,
  });

  return shape(byIdStmt.get(result.lastInsertRowid));
}

function depart(dbId) {
  const ts = new Date().toISOString();
  departStmt.run({ id: dbId, ts });
  return shape(byIdStmt.get(dbId));
}

function updatePhase(dbId, phase) {
  if (!VALID_PHASES.includes(phase)) throw new Error(`phase must be one of: ${VALID_PHASES.join(', ')}`);
  phaseStmt.run({ id: dbId, phase });
  return shape(byIdStmt.get(dbId));
}

function arrive(dbId, { delivered_tonnes } = {}) {
  const ts = new Date().toISOString();
  const dt = delivered_tonnes != null ? Number(delivered_tonnes) : null;
  arriveStmt.run({ id: dbId, ts, delivered_tonnes: dt });
  return shape(byIdStmt.get(dbId));
}

function listActive() {
  return activeStmt.all().map(shape);
}

function listAll() {
  return allStmt.all().map(shape);
}

function findById(dbId) {
  return shape(byIdStmt.get(dbId));
}

/**
 * Phase 112/113 — total southbound cargo tonnes dispatched on a given UTC date.
 * Prefers delivered_tonnes over cargo_tonnes when recorded at arrival.
 * @param {string} dateKey — 'YYYY-MM-DD' (UTC = Africa/Accra)
 * @returns {{ total_tonnes: number, convoy_count: number }}
 */
function todayTonnage(dateKey) {
  const day_start = `${dateKey}T00:00:00.000Z`;
  const day_end   = `${dateKey}T24:00:00.000Z`; // exclusive upper bound
  return todayTonnageStmt.get({ day_start, day_end });
}

/**
 * Phase 114 — per-hauler southbound tonnage breakdown for a given UTC date.
 * @param {string} dateKey — 'YYYY-MM-DD'
 * @returns {Array<{ hauler_id: string, total_tonnes: number, convoy_count: number }>}
 */
function todayTonnageByHauler(dateKey) {
  const day_start = `${dateKey}T00:00:00.000Z`;
  const day_end   = `${dateKey}T24:00:00.000Z`;
  return todayTonnageByHaulerStmt.all({ day_start, day_end });
}

/**
 * Phase 117 — southbound tonnage for a calendar month (UTC).
 * @param {string} yearMonth — 'YYYY-MM'
 * @returns {{ total_tonnes: number, convoy_count: number }}
 */
function monthTonnage(yearMonth) {
  const month_start = `${yearMonth}-01T00:00:00.000Z`;
  // Simple upper bound: use next month's first day.
  const [y, m] = yearMonth.split('-').map(Number);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const month_end = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00.000Z`;
  return monthTonnageStmt.get({ month_start, month_end });
}

/**
 * Phase 118 — all convoy dispatches for a given UTC date (any phase, incl. complete).
 * Sorted by planned departure time ascending so the Today schedule reads top-to-bottom.
 * @param {string} dateKey — 'YYYY-MM-DD'
 * @returns {object[]}
 */
function todayDispatches(dateKey) {
  const day_start = `${dateKey}T00:00:00.000Z`;
  const day_end   = `${dateKey}T24:00:00.000Z`;
  return todayDispatchesStmt.all({ day_start, day_end }).map(shape);
}

// ── Phase 123 — shape completed convoy rows as trip-like objects ─────

function shapeAsTrip(row) {
  const dept    = row.actual_departure_iso;
  const arr     = row.arrived_at_iso;
  const cycleH  = dept && arr
    ? Math.round((new Date(arr) - new Date(dept)) / 360_000) / 10
    : 0;
  const delayMin = row.planned_departure_iso && dept
    ? Math.max(0, Math.round((new Date(dept) - new Date(row.planned_departure_iso)) / 60_000))
    : 0;
  const tonnage = row.delivered_tonnes ?? row.cargo_tonnes ?? 0;
  const direction = row.direction;
  return {
    id:           row.convoy_ref,
    hauler_id:    row.hauler_id,
    route_id:     direction === 'southbound' ? 'NYI-TAK' : 'TAK-NYI',
    route_label:  direction === 'southbound' ? 'Nyinahin → Takoradi' : 'Takoradi → Nyinahin',
    direction,
    departed_at:  dept,
    arrived_at:   arr,
    cycle_h:      cycleH,
    tonnage_t:    tonnage,
    delay_min:    delayMin,
    status:       delayMin > 60 ? 'delayed' : 'completed',
    cost:         { fuel_usd: 0, driver_usd: 0, maint_usd: 0, tolls_usd: 0, total_usd: null },
    revenue_usd:  0,
    notes:        row.notes || '',
    is_live:      true,
  };
}

/**
 * Phase 123 — completed convoy dispatches shaped as trip ledger rows.
 * Blended at the head of the Trips page ledger; excluded from mock cost aggregations.
 */
function liveCompletedTrips(haulerIdOpt) {
  const rows = haulerIdOpt
    ? completedTripsByHaulerStmt.all(haulerIdOpt)
    : completedTripsStmt.all();
  return rows.map(shapeAsTrip);
}

/**
 * Phase 125 — per-hauler live stats for the Haulers page strip.
 * Returns an object keyed by hauler_id.
 */
function liveHaulerStats() {
  const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const rows = liveStatsByHaulerStmt.all({ day_start: todayStart });
  return Object.fromEntries(
    rows.map((r) => [r.hauler_id, {
      active_count:     r.active_count,
      completed_today:  r.completed_today,
      delivered_today_t: r.delivered_today_t,
    }]),
  );
}

module.exports = { dispatch, depart, updatePhase, arrive, listActive, listAll, findById,
                   todayTonnage, todayTonnageByHauler, monthTonnage, todayDispatches,
                   liveCompletedTrips, liveHaulerStats };
