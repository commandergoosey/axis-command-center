'use strict';

/*
 * fuelLogs — Phase 111.
 *
 * Operational fuel fill log per rig. Hauler admins (and AXIS ops) record
 * fill events as they happen; these become the live source that the Diesel
 * Watch analytics can eventually draw from rather than purely mock data.
 *
 * Schema
 *   id              INTEGER PK AUTOINCREMENT
 *   rig_id          TEXT NOT NULL
 *   hauler_id       TEXT NOT NULL
 *   litres          REAL NOT NULL        — litres dispensed
 *   cost_ghs        REAL                 — GHS paid at pump (optional)
 *   odometer_km     REAL                 — reading at fill (optional)
 *   notes           TEXT
 *   logged_by_id    TEXT
 *   logged_by_name  TEXT
 *   logged_at       TEXT NOT NULL        — ISO-8601
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS fuel_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    rig_id         TEXT NOT NULL,
    hauler_id      TEXT NOT NULL,
    litres         REAL NOT NULL,
    cost_ghs       REAL,
    odometer_km    REAL,
    notes          TEXT,
    logged_by_id   TEXT,
    logged_by_name TEXT,
    logged_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_fuel_rig
    ON fuel_logs (rig_id, logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fuel_hauler
    ON fuel_logs (hauler_id, logged_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO fuel_logs
    (rig_id, hauler_id, litres, cost_ghs, odometer_km,
     notes, logged_by_id, logged_by_name, logged_at)
  VALUES
    (@rig_id, @hauler_id, @litres, @cost_ghs, @odometer_km,
     @notes, @logged_by_id, @logged_by_name, @logged_at)
`);

const byRigStmt = db.prepare(`
  SELECT * FROM fuel_logs
  WHERE rig_id = ?
  ORDER BY logged_at DESC
  LIMIT ?
`);

const summaryByHaulerStmt = db.prepare(`
  SELECT
    rig_id,
    COUNT(*)                 AS fill_count,
    SUM(litres)              AS total_litres,
    SUM(cost_ghs)            AS total_cost_ghs,
    MAX(odometer_km)         AS last_odometer_km,
    MAX(logged_at)           AS last_fill_at
  FROM fuel_logs
  WHERE hauler_id = ?
    AND logged_at >= ?
  GROUP BY rig_id
`);

const recentByHaulerStmt = db.prepare(`
  SELECT * FROM fuel_logs
  WHERE hauler_id = ?
  ORDER BY logged_at DESC
  LIMIT ?
`);

// Phase 115 — corridor-wide aggregate for the Diesel page.
// Returns total fills + litres + cost, optionally within a time window,
// plus a per-hauler breakdown for variance analysis.
const corridorTotalStmt = db.prepare(`
  SELECT
    COUNT(*)       AS fill_count,
    COALESCE(SUM(litres), 0)    AS total_litres,
    COALESCE(SUM(cost_ghs), 0)  AS total_cost_ghs
  FROM fuel_logs
  WHERE logged_at >= @since_iso
`);

const corridorByHaulerStmt = db.prepare(`
  SELECT
    hauler_id,
    COUNT(*)       AS fill_count,
    COALESCE(SUM(litres), 0)   AS total_litres,
    COALESCE(SUM(cost_ghs), 0) AS total_cost_ghs,
    MAX(logged_at) AS last_fill_at
  FROM fuel_logs
  WHERE logged_at >= @since_iso
  GROUP BY hauler_id
  ORDER BY total_litres DESC
`);

module.exports = {
  /**
   * Record a fuel fill event.
   * @param {object} data
   * @returns {object} The inserted row with its generated id.
   */
  add(data) {
    const row = {
      rig_id:         data.rig_id,
      hauler_id:      data.hauler_id,
      litres:         Number(data.litres),
      cost_ghs:       data.cost_ghs   != null ? Number(data.cost_ghs)   : null,
      odometer_km:    data.odometer_km != null ? Number(data.odometer_km) : null,
      notes:          data.notes ?? null,
      logged_by_id:   data.logged_by_id   ?? null,
      logged_by_name: data.logged_by_name ?? null,
      logged_at:      data.logged_at ?? new Date().toISOString(),
    };
    const { lastInsertRowid } = insertStmt.run(row);
    return { id: Number(lastInsertRowid), ...row };
  },

  /**
   * Get the most recent fills for a rig (default: last 10).
   * @param {string} rigId
   * @param {number} [limit=10]
   * @returns {object[]}
   */
  getByRig(rigId, limit = 10) {
    return byRigStmt.all(rigId, limit);
  },

  /**
   * Per-rig fill summary for a hauler over a rolling window.
   * @param {string} haulerId
   * @param {string} [sinceIso] — defaults to 30 days ago
   * @returns {object[]}
   */
  summaryByHauler(haulerId, sinceIso) {
    const since = sinceIso ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return summaryByHaulerStmt.all(haulerId, since);
  },

  /**
   * Recent fills across a whole hauler's fleet.
   * @param {string} haulerId
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  recentByHauler(haulerId, limit = 50) {
    return recentByHaulerStmt.all(haulerId, limit);
  },

  /**
   * Phase 115 — corridor-wide fuel summary for the Diesel page.
   * @param {object} [opts]
   * @param {string} [opts.since_iso] — defaults to 30 days ago
   * @returns {{ fill_count, total_litres, total_cost_ghs, has_live_data, by_hauler[] }}
   */
  corridorSummary({ since_iso } = {}) {
    const sinceIso = since_iso ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const totals   = corridorTotalStmt.get({ since_iso: sinceIso });
    const by_hauler = corridorByHaulerStmt.all({ since_iso: sinceIso });
    return {
      fill_count:     totals.fill_count,
      total_litres:   Math.round(totals.total_litres * 10) / 10,
      total_cost_ghs: totals.total_cost_ghs > 0 ? Math.round(totals.total_cost_ghs * 100) / 100 : null,
      has_live_data:  totals.fill_count > 0,
      since_iso:      sinceIso,
      by_hauler:      by_hauler.map((r) => ({
        hauler_id:      r.hauler_id,
        fill_count:     r.fill_count,
        total_litres:   Math.round(r.total_litres * 10) / 10,
        total_cost_ghs: r.total_cost_ghs > 0 ? Math.round(r.total_cost_ghs * 100) / 100 : null,
        last_fill_at:   r.last_fill_at,
      })),
    };
  },
};
