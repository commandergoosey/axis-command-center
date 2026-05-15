'use strict';

/*
 * Per-hauler integration state — tokens, credentials, last probe, manual
 * CSV buffers.
 *
 * Durable via SQLite (integration_state table). Credentials and probe results
 * survive server restarts; csv_rows are intentionally NOT persisted — they are
 * large transient upload buffers that should be re-uploaded fresh each session.
 *
 * Write-through cache pattern:
 *   - ensure(id) seeds from DB if not already in the in-memory cache
 *   - every mutation writes through to DB immediately
 *   - reads are served from cache (populated on first access per hauler)
 *
 * Credentials are never returned through the API; only a
 * { has_credentials, live, last_probe, last_sync } summary is exposed.
 */

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS integration_state (
    hauler_id       TEXT PRIMARY KEY,
    creds_json      TEXT,
    last_probe_json TEXT,
    last_sync       TEXT,
    live            INTEGER NOT NULL DEFAULT 0
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO integration_state (hauler_id, creds_json, last_probe_json, last_sync, live)
    VALUES (@hauler_id, @creds_json, @last_probe_json, @last_sync, @live)
  ON CONFLICT (hauler_id) DO UPDATE SET
    creds_json      = excluded.creds_json,
    last_probe_json = excluded.last_probe_json,
    last_sync       = excluded.last_sync,
    live            = excluded.live
`);

const byIdStmt = db.prepare('SELECT * FROM integration_state WHERE hauler_id = ?');

// In-memory cache. csv_rows are NOT in the DB schema — they are large transient
// upload buffers that start empty on every boot and are overwritten on each upload.
const cache = new Map();

function loadFromDb(id) {
  const row = byIdStmt.get(id);
  const entry = {
    creds:      row?.creds_json      ? JSON.parse(row.creds_json)      : null,
    last_probe: row?.last_probe_json ? JSON.parse(row.last_probe_json) : null,
    last_sync:  row?.last_sync       ?? null,
    live:       row ? !!row.live : false,
    csv_rows:   [],  // always empty at boot — not persisted
  };
  cache.set(id, entry);
  return entry;
}

function ensure(id) {
  return cache.has(id) ? cache.get(id) : loadFromDb(id);
}

function persistEntry(id) {
  const s = cache.get(id);
  if (!s) return;
  upsertStmt.run({
    hauler_id:       id,
    creds_json:      s.creds      ? JSON.stringify(s.creds)      : null,
    last_probe_json: s.last_probe ? JSON.stringify(s.last_probe) : null,
    last_sync:       s.last_sync  ?? null,
    live:            s.live ? 1 : 0,
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

function summary(id) {
  const s = ensure(id);
  return {
    has_credentials: !!s.creds,
    live:            !!s.live,
    last_probe:      s.last_probe,
    last_sync:       s.last_sync,
    csv_rows:        s.csv_rows.length,
  };
}

function setCreds(id, creds) {
  const s = ensure(id);
  s.creds = creds;
  persistEntry(id);
}

function clearCreds(id) {
  const s = ensure(id);
  s.creds      = null;
  s.live       = false;
  s.last_probe = null;
  persistEntry(id);
}

function getCreds(id) {
  return ensure(id).creds || null;
}

function setProbe(id, probeResult) {
  const s = ensure(id);
  s.last_probe = probeResult;
  s.last_sync  = probeResult?.probed_at || s.last_sync;
  s.live       = !!probeResult?.live;
  persistEntry(id);
}

function setCsv(id, rows) {
  const s = ensure(id);
  s.csv_rows  = Array.isArray(rows) ? rows : [];
  s.last_sync = new Date().toISOString();
  // Persist last_sync update (csv_rows themselves are not stored).
  persistEntry(id);
}

function getState(id) {
  return ensure(id);
}

module.exports = {
  summary,
  setCreds,
  clearCreds,
  getCreds,
  setProbe,
  setCsv,
  getState,
  ensure,
};
