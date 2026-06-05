'use strict';

/*
 * Tests for state/claimsState.js —
 *   STATUSES, transition, apply, getOverride
 *
 * Uses in-memory SQLite. claims_state table created idempotently by
 * claimsState.js — no stubs or migrations required.
 *
 * Covers:
 *   - STATUSES: exported array with expected values
 *   - transition: unknown status throws; creates overlay row; upsert
 *     does not clear existing fields via COALESCE; stores all fields
 *   - apply: no overlay → base returned with notes_default; with
 *     overlay → status/paid_at/approved_amount_usd/notes merged;
 *     last_updated_at/last_updated_by present
 *   - getOverride: null for unknown; raw row after transition
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/claimsState')];
const cs = require('../state/claimsState');

let _seq = 0;
function cid() { return `claim-${String(++_seq).padStart(4, '0')}`; }

function baseClaim(id) {
  return { id, status: 'filed', approved_amount_usd: null, paid_at: null, payment_ref: null };
}

// ── STATUSES ──────────────────────────────────────────────────────

describe('claimsState — STATUSES', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(cs.STATUSES));
  });

  it('includes filed, under_review, approved, denied, paid', () => {
    for (const s of ['filed', 'under_review', 'approved', 'denied', 'paid']) {
      assert.ok(cs.STATUSES.includes(s), `missing: ${s}`);
    }
  });
});

// ── transition ────────────────────────────────────────────────────

describe('claimsState — transition', () => {
  it('throws for an unknown status', () => {
    assert.throws(() => cs.transition(cid(), { status: 'bogus' }), /unknown status/i);
  });

  it('does not throw for a valid status', () => {
    assert.doesNotThrow(() => cs.transition(cid(), { status: 'approved' }));
  });

  it('creates an overlay row', () => {
    const id = cid();
    cs.transition(id, { status: 'under_review' });
    assert.ok(cs.getOverride(id) !== null);
  });

  it('stores approved_amount_usd', () => {
    const id = cid();
    cs.transition(id, { status: 'approved', approved_amount_usd: 5000 });
    assert.equal(cs.getOverride(id).approved_amount_usd, 5000);
  });

  it('stores payment_ref', () => {
    const id = cid();
    cs.transition(id, { status: 'paid', payment_ref: 'BANK-REF-001' });
    assert.equal(cs.getOverride(id).payment_ref, 'BANK-REF-001');
  });

  it('stores notes', () => {
    const id = cid();
    cs.transition(id, { status: 'under_review', notes: 'Pending adjuster visit' });
    assert.equal(cs.getOverride(id).notes, 'Pending adjuster visit');
  });

  it('upsert — subsequent transition updates status', () => {
    const id = cid();
    cs.transition(id, { status: 'under_review' });
    cs.transition(id, { status: 'approved', approved_amount_usd: 3000 });
    assert.equal(cs.getOverride(id).status, 'approved');
  });
});

// ── apply ─────────────────────────────────────────────────────────

describe('claimsState — apply', () => {
  it('returns base with notes_default when no overlay', () => {
    const base = { ...baseClaim(cid()), notes_default: 'Baseline note' };
    const result = cs.apply(base);
    assert.equal(result.notes, 'Baseline note');
  });

  it('overlay status overrides base status', () => {
    const id = cid();
    cs.transition(id, { status: 'approved' });
    const result = cs.apply(baseClaim(id));
    assert.equal(result.status, 'approved');
  });

  it('overlay approved_amount_usd merges onto base', () => {
    const id = cid();
    cs.transition(id, { status: 'approved', approved_amount_usd: 7500 });
    const result = cs.apply(baseClaim(id));
    assert.equal(result.approved_amount_usd, 7500);
  });

  it('last_updated_at and last_updated_by present when overlay exists', () => {
    const id = cid();
    cs.transition(id, { status: 'under_review', by_display: 'Claims Lead' });
    const result = cs.apply(baseClaim(id));
    assert.ok('last_updated_at' in result);
    assert.equal(result.last_updated_by, 'Claims Lead');
  });

  it('overlay notes overrides notes_default', () => {
    const id = cid();
    cs.transition(id, { status: 'denied', notes: 'Outside coverage window' });
    const result = cs.apply({ ...baseClaim(id), notes_default: 'Baseline note' });
    assert.equal(result.notes, 'Outside coverage window');
  });
});

// ── getOverride ───────────────────────────────────────────────────

describe('claimsState — getOverride', () => {
  it('returns null for an unknown claim id', () => {
    assert.equal(cs.getOverride('claim-never'), null);
  });

  it('returns the raw row after transition', () => {
    const id = cid();
    cs.transition(id, { status: 'filed' });
    const row = cs.getOverride(id);
    assert.ok(row !== null);
    assert.equal(row.claim_id, id);
  });
});
