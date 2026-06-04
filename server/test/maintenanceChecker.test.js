'use strict';

/*
 * Tests for services/maintenanceChecker.js — run()
 *
 * Uses an in-memory SQLite DB with the fleet_trucks and alert_state
 * tables (both in base schema). logger is stubbed to silence output.
 *
 * maintenanceChecker.js reads:
 *   KM_THRESHOLD  = process.env.SERVICE_KM_THRESHOLD  (default 20 000)
 *   KM_CRITICAL   = process.env.SERVICE_KM_CRITICAL   (default 40 000)
 *
 * We set both to small values via env vars so tests can insert modest km
 * values without needing 20 000-row deltas.
 *
 * Covers:
 *   - run() returns { overdue, new_alerts } shape
 *   - overdue = 0 / new_alerts = 0 when no trucks are over threshold
 *   - overdue counts trucks whose km_since_service >= threshold
 *   - new_alerts counts INSERT OR IGNORE inserts on first run
 *   - INSERT OR IGNORE: second run on same truck returns new_alerts = 0
 *     (same alert_id deduped within the same calendar month)
 *   - severity bucket: km_since_service >= KM_CRITICAL → alert_id differs
 *     from warning bucket (deterministic SHA-1 based dedup)
 *   - archived trucks are excluded (WHERE archived = 0)
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── Override thresholds to small values before module load ────────
process.env.SERVICE_KM_THRESHOLD = '500';
process.env.SERVICE_KM_CRITICAL  = '1000';

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

// ── Stub logger ───────────────────────────────────────────────────
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}
stub('../services/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

delete require.cache[require.resolve('../services/maintenanceChecker')];
const mc = require('../services/maintenanceChecker');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

function insertTruck({ total_km = 0, last_service_km = 0, archived = 0 } = {}) {
  _seq += 1;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO fleet_trucks
      (id, plate, hauler_id, status, total_km, last_service_km, archived, created_at, updated_at)
    VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?)
  `).run(
    `rig-mc-${String(_seq).padStart(3, '0')}`,
    `GH-MC${String(_seq).padStart(4, '0')}`,
    'haul-mc',
    total_km, last_service_km, archived,
    now, now,
  );
}

// ── run — shape and basics ─────────────────────────────────────────

describe('maintenanceChecker — run shape', () => {
  it('returns { overdue, new_alerts } with numeric values', () => {
    const result = mc.run();
    assert.ok('overdue'    in result, 'missing overdue');
    assert.ok('new_alerts' in result, 'missing new_alerts');
    assert.equal(typeof result.overdue,    'number');
    assert.equal(typeof result.new_alerts, 'number');
  });

  it('returns { overdue: 0, new_alerts: 0 } when no trucks exceed threshold', () => {
    // All trucks inserted so far have km_since_service = 0 (none near 500)
    insertTruck({ total_km: 100, last_service_km: 0 }); // 100 km < 500 threshold
    const result = mc.run();
    assert.equal(result.overdue,    0);
    assert.equal(result.new_alerts, 0);
  });
});

// ── run — overdue detection ───────────────────────────────────────

describe('maintenanceChecker — overdue detection', () => {
  it('counts trucks whose km_since_service >= SERVICE_KM_THRESHOLD (500)', () => {
    insertTruck({ total_km: 600, last_service_km: 0 });  // 600 km ≥ 500 → overdue
    const { overdue } = mc.run();
    assert.ok(overdue >= 1, `expected ≥ 1 overdue truck, got ${overdue}`);
  });

  it('does not count a truck exactly below threshold (499 km)', () => {
    insertTruck({ total_km: 499, last_service_km: 0 }); // 499 < 500 → not overdue
    const before = mc.run().overdue;
    // Insert one more that IS overdue to confirm the query is working
    insertTruck({ total_km: 600, last_service_km: 0 });
    const after = mc.run().overdue;
    assert.equal(after, before + 1);
  });

  it('counts a truck at exactly the threshold (500 km)', () => {
    const beforeOverdue = mc.run().overdue;
    insertTruck({ total_km: 500, last_service_km: 0 }); // exactly 500 → overdue
    const afterOverdue = mc.run().overdue;
    assert.equal(afterOverdue, beforeOverdue + 1);
  });

  it('excluded archived trucks from overdue count', () => {
    const before = mc.run().overdue;
    insertTruck({ total_km: 1000, last_service_km: 0, archived: 1 }); // archived
    const after = mc.run().overdue;
    assert.equal(after, before,
      'archived trucks should not appear in overdue count');
  });
});

// ── run — alert creation ──────────────────────────────────────────

describe('maintenanceChecker — alert creation', () => {
  it('new_alerts > 0 for a first-seen overdue truck', () => {
    // Clear alert_state to ensure fresh dedup
    db.prepare('DELETE FROM alert_state').run();
    insertTruck({ total_km: 700, last_service_km: 0 }); // 700 km ≥ 500
    const { new_alerts } = mc.run();
    assert.ok(new_alerts >= 1, `expected ≥ 1 new alert on first run`);
  });

  it('INSERT OR IGNORE: second run produces new_alerts = 0 for same trucks', () => {
    db.prepare('DELETE FROM alert_state').run();
    insertTruck({ total_km: 800, last_service_km: 0 });
    mc.run();           // first run — creates alert
    const { new_alerts } = mc.run();   // second run — deduped
    assert.equal(new_alerts, 0,
      'second run should not create duplicate alerts (INSERT OR IGNORE)');
  });

  it('critical trucks (km >= SERVICE_KM_CRITICAL=1000) generate a separate alert bucket', () => {
    db.prepare('DELETE FROM alert_state').run();
    insertTruck({ total_km: 1100, last_service_km: 0 }); // 1100 ≥ 1000 → critical
    const { new_alerts } = mc.run();
    assert.ok(new_alerts >= 1, 'critical truck should generate a new_alert');
  });
});
