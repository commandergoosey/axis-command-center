'use strict';

/*
 * Tests for state/licenceState.js —
 *   getState, all, renew
 *
 * Uses in-memory SQLite. licenceState.js creates its own licence_state
 * table idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - getState: null for unknown licence; raw row for known
 *   - all: returns array; grows after renew
 *   - renew: stores expiry_iso, ref_number, renewed_by, note; renewed_at
 *     is a recent ISO; idempotent (upsert updates existing row);
 *     ref_number/renewed_by/note are null when not provided
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/licenceState')];
const ls = require('../state/licenceState');

let _seq = 0;
function lid() { return `lic-${String(++_seq).padStart(4, '0')}`; }

// ── getState ──────────────────────────────────────────────────────

describe('licenceState — getState', () => {
  it('returns null for an unknown licence id', () => {
    assert.equal(ls.getState('lic-never'), null);
  });

  it('returns the row after renew', () => {
    const id = lid();
    ls.renew(id, { expiry_iso: '2028-01-01T00:00:00.000Z' });
    const row = ls.getState(id);
    assert.ok(row !== null);
    assert.equal(row.licence_id, id);
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('licenceState — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(ls.all()));
  });

  it('count grows after renew', () => {
    const before = ls.all().length;
    ls.renew(lid(), { expiry_iso: '2029-01-01T00:00:00.000Z' });
    assert.equal(ls.all().length, before + 1);
  });
});

// ── renew ─────────────────────────────────────────────────────────

describe('licenceState — renew', () => {
  it('stores expiry_iso', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-06-01T00:00:00.000Z' });
    assert.equal(result.expiry_iso, '2030-06-01T00:00:00.000Z');
  });

  it('stores ref_number when provided', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z', ref_number: 'REF-001' });
    assert.equal(result.ref_number, 'REF-001');
  });

  it('ref_number is null when not provided', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z' });
    assert.equal(result.ref_number, null);
  });

  it('stores renewed_by when provided', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z', renewed_by: 'Ops Lead' });
    assert.equal(result.renewed_by, 'Ops Lead');
  });

  it('renewed_by is null when not provided', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z' });
    assert.equal(result.renewed_by, null);
  });

  it('stores note when provided', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z', note: 'Renewal processed at DVLA office' });
    assert.equal(result.note, 'Renewal processed at DVLA office');
  });

  it('note is null when not provided', () => {
    const id = lid();
    const result = ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z' });
    assert.equal(result.note, null);
  });

  it('renewed_at is a recent ISO string', () => {
    const before = Date.now();
    const id = lid();
    ls.renew(id, { expiry_iso: '2030-01-01T00:00:00.000Z' });
    const after = Date.now();
    const row = ls.getState(id);
    const ts = new Date(row.renewed_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('idempotent — second renew updates existing row', () => {
    const id = lid();
    ls.renew(id, { expiry_iso: '2028-01-01T00:00:00.000Z', ref_number: 'OLD' });
    ls.renew(id, { expiry_iso: '2032-01-01T00:00:00.000Z', ref_number: 'NEW' });
    const row = ls.getState(id);
    assert.equal(row.expiry_iso, '2032-01-01T00:00:00.000Z');
    assert.equal(row.ref_number, 'NEW');
  });
});
