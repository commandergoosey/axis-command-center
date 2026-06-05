'use strict';

/*
 * Tests for state/integrationStore.js —
 *   summary, setCreds, clearCreds, getCreds, setProbe, setCsv, getState
 *
 * Uses in-memory SQLite. integrationStore.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Uses unique hauler IDs per test group to avoid cache cross-contamination
 * (the module-level Map cache is shared within the test run).
 *
 * Covers:
 *   - summary: has_credentials false until setCreds; live false until setProbe;
 *     csv_rows count reflects setCsv; last_probe/last_sync present
 *   - setCreds/getCreds: getCreds null before set; returns creds after set
 *   - clearCreds: resets creds/live/last_probe to null/false/null
 *   - setProbe: sets live flag; stores last_probe; updates last_sync from probed_at
 *   - setCsv: csv_rows count reflects number of rows; updates last_sync
 *   - getState: returns internal state object with expected fields
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/integrationStore')];
const is = require('../state/integrationStore');

let _seq = 0;
function hid() { return `haul-is-${String(++_seq).padStart(3, '0')}`; }

// ── summary ───────────────────────────────────────────────────────

describe('integrationStore — summary', () => {
  it('has_credentials is false for a fresh hauler', () => {
    assert.equal(is.summary(hid()).has_credentials, false);
  });

  it('live is false for a fresh hauler', () => {
    assert.equal(is.summary(hid()).live, false);
  });

  it('csv_rows is 0 for a fresh hauler', () => {
    assert.equal(is.summary(hid()).csv_rows, 0);
  });

  it('last_probe is null for a fresh hauler', () => {
    assert.equal(is.summary(hid()).last_probe, null);
  });

  it('last_sync is null for a fresh hauler', () => {
    assert.equal(is.summary(hid()).last_sync, null);
  });

  it('has_credentials is true after setCreds', () => {
    const h = hid();
    is.setCreds(h, { api_key: 'key-abc' });
    assert.equal(is.summary(h).has_credentials, true);
  });
});

// ── setCreds / getCreds ───────────────────────────────────────────

describe('integrationStore — setCreds / getCreds', () => {
  it('getCreds returns null before setCreds', () => {
    assert.equal(is.getCreds(hid()), null);
  });

  it('getCreds returns the stored creds after setCreds', () => {
    const h = hid();
    is.setCreds(h, { api_key: 'secret-123', base_url: 'https://api.example.com' });
    assert.deepEqual(is.getCreds(h), { api_key: 'secret-123', base_url: 'https://api.example.com' });
  });

  it('setCreds persists across cache accesses', () => {
    const h = hid();
    is.setCreds(h, { token: 'persist-me' });
    // A second call hits cache (not DB path), but data is consistent
    assert.deepEqual(is.getCreds(h), { token: 'persist-me' });
  });

  it('updating creds replaces previous creds', () => {
    const h = hid();
    is.setCreds(h, { api_key: 'v1' });
    is.setCreds(h, { api_key: 'v2' });
    assert.equal(is.getCreds(h).api_key, 'v2');
  });
});

// ── clearCreds ────────────────────────────────────────────────────

describe('integrationStore — clearCreds', () => {
  it('getCreds returns null after clearCreds', () => {
    const h = hid();
    is.setCreds(h, { api_key: 'temp' });
    is.clearCreds(h);
    assert.equal(is.getCreds(h), null);
  });

  it('has_credentials is false after clearCreds', () => {
    const h = hid();
    is.setCreds(h, { api_key: 'temp' });
    is.clearCreds(h);
    assert.equal(is.summary(h).has_credentials, false);
  });

  it('live is false after clearCreds', () => {
    const h = hid();
    is.setCreds(h, { api_key: 'temp' });
    is.setProbe(h, { live: true, probed_at: new Date().toISOString() });
    is.clearCreds(h);
    assert.equal(is.summary(h).live, false);
  });

  it('last_probe is null after clearCreds', () => {
    const h = hid();
    is.setProbe(h, { live: true, probed_at: new Date().toISOString() });
    is.clearCreds(h);
    assert.equal(is.summary(h).last_probe, null);
  });
});

// ── setProbe ──────────────────────────────────────────────────────

describe('integrationStore — setProbe', () => {
  it('live becomes true when probe result has live: true', () => {
    const h = hid();
    is.setProbe(h, { live: true, probed_at: new Date().toISOString() });
    assert.equal(is.summary(h).live, true);
  });

  it('live becomes false when probe result has live: false', () => {
    const h = hid();
    is.setProbe(h, { live: false, probed_at: new Date().toISOString() });
    assert.equal(is.summary(h).live, false);
  });

  it('last_probe stores the probe result object', () => {
    const h = hid();
    const probe = { live: true, probed_at: '2026-01-15T12:00:00.000Z', latency_ms: 45 };
    is.setProbe(h, probe);
    assert.deepEqual(is.summary(h).last_probe, probe);
  });

  it('last_sync is updated from probed_at', () => {
    const h = hid();
    is.setProbe(h, { live: true, probed_at: '2026-02-01T08:00:00.000Z' });
    assert.equal(is.summary(h).last_sync, '2026-02-01T08:00:00.000Z');
  });
});

// ── setCsv ────────────────────────────────────────────────────────

describe('integrationStore — setCsv', () => {
  it('csv_rows count reflects the number of rows', () => {
    const h = hid();
    is.setCsv(h, [{ a: 1 }, { a: 2 }, { a: 3 }]);
    assert.equal(is.summary(h).csv_rows, 3);
  });

  it('csv_rows is 0 when set to empty array', () => {
    const h = hid();
    is.setCsv(h, [{ a: 1 }]);
    is.setCsv(h, []);
    assert.equal(is.summary(h).csv_rows, 0);
  });

  it('csv_rows is 0 when non-array passed', () => {
    const h = hid();
    is.setCsv(h, null);
    assert.equal(is.summary(h).csv_rows, 0);
  });

  it('last_sync is updated after setCsv', () => {
    const before = Date.now();
    const h = hid();
    is.setCsv(h, [{ a: 1 }]);
    const after = Date.now();
    const ts = new Date(is.summary(h).last_sync).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('csv_rows count matches getState().csv_rows.length', () => {
    const h = hid();
    is.setCsv(h, [{ x: 1 }, { x: 2 }]);
    const state = is.getState(h);
    assert.equal(state.csv_rows.length, 2);
    assert.equal(is.summary(h).csv_rows, 2);
  });
});

// ── getState ──────────────────────────────────────────────────────

describe('integrationStore — getState', () => {
  it('returns an object', () => {
    assert.ok(typeof is.getState(hid()) === 'object');
  });

  it('has creds field', () => {
    assert.ok('creds' in is.getState(hid()));
  });

  it('has live field', () => {
    assert.ok('live' in is.getState(hid()));
  });

  it('has last_probe field', () => {
    assert.ok('last_probe' in is.getState(hid()));
  });

  it('has last_sync field', () => {
    assert.ok('last_sync' in is.getState(hid()));
  });

  it('has csv_rows field as array', () => {
    const h = hid();
    assert.ok(Array.isArray(is.getState(h).csv_rows));
  });

  it('csv_rows starts empty', () => {
    const h = hid();
    assert.equal(is.getState(h).csv_rows.length, 0);
  });
});
