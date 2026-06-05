'use strict';

/*
 * Tests for state/filingState.js —
 *   getState, all, markFiled
 *
 * Uses in-memory SQLite. filing_state table is created by db/index.js
 * (the base schema) so only the db module needs to be loaded.
 *
 * Covers:
 *   - getState: null for unknown filing; raw row for known
 *   - all: returns array; includes every filed row
 *   - markFiled: returns {status:'FILED', submitted_at, submitted_by};
 *     submitted_at is a recent ISO; idempotent (second call updates)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/filingState')];
const fs = require('../state/filingState');

let _seq = 0;
function fid() { return `filing-${String(++_seq).padStart(4, '0')}`; }

// ── getState ──────────────────────────────────────────────────────

describe('filingState — getState', () => {
  it('returns null for an unknown filing id', () => {
    assert.equal(fs.getState('filing-never'), null);
  });

  it('returns the row after markFiled', () => {
    const id = fid();
    fs.markFiled(id, { submitted_by: 'Ops Lead' });
    const row = fs.getState(id);
    assert.ok(row !== null);
    assert.equal(row.filing_id, id);
    assert.equal(row.status, 'FILED');
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('filingState — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(fs.all()));
  });

  it('includes rows after markFiled', () => {
    const id = fid();
    fs.markFiled(id, { submitted_by: 'Admin' });
    assert.ok(fs.all().some((r) => r.filing_id === id));
  });
});

// ── markFiled ─────────────────────────────────────────────────────

describe('filingState — markFiled', () => {
  it('returns an object with status FILED', () => {
    const result = fs.markFiled(fid(), { submitted_by: 'Ops' });
    assert.equal(result.status, 'FILED');
  });

  it('submitted_by is stored in the result', () => {
    const result = fs.markFiled(fid(), { submitted_by: 'Jane Doe' });
    assert.equal(result.submitted_by, 'Jane Doe');
  });

  it('submitted_at is a recent ISO string', () => {
    const before = Date.now();
    const result = fs.markFiled(fid(), { submitted_by: 'Ops' });
    const after = Date.now();
    const ts = new Date(result.submitted_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('idempotent — second call updates the row', () => {
    const id = fid();
    fs.markFiled(id, { submitted_by: 'First' });
    fs.markFiled(id, { submitted_by: 'Second' });
    assert.equal(fs.getState(id).submitted_by, 'Second');
  });
});
