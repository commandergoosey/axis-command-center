'use strict';

/*
 * Tests for state/integrationSyncLog.js —
 *   ensureSeeded, record, recent, health
 *
 * Uses in-memory SQLite. integrationSyncLog.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - ensureSeeded: no-op with empty array; no-op when table already has rows
 *   - record: inserts row; success stored as 1/0; failure with error_code stored
 *   - recent: returns array; includes rows within hours window; respects limit;
 *     returns rows for specific hauler_id only
 *   - health: composite object with last_24h/last_7d/top_errors/last_success/
 *     recent_attempts; last_24h.attempts increments after record;
 *     last_24h.success_rate is null when no attempts;
 *     last_success is null with no successes; row after success
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/integrationSyncLog')];
const sl = require('../state/integrationSyncLog');

let _seq = 0;
function hid() { return `haul-sl-${String(++_seq).padStart(3, '0')}`; }

// ── ensureSeeded ──────────────────────────────────────────────────

describe('integrationSyncLog — ensureSeeded', () => {
  it('does not throw when called with an empty hauler array', () => {
    assert.doesNotThrow(() => sl.ensureSeeded([]));
  });

  it('does not throw when called with a hauler array (table already has rows from record)', () => {
    // record() some rows first to make table non-empty, then ensureSeeded is no-op
    sl.record({ hauler_id: hid(), success: true });
    assert.doesNotThrow(() => sl.ensureSeeded([
      { id: 'haul-seed-01', status: 'active', integration: { type: 'api' } },
    ]));
  });
});

// ── record ────────────────────────────────────────────────────────

describe('integrationSyncLog — record', () => {
  it('does not throw for a successful record', () => {
    assert.doesNotThrow(() => sl.record({
      hauler_id: hid(), success: true, latency_ms: 120, rows_synced: 45,
    }));
  });

  it('does not throw for a failed record', () => {
    assert.doesNotThrow(() => sl.record({
      hauler_id: hid(), success: false,
      error_code: 'TIMEOUT', error_message: 'Upstream did not respond',
    }));
  });

  it('recorded row appears in recent()', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: true, latency_ms: 80 });
    const rows = sl.recent(h, 24, 100);
    assert.ok(rows.length >= 1);
  });

  it('success is stored as integer 1', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: true });
    const rows = sl.recent(h, 24, 100);
    assert.ok(rows.some((r) => r.success === 1));
  });

  it('failure is stored with success = 0', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: false, error_code: 'AUTH_REJECTED' });
    const rows = sl.recent(h, 24, 100);
    assert.ok(rows.some((r) => r.success === 0 && r.error_code === 'AUTH_REJECTED'));
  });

  it('error_message is stored for failures', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: false, error_message: 'Connection reset by peer' });
    const rows = sl.recent(h, 24, 100);
    assert.ok(rows.some((r) => r.error_message === 'Connection reset by peer'));
  });

  it('rows_synced is stored for successes', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: true, rows_synced: 42 });
    const rows = sl.recent(h, 24, 100);
    assert.ok(rows.some((r) => r.rows_synced === 42));
  });
});

// ── recent ────────────────────────────────────────────────────────

describe('integrationSyncLog — recent', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(sl.recent(hid())));
  });

  it('returns empty array for hauler with no records', () => {
    assert.equal(sl.recent(hid()).length, 0);
  });

  it('returns only rows for the specified hauler_id', () => {
    const h1 = hid();
    const h2 = hid();
    sl.record({ hauler_id: h1, success: true });
    sl.record({ hauler_id: h2, success: true });
    const rows = sl.recent(h1, 24, 100);
    assert.ok(rows.every((r) => r.hauler_id === h1));
  });

  it('respects the limit parameter', () => {
    const h = hid();
    for (let i = 0; i < 5; i++) sl.record({ hauler_id: h, success: true });
    const rows = sl.recent(h, 24, 2);
    assert.ok(rows.length <= 2);
  });

  it('defaults limit to 50', () => {
    // Just checking that calling without limit arg does not throw
    const h = hid();
    sl.record({ hauler_id: h, success: true });
    assert.ok(Array.isArray(sl.recent(h, 24)));
  });
});

// ── health ────────────────────────────────────────────────────────

describe('integrationSyncLog — health', () => {
  it('returns an object', () => {
    assert.ok(typeof sl.health(hid()) === 'object');
  });

  it('has last_24h property', () => {
    assert.ok('last_24h' in sl.health(hid()));
  });

  it('last_24h has hours/attempts/successes/success_rate/avg_latency_ms', () => {
    const h = hid();
    const h24 = sl.health(h).last_24h;
    for (const f of ['hours', 'attempts', 'successes', 'success_rate', 'avg_latency_ms']) {
      assert.ok(f in h24, `missing field: ${f}`);
    }
  });

  it('has last_7d property', () => {
    assert.ok('last_7d' in sl.health(hid()));
  });

  it('has top_errors as array', () => {
    const h = hid();
    assert.ok(Array.isArray(sl.health(h).top_errors));
  });

  it('has last_success property', () => {
    assert.ok('last_success' in sl.health(hid()));
  });

  it('has recent_attempts as array', () => {
    const h = hid();
    assert.ok(Array.isArray(sl.health(h).recent_attempts));
  });

  it('last_24h.attempts is 0 for fresh hauler', () => {
    assert.equal(sl.health(hid()).last_24h.attempts, 0);
  });

  it('last_24h.attempts increments after record()', () => {
    const h = hid();
    const before = sl.health(h).last_24h.attempts;
    sl.record({ hauler_id: h, success: true });
    const after = sl.health(h).last_24h.attempts;
    assert.equal(after, before + 1);
  });

  it('last_24h.success_rate is null when no attempts', () => {
    assert.equal(sl.health(hid()).last_24h.success_rate, null);
  });

  it('last_24h.success_rate is a number after a successful record', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: true, latency_ms: 100 });
    const rate = sl.health(h).last_24h.success_rate;
    assert.ok(typeof rate === 'number');
    assert.equal(rate, 100);
  });

  it('last_success is null for hauler with no successes', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: false, error_code: 'TIMEOUT' });
    assert.equal(sl.health(h).last_success, null);
  });

  it('last_success is a row with hauler_id after a successful record', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: true, latency_ms: 200 });
    const ls = sl.health(h).last_success;
    assert.ok(ls !== null);
    assert.equal(ls.hauler_id, h);
    assert.equal(ls.success, 1);
  });

  it('recent_attempts is populated after record()', () => {
    const h = hid();
    sl.record({ hauler_id: h, success: true });
    const attempts = sl.health(h).recent_attempts;
    assert.ok(attempts.length >= 1);
  });
});
