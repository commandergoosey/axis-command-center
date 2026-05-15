'use strict';

/*
 * Integration sync log — Phase 88.
 *
 * Per-attempt log of API syncs against each hauler's connector.
 * Each row: who tried, when, succeeded or failed, with latency
 * + error detail if it failed. Powers the integration health
 * panel — operators can see the trail rather than just a yellow
 * dot.
 *
 * Synthetic seed on boot: for each hauler in the roster, generate
 * 48h of attempts (every 5 minutes) with a success-rate matching
 * their declared api_status. Idempotent — only seeds when the
 * table is empty.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS integration_sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hauler_id       TEXT NOT NULL,
    attempted_at    TEXT NOT NULL,
    success         INTEGER NOT NULL,
    latency_ms      INTEGER,
    rows_synced     INTEGER,
    error_code      TEXT,
    error_message   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sync_log_hauler_time
    ON integration_sync_log (hauler_id, attempted_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO integration_sync_log (
    hauler_id, attempted_at, success, latency_ms, rows_synced, error_code, error_message
  ) VALUES (
    @hauler_id, @attempted_at, @success, @latency_ms, @rows_synced, @error_code, @error_message
  )
`);
const recentStmt = db.prepare(`
  SELECT * FROM integration_sync_log
   WHERE hauler_id = ? AND attempted_at >= ?
   ORDER BY attempted_at DESC, id DESC
   LIMIT ?
`);
const countSinceStmt = db.prepare(`
  SELECT
    COUNT(*) AS attempts,
    SUM(success) AS successes,
    AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) AS avg_latency_ms
  FROM integration_sync_log
  WHERE hauler_id = ? AND attempted_at >= ?
`);
const topErrorsStmt = db.prepare(`
  SELECT error_code, error_message, COUNT(*) AS n
    FROM integration_sync_log
   WHERE hauler_id = ? AND attempted_at >= ? AND success = 0
   GROUP BY error_code
   ORDER BY n DESC
   LIMIT 5
`);
const lastSuccessStmt = db.prepare(`
  SELECT * FROM integration_sync_log
   WHERE hauler_id = ? AND success = 1
   ORDER BY attempted_at DESC, id DESC
   LIMIT 1
`);
const totalCountStmt = db.prepare('SELECT COUNT(*) AS n FROM integration_sync_log');

// ── Synthetic seed ────────────────────────────────────────────────
//
// Boot-time fixture builder so the demo dashboard has realistic
// history. Mirrors the api_status field on the roster: connected
// haulers get ~99% success, degraded ~75%, failed ~30%, manual
// haulers get nothing (no API to attempt).

const SUCCESS_RATE_BY_STATUS = {
  connected: 0.99,
  degraded:  0.75,
  failed:    0.30,
  // anything else → no synthetic data
};

const ERROR_VARIANTS = [
  { code: 'TIMEOUT',          message: 'Upstream API did not respond within 5s' },
  { code: 'AUTH_REJECTED',    message: 'Bearer token rejected — check credential rotation' },
  { code: 'RATE_LIMITED',     message: 'Hit hauler API rate limit (429)' },
  { code: 'PARSE_ERROR',      message: 'Response payload missing expected `convoys` field' },
  { code: 'NETWORK_ERROR',    message: 'Connection reset by peer mid-response' },
];

// Deterministic pseudo-random keyed on hauler+attempt index so
// seeds are stable across boots.
function seededRandom(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function apiStatusOf(hauler) {
  // Inline copy of services/aggregator.apiStatusOf — avoids a
  // require() cycle (aggregator → forecast → roster → none of
  // these need the sync log).
  if (hauler.status === 'pending') return 'pending';
  if (hauler.integration?.type === 'manual') return 'manual';
  if ((hauler.integration?.error_count_24h || 0) > 0) return 'degraded';
  return 'connected';
}

function seedFor(haulers, now = Date.now()) {
  const ATTEMPT_INTERVAL_MS = 5 * 60 * 1000;        // every 5 minutes
  const HORIZON_MS = 48 * 60 * 60 * 1000;            // last 48h

  for (const h of haulers) {
    const status = apiStatusOf(h);
    const successRate = SUCCESS_RATE_BY_STATUS[status];
    if (successRate == null) continue;

    let seq = 0;
    for (let t = now - HORIZON_MS; t <= now; t += ATTEMPT_INTERVAL_MS) {
      seq++;
      const r = seededRandom(stringHash(h.id) + seq);
      const success = r < successRate;
      const latency = success
        ? Math.round(60 + seededRandom(seq + 1000) * 220)   // 60-280ms when healthy
        : null;
      const errIdx = success ? -1 : Math.floor(seededRandom(seq + 2000) * ERROR_VARIANTS.length);
      const err = errIdx >= 0 ? ERROR_VARIANTS[errIdx] : null;
      insertStmt.run({
        hauler_id:    h.id,
        attempted_at: new Date(t).toISOString(),
        success:      success ? 1 : 0,
        latency_ms:   latency,
        rows_synced:  success ? Math.round(seededRandom(seq + 3000) * 80) + 12 : 0,
        error_code:   err?.code ?? null,
        error_message: err?.message ?? null,
      });
    }
  }
}

function stringHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function ensureSeeded(haulers) {
  const { n } = totalCountStmt.get();
  if (n > 0) return;
  seedFor(haulers);
}

// ── Public API ────────────────────────────────────────────────────

function record({ hauler_id, success, latency_ms, rows_synced, error_code, error_message }) {
  insertStmt.run({
    hauler_id,
    attempted_at: new Date().toISOString(),
    success: success ? 1 : 0,
    latency_ms: latency_ms ?? null,
    rows_synced: rows_synced ?? null,
    error_code: error_code ?? null,
    error_message: error_message ?? null,
  });
}

function recent(hauler_id, hours = 24, limit = 50) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return recentStmt.all(hauler_id, since, limit);
}

function summaryForWindow(hauler_id, hours) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = countSinceStmt.get(hauler_id, since);
  const successes = row?.successes ?? 0;
  const attempts  = row?.attempts ?? 0;
  return {
    hours,
    attempts,
    successes,
    success_rate: attempts > 0 ? Number((successes / attempts * 100).toFixed(1)) : null,
    avg_latency_ms: row?.avg_latency_ms ? Math.round(row.avg_latency_ms) : null,
  };
}

function topErrors(hauler_id, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return topErrorsStmt.all(hauler_id, since);
}

function lastSuccess(hauler_id) {
  return lastSuccessStmt.get(hauler_id) ?? null;
}

function health(hauler_id) {
  return {
    last_24h:    summaryForWindow(hauler_id, 24),
    last_7d:     summaryForWindow(hauler_id, 24 * 7),
    top_errors:  topErrors(hauler_id, 24),
    last_success: lastSuccess(hauler_id),
    recent_attempts: recent(hauler_id, 24, 30),
  };
}

module.exports = {
  ensureSeeded, record, recent, health,
};
