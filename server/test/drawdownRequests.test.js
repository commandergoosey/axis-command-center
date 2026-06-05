'use strict';

/*
 * Tests for state/drawdownRequests.js —
 *   get, submit, respond
 *
 * Uses in-memory SQLite. drawdownRequests.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - get: null for unknown tranche; shaped row after submit
 *   - submit: initial status is pending; stores amount_usd/notes/userId/userName;
 *     requested_at is recent ISO; throws if existing pending; throws if existing
 *     approved; allows re-submit when rejected; allows re-submit when info_requested
 *   - respond: throws when no request found; throws when not pending;
 *     throws for invalid status; sets status to approved/rejected/info_requested;
 *     stores responded_by_name/response_note; responded_at is recent ISO
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/drawdownRequests')];
const dr = require('../state/drawdownRequests');

let _seq = 0;
function tid() { return `tranche-dr-${String(++_seq).padStart(3, '0')}`; }

// ── get ───────────────────────────────────────────────────────────

describe('drawdownRequests — get', () => {
  it('returns null for unknown tranche', () => {
    assert.equal(dr.get('tranche-never'), null);
  });

  it('returns shaped row for known tranche after submit', () => {
    const t = tid();
    dr.submit({ trancheId: t, amountUsd: 100000 });
    const row = dr.get(t);
    assert.ok(row !== null);
    assert.equal(row.tranche_id, t);
  });

  it('shaped row has all expected fields', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    const row = dr.get(t);
    for (const f of ['id', 'tranche_id', 'status', 'requested_at', 'amount_usd', 'notes',
                     'responded_at', 'responded_by_name', 'response_note']) {
      assert.ok(f in row, `missing field: ${f}`);
    }
  });
});

// ── submit ────────────────────────────────────────────────────────

describe('drawdownRequests — submit', () => {
  it('returns a shaped row', () => {
    const row = dr.submit({ trancheId: tid() });
    assert.ok(row !== null && typeof row === 'object');
  });

  it('initial status is pending', () => {
    const row = dr.submit({ trancheId: tid() });
    assert.equal(row.status, 'pending');
  });

  it('stores amount_usd', () => {
    const t = tid();
    dr.submit({ trancheId: t, amountUsd: 75000 });
    assert.equal(dr.get(t).amount_usd, 75000);
  });

  it('stores notes', () => {
    const t = tid();
    dr.submit({ trancheId: t, notes: 'All gates closed' });
    assert.equal(dr.get(t).notes, 'All gates closed');
  });

  it('notes defaults to empty string when not provided', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    assert.equal(dr.get(t).notes, '');
  });

  it('stores requested_by_id', () => {
    const t = tid();
    dr.submit({ trancheId: t, userId: 'u-admin' });
    assert.equal(dr.get(t).requested_by_id, 'u-admin');
  });

  it('stores requested_by_name', () => {
    const t = tid();
    dr.submit({ trancheId: t, userName: 'Axis CFO' });
    assert.equal(dr.get(t).requested_by_name, 'Axis CFO');
  });

  it('requested_at is a recent ISO string', () => {
    const before = Date.now();
    const t = tid();
    dr.submit({ trancheId: t });
    const after = Date.now();
    const ts = new Date(dr.get(t).requested_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('responded_at is null on initial submit', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    assert.equal(dr.get(t).responded_at, null);
  });

  it('throws when existing request is pending', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    assert.throws(() => dr.submit({ trancheId: t }), /already pending/i);
  });

  it('throws when existing request is approved', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'approved', respondedByName: 'Lender' });
    assert.throws(() => dr.submit({ trancheId: t }), /already approved/i);
  });

  it('allows re-submit when prior request was rejected', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'rejected', respondedByName: 'Lender' });
    assert.doesNotThrow(() => dr.submit({ trancheId: t }));
    assert.equal(dr.get(t).status, 'pending');
  });

  it('allows re-submit when prior request was info_requested', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'info_requested', respondedByName: 'Lender' });
    assert.doesNotThrow(() => dr.submit({ trancheId: t }));
    assert.equal(dr.get(t).status, 'pending');
  });
});

// ── respond ───────────────────────────────────────────────────────

describe('drawdownRequests — respond', () => {
  it('throws when no request exists for tranche', () => {
    // Error message: "No drawdown request found for this tranche"
    assert.throws(
      () => dr.respond({ trancheId: tid(), status: 'approved' }),
      /no drawdown/i,
    );
  });

  it('throws when request is not pending (approved)', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'approved' });
    assert.throws(
      () => dr.respond({ trancheId: t, status: 'rejected' }),
      /already in/i,
    );
  });

  it('throws when request is not pending (rejected)', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'rejected' });
    assert.throws(
      () => dr.respond({ trancheId: t, status: 'approved' }),
      /already in/i,
    );
  });

  it('throws for invalid response status', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    assert.throws(
      () => dr.respond({ trancheId: t, status: 'maybe' }),
      /invalid response status/i,
    );
  });

  it('sets status to approved', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'approved', respondedByName: 'Lender Desk' });
    assert.equal(dr.get(t).status, 'approved');
  });

  it('sets status to rejected', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'rejected', respondedByName: 'Lender Desk' });
    assert.equal(dr.get(t).status, 'rejected');
  });

  it('sets status to info_requested', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'info_requested' });
    assert.equal(dr.get(t).status, 'info_requested');
  });

  it('stores responded_by_name', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'approved', respondedByName: 'Senior Lender' });
    assert.equal(dr.get(t).responded_by_name, 'Senior Lender');
  });

  it('stores response_note', () => {
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'rejected', responseNote: 'Insufficient documentation' });
    assert.equal(dr.get(t).response_note, 'Insufficient documentation');
  });

  it('responded_at is a recent ISO string', () => {
    const before = Date.now();
    const t = tid();
    dr.submit({ trancheId: t });
    dr.respond({ trancheId: t, status: 'approved' });
    const after = Date.now();
    const ts = new Date(dr.get(t).responded_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});
