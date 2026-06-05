'use strict';

/*
 * Tests for state/settlementOverlay.js —
 *   STATUSES, markPaid, openDispute, resolveDispute, setNotes,
 *   apply, getOverride, createGenerated, listGenerated, hasPeriod
 *
 * Uses in-memory SQLite. settlementOverlay.js creates its own tables
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - STATUSES: array with pending/paid/partial/disputed
 *   - markPaid: sets status to paid; stores paid_at/paid_amount_usd/payment_ref;
 *     defaults paid_at to now when not provided
 *   - openDispute: sets status to disputed; stores dispute_reason/opened_by/opened_at
 *   - resolveDispute: invalid resolution_status throws; sets status; defaults to pending
 *   - setNotes: stores notes; null clears existing notes
 *   - apply: no overlay → returns base; with overlay → merges status/paid_at/notes;
 *     last_updated_at/last_updated_by present; dispute sub-object when opened
 *   - getOverride: null for unknown; raw row after overlay operation
 *   - createGenerated/listGenerated/hasPeriod: insert/list/check generated settlements
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/settlementOverlay')];
const so = require('../state/settlementOverlay');

let _seq = 0;
function sid() { return `sett-${String(++_seq).padStart(4, '0')}`; }

function baseSettlement(id) {
  return { id, status: 'pending', paid_at: null, paid_amount_usd: null, payment_ref: null };
}

// ── STATUSES ──────────────────────────────────────────────────────

describe('settlementOverlay — STATUSES', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(so.STATUSES));
  });

  it('includes pending, paid, partial, disputed', () => {
    for (const s of ['pending', 'paid', 'partial', 'disputed']) {
      assert.ok(so.STATUSES.includes(s), `missing: ${s}`);
    }
  });
});

// ── markPaid ──────────────────────────────────────────────────────

describe('settlementOverlay — markPaid', () => {
  it('creates an overlay row', () => {
    const id = sid();
    so.markPaid(id, { paid_at: '2026-01-15T00:00:00.000Z', paid_amount_usd: 12000 });
    assert.ok(so.getOverride(id) !== null);
  });

  it('sets status to paid', () => {
    const id = sid();
    so.markPaid(id, {});
    assert.equal(so.getOverride(id).status, 'paid');
  });

  it('stores paid_amount_usd', () => {
    const id = sid();
    so.markPaid(id, { paid_amount_usd: 5500 });
    assert.equal(so.getOverride(id).paid_amount_usd, 5500);
  });

  it('stores payment_ref', () => {
    const id = sid();
    so.markPaid(id, { payment_ref: 'WIRE-2026-001' });
    assert.equal(so.getOverride(id).payment_ref, 'WIRE-2026-001');
  });

  it('stores paid_at when provided', () => {
    const id = sid();
    so.markPaid(id, { paid_at: '2026-01-20T10:00:00.000Z' });
    assert.equal(so.getOverride(id).paid_at, '2026-01-20T10:00:00.000Z');
  });

  it('defaults paid_at to now when not provided', () => {
    const before = Date.now();
    const id = sid();
    so.markPaid(id, {});
    const after = Date.now();
    const ts = new Date(so.getOverride(id).paid_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});

// ── openDispute ───────────────────────────────────────────────────

describe('settlementOverlay — openDispute', () => {
  it('sets status to disputed', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Volume discrepancy', by_display: 'Finance Lead' });
    assert.equal(so.getOverride(id).status, 'disputed');
  });

  it('stores dispute_reason', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Incorrect rates applied' });
    assert.equal(so.getOverride(id).dispute_reason, 'Incorrect rates applied');
  });

  it('stores dispute_opened_by when by_display provided', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Test', by_display: 'Ops Manager' });
    assert.equal(so.getOverride(id).dispute_opened_by, 'Ops Manager');
  });

  it('stores dispute_opened_at as recent ISO', () => {
    const before = Date.now();
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Timing test' });
    const after = Date.now();
    const ts = new Date(so.getOverride(id).dispute_opened_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});

// ── resolveDispute ────────────────────────────────────────────────

describe('settlementOverlay — resolveDispute', () => {
  it('throws for invalid resolution_status', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Bad invoice' });
    assert.throws(
      () => so.resolveDispute(id, { resolution_status: 'bogus' }),
      /unknown resolution_status/i,
    );
  });

  it('sets status to the provided resolution_status', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Test' });
    so.resolveDispute(id, { resolution_status: 'pending' });
    assert.equal(so.getOverride(id).status, 'pending');
  });

  it('defaults resolution_status to pending', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Default resolve' });
    so.resolveDispute(id, {});
    assert.equal(so.getOverride(id).status, 'pending');
  });

  it('can resolve to paid', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Now resolved via payment' });
    so.resolveDispute(id, { resolution_status: 'paid' });
    assert.equal(so.getOverride(id).status, 'paid');
  });
});

// ── setNotes ──────────────────────────────────────────────────────

describe('settlementOverlay — setNotes', () => {
  it('stores notes', () => {
    const id = sid();
    so.setNotes(id, { notes: 'Payment confirmed via wire' });
    assert.equal(so.getOverride(id).notes, 'Payment confirmed via wire');
  });

  it('null clears existing notes', () => {
    const id = sid();
    so.setNotes(id, { notes: 'Temporary note' });
    so.setNotes(id, { notes: null });
    assert.equal(so.getOverride(id).notes, null);
  });
});

// ── apply ─────────────────────────────────────────────────────────

describe('settlementOverlay — apply', () => {
  it('returns base unchanged when no overlay', () => {
    const base = baseSettlement(sid());
    const result = so.apply(base);
    assert.equal(result.status, 'pending');
    assert.equal(result.paid_at, null);
  });

  it('overlay status overrides base', () => {
    const id = sid();
    so.markPaid(id, { paid_amount_usd: 8000 });
    const result = so.apply(baseSettlement(id));
    assert.equal(result.status, 'paid');
  });

  it('overlay paid_amount_usd merges onto base', () => {
    const id = sid();
    so.markPaid(id, { paid_amount_usd: 6000 });
    const result = so.apply(baseSettlement(id));
    assert.equal(result.paid_amount_usd, 6000);
  });

  it('last_updated_at present when overlay exists', () => {
    const id = sid();
    so.markPaid(id, { by_display: 'Finance Admin' });
    const result = so.apply(baseSettlement(id));
    assert.ok('last_updated_at' in result);
  });

  it('last_updated_by set from by_display', () => {
    const id = sid();
    so.markPaid(id, { by_display: 'Finance Admin' });
    const result = so.apply(baseSettlement(id));
    assert.equal(result.last_updated_by, 'Finance Admin');
  });

  it('dispute sub-object present when dispute opened', () => {
    const id = sid();
    so.openDispute(id, { dispute_reason: 'Volume mismatch', by_display: 'Ops' });
    const result = so.apply(baseSettlement(id));
    assert.ok(result.dispute !== null);
    assert.equal(result.dispute.reason, 'Volume mismatch');
  });

  it('notes from overlay included in result', () => {
    const id = sid();
    so.setNotes(id, { notes: 'Overlay note' });
    const result = so.apply(baseSettlement(id));
    assert.equal(result.notes, 'Overlay note');
  });
});

// ── getOverride ───────────────────────────────────────────────────

describe('settlementOverlay — getOverride', () => {
  it('returns null for unknown id', () => {
    assert.equal(so.getOverride('sett-never'), null);
  });

  it('returns raw row with settlement_id after markPaid', () => {
    const id = sid();
    so.markPaid(id, {});
    const row = so.getOverride(id);
    assert.ok(row !== null);
    assert.equal(row.settlement_id, id);
  });

  it('returns raw row with updated_at set', () => {
    const before = Date.now();
    const id = sid();
    so.markPaid(id, {});
    const after = Date.now();
    const ts = new Date(so.getOverride(id).updated_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});

// ── createGenerated / listGenerated / hasPeriod ───────────────────

describe('settlementOverlay — createGenerated / listGenerated / hasPeriod', () => {
  const GEN_ID  = 'gen-so-test-001';
  const GEN_ROW = {
    id:              GEN_ID,
    hauler_id:       'haul-gen-so-01',
    period:          '2026-W01',
    period_label:    'Week 1 2026',
    issued_at:       '2026-01-05T00:00:00.000Z',
    due_date:        '2026-01-12T00:00:00.000Z',
    gross_usd:       20000,
    deductions_usd:  1000,
    net_usd:         19000,
    line_items_json: '[]',
    generated_at:    '2026-01-05T00:00:00.000Z',
    generated_by:    null,
  };

  it('createGenerated does not throw', () => {
    assert.doesNotThrow(() => so.createGenerated([GEN_ROW]));
  });

  it('listGenerated returns an array', () => {
    assert.ok(Array.isArray(so.listGenerated()));
  });

  it('listGenerated includes the inserted row', () => {
    const rows = so.listGenerated();
    assert.ok(rows.some((r) => r.id === GEN_ID));
  });

  it('deserialized row has status: pending and generated: true', () => {
    const row = so.listGenerated().find((r) => r.id === GEN_ID);
    assert.equal(row.status, 'pending');
    assert.equal(row.generated, true);
  });

  it('deserialized row has line_items as array', () => {
    const row = so.listGenerated().find((r) => r.id === GEN_ID);
    assert.ok(Array.isArray(row.line_items));
  });

  it('hasPeriod returns true for existing period + hauler', () => {
    assert.ok(so.hasPeriod('2026-W01', 'haul-gen-so-01'));
  });

  it('hasPeriod returns false for unknown period', () => {
    assert.ok(!so.hasPeriod('2026-W99', 'haul-gen-so-01'));
  });

  it('hasPeriod returns false for unknown hauler_id', () => {
    assert.ok(!so.hasPeriod('2026-W01', 'haul-never'));
  });

  it('createGenerated is idempotent — INSERT OR IGNORE', () => {
    assert.doesNotThrow(() => so.createGenerated([GEN_ROW]));
    // Should still be one row with this ID
    assert.equal(so.listGenerated().filter((r) => r.id === GEN_ID).length, 1);
  });
});
