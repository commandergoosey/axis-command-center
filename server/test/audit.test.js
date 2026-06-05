'use strict';

/*
 * Tests for db/audit.js — writeAudit + listAudit.
 *
 * Uses an in-memory SQLite DB so no real axis.db is touched.
 * The require.cache pattern ensures the in-memory DB is bound
 * to the prepared statements inside audit.js.
 *
 * Covers:
 *   - writeAudit without req → actor fields null; ts is recent ISO
 *   - writeAudit with req.user → actor fields populated
 *   - writeAudit with payload → payload stored; returned as object
 *   - listAudit() → { total, limit, offset, rows } shape
 *   - listAudit with entity_type filter
 *   - listAudit with entity_id filter
 *   - listAudit with since/until date range
 *   - listAudit with actor_user_id filter
 *   - listAudit with q (case-insensitive substring on summary)
 *   - listAudit with limit and offset (pagination)
 *   - each row has nested actor object
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must happen before loading audit.js ───────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');   // creates audit_log table (base schema)

delete require.cache[require.resolve('../db/audit')];
const { writeAudit, listAudit } = require('../db/audit');

// ── Helpers ───────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    user: {
      id:           'u-test-01',
      email:        'test@axis.gh',
      display_name: 'Test User',
      role:         'axis_ops',
      organisation: 'AXIS',
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
describe('writeAudit', () => {
  it('writes a row without req — actor fields are all null', () => {
    writeAudit({ entity_type: 'truck', entity_id: 'tr-01', action: 'CREATE' });
    const { rows } = listAudit({ entity_type: 'truck', entity_id: 'tr-01' });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.actor.user_id,      null);
    assert.equal(row.actor.email,        null);
    assert.equal(row.actor.display_name, null);
    assert.equal(row.actor.role,         null);
    assert.equal(row.actor.organisation, null);
  });

  it('ts is a recent ISO 8601 string', () => {
    writeAudit({ entity_type: 'truck', entity_id: 'tr-ts', action: 'VIEW' });
    const { rows } = listAudit({ entity_type: 'truck', entity_id: 'tr-ts' });
    const ts = new Date(rows[0].ts);
    assert.ok(!isNaN(ts.getTime()), 'ts should be a valid date');
    const ageMs = Date.now() - ts.getTime();
    assert.ok(ageMs >= 0 && ageMs < 5000, 'ts should be within the last 5 seconds');
  });

  it('writes a row with req.user — actor fields populated', () => {
    const req = makeReq();
    writeAudit({ req, entity_type: 'driver', entity_id: 'dr-01', action: 'UPDATE' });
    const { rows } = listAudit({ entity_type: 'driver', entity_id: 'dr-01' });
    assert.equal(rows.length, 1);
    const { actor } = rows[0];
    assert.equal(actor.user_id,      'u-test-01');
    assert.equal(actor.email,        'test@axis.gh');
    assert.equal(actor.display_name, 'Test User');
    assert.equal(actor.role,         'axis_ops');
    assert.equal(actor.organisation, 'AXIS');
  });

  it('stores payload and returns it as a parsed object', () => {
    const payload = { before: { status: 'idle' }, after: { status: 'active' } };
    writeAudit({ entity_type: 'hauler', entity_id: 'h-payload', action: 'UPDATE', payload });
    const { rows } = listAudit({ entity_type: 'hauler', entity_id: 'h-payload' });
    assert.deepEqual(rows[0].payload, payload);
  });

  it('null payload is returned as null', () => {
    writeAudit({ entity_type: 'hauler', entity_id: 'h-nopay', action: 'DELETE' });
    const { rows } = listAudit({ entity_type: 'hauler', entity_id: 'h-nopay' });
    assert.equal(rows[0].payload, null);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('listAudit — response shape', () => {
  it('returns { total, limit, offset, rows } shape', () => {
    const result = listAudit();
    assert.ok('total'  in result, 'should have total');
    assert.ok('limit'  in result, 'should have limit');
    assert.ok('offset' in result, 'should have offset');
    assert.ok(Array.isArray(result.rows), 'rows should be an array');
  });

  it('total reflects the number of matching rows', () => {
    const before = listAudit({ entity_type: 'shape-check' }).total;
    writeAudit({ entity_type: 'shape-check', entity_id: 'sc-1', action: 'X' });
    writeAudit({ entity_type: 'shape-check', entity_id: 'sc-2', action: 'X' });
    const after = listAudit({ entity_type: 'shape-check' }).total;
    assert.equal(after - before, 2);
  });

  it('each row has nested actor object with expected keys', () => {
    writeAudit({ entity_type: 'actor-shape', entity_id: 'as-1', action: 'READ' });
    const { rows } = listAudit({ entity_type: 'actor-shape' });
    const row = rows[0];
    assert.ok('id'          in row,        'row should have id');
    assert.ok('ts'          in row,        'row should have ts');
    assert.ok('entity_type' in row,        'row should have entity_type');
    assert.ok('entity_id'   in row,        'row should have entity_id');
    assert.ok('action'      in row,        'row should have action');
    assert.ok('actor'       in row,        'row should have actor');
    assert.ok('user_id'      in row.actor, 'actor should have user_id');
    assert.ok('email'        in row.actor, 'actor should have email');
    assert.ok('display_name' in row.actor, 'actor should have display_name');
    assert.ok('role'         in row.actor, 'actor should have role');
    assert.ok('organisation' in row.actor, 'actor should have organisation');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('listAudit — filters', () => {
  before(() => {
    // Seed a consistent set of rows for filter tests.
    const req = makeReq({ id: 'u-filter-01', email: 'filter@axis.gh', display_name: 'Filter User' });
    writeAudit({ req, entity_type: 'filter-et',  entity_id: 'flt-A', action: 'CREATE', summary: 'created Alpha hauler' });
    writeAudit({ req, entity_type: 'filter-et',  entity_id: 'flt-B', action: 'UPDATE', summary: 'updated Beta hauler' });
    writeAudit({       entity_type: 'other-type', entity_id: 'flt-A', action: 'DELETE', summary: 'removed Alpha' });
  });

  it('entity_type filter returns only matching rows', () => {
    const { rows } = listAudit({ entity_type: 'filter-et' });
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.entity_type === 'filter-et'));
  });

  it('entity_id filter returns only matching rows', () => {
    const { rows } = listAudit({ entity_id: 'flt-A' });
    assert.ok(rows.length >= 2);          // two entity types share this id
    assert.ok(rows.every((r) => r.entity_id === 'flt-A'));
  });

  it('entity_type + entity_id combined filter', () => {
    const { rows } = listAudit({ entity_type: 'filter-et', entity_id: 'flt-A' });
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.entity_type === 'filter-et' && r.entity_id === 'flt-A'));
  });

  it('actor_user_id filter returns only rows from that actor', () => {
    const { rows } = listAudit({ actor_user_id: 'u-filter-01' });
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.actor.user_id === 'u-filter-01'));
  });

  it('q filter does case-insensitive substring match on summary', () => {
    const { rows } = listAudit({ q: 'ALPHA' });
    assert.ok(rows.length >= 2, 'should match rows with "Alpha" in summary');
    assert.ok(rows.every((r) => r.summary && r.summary.toLowerCase().includes('alpha')));
  });

  it('q filter matches "beta" (lowercase query, mixed-case data)', () => {
    const { rows } = listAudit({ q: 'beta' });
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.summary && r.summary.toLowerCase().includes('beta')));
  });

  it('q filter with no matches returns empty rows', () => {
    const { rows } = listAudit({ q: 'XYZZY-NO-MATCH-999' });
    assert.equal(rows.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('listAudit — date range filters', () => {
  it('since filter excludes rows older than threshold', () => {
    // Write a row, then filter with since = far future
    writeAudit({ entity_type: 'range-test', entity_id: 'rt-1', action: 'X' });
    const future = new Date(Date.now() + 60_000).toISOString();
    const { rows } = listAudit({ entity_type: 'range-test', since: future });
    assert.equal(rows.length, 0);
  });

  it('since filter includes rows within range', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { rows } = listAudit({ entity_type: 'range-test', since: past });
    assert.ok(rows.length >= 1);
  });

  it('until filter excludes rows newer than threshold', () => {
    writeAudit({ entity_type: 'until-test', entity_id: 'ut-1', action: 'X' });
    const past = new Date(Date.now() - 60_000).toISOString();
    const { rows } = listAudit({ entity_type: 'until-test', until: past });
    assert.equal(rows.length, 0);
  });

  it('until filter includes rows within range', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { rows } = listAudit({ entity_type: 'until-test', until: future });
    assert.ok(rows.length >= 1);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('listAudit — pagination', () => {
  before(() => {
    // Seed 5 rows under a dedicated entity_type for pagination tests.
    for (let i = 1; i <= 5; i++) {
      writeAudit({ entity_type: 'page-test', entity_id: `pg-${i}`, action: 'CREATE' });
    }
  });

  it('limit restricts the number of returned rows', () => {
    const { rows, limit } = listAudit({ entity_type: 'page-test', limit: 3 });
    assert.equal(rows.length, 3);
    assert.equal(limit, 3);
  });

  it('offset skips rows (page 2 differs from page 1)', () => {
    const page1 = listAudit({ entity_type: 'page-test', limit: 2, offset: 0 });
    const page2 = listAudit({ entity_type: 'page-test', limit: 2, offset: 2 });
    const ids1 = page1.rows.map((r) => r.id);
    const ids2 = page2.rows.map((r) => r.id);
    assert.equal(ids1.length, 2);
    assert.equal(ids2.length, 2);
    assert.ok(!ids1.some((id) => ids2.includes(id)), 'pages should not overlap');
  });

  it('total remains correct regardless of limit/offset', () => {
    const { total } = listAudit({ entity_type: 'page-test', limit: 1, offset: 0 });
    assert.ok(total >= 5);
  });

  it('offset defaults to 0 and limit defaults to 50', () => {
    const result = listAudit();
    assert.equal(result.offset, 0);
    assert.equal(result.limit, 50);
  });
});
