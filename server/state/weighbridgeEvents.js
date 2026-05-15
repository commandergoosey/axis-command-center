'use strict';

/*
 * weighbridgeEvents — Phase 116.
 *
 * Live weighbridge hold events logged by axis_ops / axis_admin.
 * These supplement the mock axle-load events in the Compliance page
 * and are the authoritative record of corridor overload incidents.
 *
 * Schema
 *   id              INTEGER PRIMARY KEY AUTOINCREMENT
 *   rig_id          TEXT                 — internal rig id (optional if plate only known)
 *   plate           TEXT NOT NULL        — truck plate as read at weighbridge
 *   hauler_id       TEXT
 *   gross_weight_t  REAL NOT NULL        — GVW recorded at weighbridge
 *   limit_t         REAL NOT NULL        — legal limit at that weighbridge (default 60T GVW)
 *   overage_t       REAL                 — computed: gross_weight_t - limit_t
 *   hold_minutes    INTEGER              — time truck was held before permitted to continue
 *   weighbridge     TEXT                 — name / location of weighbridge
 *   notes           TEXT
 *   logged_by_id    TEXT
 *   logged_by_name  TEXT
 *   logged_at       TEXT NOT NULL        — ISO-8601
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS weighbridge_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    rig_id         TEXT,
    plate          TEXT NOT NULL,
    hauler_id      TEXT,
    gross_weight_t REAL NOT NULL,
    limit_t        REAL NOT NULL DEFAULT 60,
    overage_t      REAL,
    hold_minutes   INTEGER,
    weighbridge    TEXT,
    notes          TEXT,
    logged_by_id   TEXT,
    logged_by_name TEXT,
    logged_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_wb_logged_at
    ON weighbridge_events (logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wb_hauler
    ON weighbridge_events (hauler_id, logged_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO weighbridge_events
    (rig_id, plate, hauler_id, gross_weight_t, limit_t, overage_t,
     hold_minutes, weighbridge, notes, logged_by_id, logged_by_name, logged_at)
  VALUES
    (@rig_id, @plate, @hauler_id, @gross_weight_t, @limit_t, @overage_t,
     @hold_minutes, @weighbridge, @notes, @logged_by_id, @logged_by_name, @logged_at)
`);

const byIdStmt = db.prepare('SELECT * FROM weighbridge_events WHERE id = ?');

const recentStmt = db.prepare(`
  SELECT * FROM weighbridge_events
  ORDER BY logged_at DESC
  LIMIT ?
`);

const sinceStmt = db.prepare(`
  SELECT * FROM weighbridge_events
  WHERE logged_at >= ?
  ORDER BY logged_at DESC
`);

// 30-day summary used by the compliance route.
const summaryStmt = db.prepare(`
  SELECT
    COUNT(*)               AS event_count,
    SUM(overage_t)         AS total_overage_t,
    AVG(hold_minutes)      AS avg_hold_minutes,
    COUNT(DISTINCT rig_id) AS affected_rigs
  FROM weighbridge_events
  WHERE logged_at >= ?
`);

function shape(row) {
  if (!row) return null;
  return {
    id:            row.id,
    rig_id:        row.rig_id ?? null,
    plate:         row.plate,
    hauler_id:     row.hauler_id ?? null,
    gross_weight_t: row.gross_weight_t,
    limit_t:       row.limit_t,
    overage_t:     row.overage_t,
    hold_minutes:  row.hold_minutes ?? null,
    weighbridge:   row.weighbridge ?? null,
    notes:         row.notes ?? null,
    logged_by_name: row.logged_by_name ?? null,
    logged_at:     row.logged_at,
    is_live:       true,
  };
}

module.exports = {
  /**
   * Log a new weighbridge hold event.
   * @param {object} data
   * @returns {object} The inserted event.
   */
  add(data) {
    const limitT  = Number(data.limit_t ?? 60);
    const grossT  = Number(data.gross_weight_t);
    const overage = Math.round((grossT - limitT) * 10) / 10;

    const row = {
      rig_id:         data.rig_id        ?? null,
      plate:          data.plate,
      hauler_id:      data.hauler_id     ?? null,
      gross_weight_t: grossT,
      limit_t:        limitT,
      overage_t:      overage > 0 ? overage : 0,
      hold_minutes:   data.hold_minutes != null ? parseInt(data.hold_minutes, 10) : null,
      weighbridge:    data.weighbridge   ?? null,
      notes:          data.notes         ?? null,
      logged_by_id:   data.logged_by_id  ?? null,
      logged_by_name: data.logged_by_name ?? null,
      logged_at:      data.logged_at     ?? new Date().toISOString(),
    };
    const { lastInsertRowid } = insertStmt.run(row);
    return shape(byIdStmt.get(lastInsertRowid));
  },

  /**
   * Recent events (for the compliance page table).
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  recent(limit = 50) {
    return recentStmt.all(limit).map(shape);
  },

  /**
   * Events since a given ISO timestamp.
   * @param {string} sinceIso
   * @returns {object[]}
   */
  since(sinceIso) {
    return sinceStmt.all(sinceIso).map(shape);
  },

  /**
   * Aggregate summary for a rolling window (used by compliance route).
   * @param {string} sinceIso
   * @returns {{ event_count, total_overage_t, avg_hold_minutes, affected_rigs, has_live_data }}
   */
  summary(sinceIso) {
    const r = summaryStmt.get(sinceIso);
    return {
      event_count:     r.event_count,
      total_overage_t: r.total_overage_t != null ? Math.round(r.total_overage_t * 10) / 10 : 0,
      avg_hold_minutes: r.avg_hold_minutes != null ? Math.round(r.avg_hold_minutes) : null,
      affected_rigs:   r.affected_rigs,
      has_live_data:   r.event_count > 0,
    };
  },
};
