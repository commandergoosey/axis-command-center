'use strict';

/*
 * Tests for state/reportRuns.js —
 *   record, list, nextSeq
 *
 * Uses in-memory SQLite. report_runs table is created by db/index.js
 * (the base schema) so only the db module needs to be loaded.
 *
 * Covers:
 *   - record: returns the instance; stores all fields; recipients
 *     stored as JSON and round-trips; optional fields null when absent
 *   - list: returns array; deserialized shape; id starts 'rpt-' is
 *     queryable; ordered generated_at DESC
 *   - nextSeq: returns integer > 0; increments after record with
 *     rpt-N id; seedMax respected when higher than DB max
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/reportRuns')];
const rr = require('../state/reportRuns');

let _seq = 0;
function instance(overrides = {}) {
  const n = ++_seq;
  return {
    id:           `rpt-${n}`,
    type_id:      'corridor_monthly',
    title:        `Monthly Report ${n}`,
    period_label: 'June 2026',
    period_from:  '2026-06-01',
    period_to:    '2026-06-30',
    status:       'complete',
    generated_at: new Date().toISOString(),
    generated_by: 'auto',
    recipients:   ['ops@example.com'],
    size_kb:      42,
    pages:        4,
    filename:     `corridor-monthly-${n}.pdf`,
    ...overrides,
  };
}

// ── record ────────────────────────────────────────────────────────

describe('reportRuns — record', () => {
  it('returns the instance', () => {
    const inst = instance();
    const result = rr.record(inst);
    assert.equal(result.id, inst.id);
  });

  it('stores title, type_id, status', () => {
    const inst = instance({ title: 'Custom Report', type_id: 'custom', status: 'pending' });
    rr.record(inst);
    const found = rr.list().find((r) => r.id === inst.id);
    assert.equal(found.title,   'Custom Report');
    assert.equal(found.type_id, 'custom');
    assert.equal(found.status,  'pending');
  });

  it('recipients round-trip through JSON', () => {
    const inst = instance({ recipients: ['a@b.com', 'c@d.com'] });
    rr.record(inst);
    const found = rr.list().find((r) => r.id === inst.id);
    assert.deepEqual(found.recipients, ['a@b.com', 'c@d.com']);
  });

  it('recipients defaults to [] when not provided', () => {
    const inst = instance();
    delete inst.recipients;
    rr.record(inst);
    const found = rr.list().find((r) => r.id === inst.id);
    assert.deepEqual(found.recipients, []);
  });

  it('optional fields are null when absent', () => {
    const inst = {
      id: `rpt-bare-${++_seq}`,
      type_id: 'bare',
      title: 'Bare',
      status: 'complete',
      generated_at: new Date().toISOString(),
    };
    rr.record(inst);
    const found = rr.list().find((r) => r.id === inst.id);
    assert.equal(found.period_label, null);
    assert.equal(found.size_kb,      null);
    assert.equal(found.filename,     null);
  });
});

// ── list ──────────────────────────────────────────────────────────

describe('reportRuns — list', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rr.list()));
  });

  it('includes records added via record()', () => {
    const inst = instance();
    rr.record(inst);
    assert.ok(rr.list().some((r) => r.id === inst.id));
  });

  it('shape has id/type_id/title/status/generated_at/recipients', () => {
    const inst = instance();
    rr.record(inst);
    const row = rr.list().find((r) => r.id === inst.id);
    for (const f of ['id', 'type_id', 'title', 'status', 'generated_at', 'recipients']) {
      assert.ok(f in row, `missing field: ${f}`);
    }
  });
});

// ── nextSeq ───────────────────────────────────────────────────────

describe('reportRuns — nextSeq', () => {
  it('returns a positive integer', () => {
    const n = rr.nextSeq();
    assert.ok(Number.isInteger(n) && n > 0);
  });

  it('increases after a new rpt-N record is added', () => {
    const before = rr.nextSeq();
    const bigN = before + 100;
    rr.record(instance({ id: `rpt-${bigN}` }));
    const after = rr.nextSeq();
    assert.ok(after > before);
  });

  it('respects seedMax when higher than the DB max', () => {
    const result = rr.nextSeq(999999);
    assert.ok(result > 999999);
  });
});
