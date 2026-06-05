'use strict';

/*
 * Tests for state/rosterStore.js —
 *   add, update, all, find
 *
 * Uses in-memory SQLite. rosterStore.js creates its own hauler_records
 * table idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - add: stores hauler; returns deserialized row with _persisted: true;
 *     integration sub-object present; fleet sub-object present;
 *     stores contact fields when provided
 *   - update: returns updated hauler; COALESCE preserves display_name
 *     when null passed; contact_name/contact_email can be set to null;
 *     returns null for unknown id
 *   - all: returns array; includes added haulers
 *   - find: null for unknown id; returns deserialized row for known id;
 *     _persisted is true
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/rosterStore')];
const rs = require('../state/rosterStore');

let _seq = 0;
function hid() { return `haul-rs-${String(++_seq).padStart(3, '0')}`; }

function baseHauler(overrides = {}) {
  return {
    id:             hid(),
    display_name:   'Test Haulage Co',
    onboarded_date: '2026-01-01',
    status:         'active',
    integration:    { type: 'manual' },
    fleet:          { contracted_trucks: 5 },
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('rosterStore — add', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => rs.add(baseHauler()));
  });

  it('returns a deserialized row', () => {
    const row = rs.add(baseHauler());
    assert.ok(row !== null && typeof row === 'object');
  });

  it('_persisted is true', () => {
    const row = rs.add(baseHauler());
    assert.equal(row._persisted, true);
  });

  it('stores id correctly', () => {
    const h = baseHauler();
    const row = rs.add(h);
    assert.equal(row.id, h.id);
  });

  it('stores display_name', () => {
    const row = rs.add(baseHauler({ display_name: 'Ashanti Transport Ltd' }));
    assert.equal(row.display_name, 'Ashanti Transport Ltd');
  });

  it('stores status', () => {
    const row = rs.add(baseHauler({ status: 'pending' }));
    assert.equal(row.status, 'pending');
  });

  it('defaults status to pending when not provided', () => {
    const h = baseHauler();
    delete h.status;
    const row = rs.add(h);
    assert.equal(row.status, 'pending');
  });

  it('integration sub-object is present with type', () => {
    const row = rs.add(baseHauler({ integration: { type: 'manual' } }));
    assert.ok(typeof row.integration === 'object');
    assert.equal(row.integration.type, 'manual');
  });

  it('fleet sub-object is present with contracted_trucks', () => {
    const row = rs.add(baseHauler({ fleet: { contracted_trucks: 8 } }));
    assert.ok(typeof row.fleet === 'object');
    assert.equal(row.fleet.contracted_trucks, 8);
  });

  it('stores contact_name when provided', () => {
    const row = rs.add(baseHauler({ contact_name: 'Kofi Boateng' }));
    assert.equal(row.contact_name, 'Kofi Boateng');
  });

  it('stores contact_email when provided', () => {
    const row = rs.add(baseHauler({ contact_email: 'kofi@transport.gh' }));
    assert.equal(row.contact_email, 'kofi@transport.gh');
  });

  it('contact_name is null when not provided', () => {
    const row = rs.add(baseHauler());
    assert.equal(row.contact_name, null);
  });

  it('stores contract_share_pct when provided', () => {
    const row = rs.add(baseHauler({ contract_share_pct: 25.5 }));
    assert.equal(row.contract_share_pct, 25.5);
  });

  it('stores planned_start_date when provided', () => {
    const row = rs.add(baseHauler({ planned_start_date: '2026-03-01' }));
    assert.equal(row.planned_start_date, '2026-03-01');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('rosterStore — update', () => {
  it('returns null for unknown id', () => {
    assert.equal(rs.update('haul-never', { display_name: 'Ghost' }), null);
  });

  it('updates display_name', () => {
    const h = rs.add(baseHauler({ display_name: 'Old Name' }));
    const updated = rs.update(h.id, { display_name: 'New Name' });
    assert.equal(updated.display_name, 'New Name');
  });

  it('COALESCE — passing null for display_name preserves existing value', () => {
    const h = rs.add(baseHauler({ display_name: 'Keep Me' }));
    rs.update(h.id, { display_name: null });
    const found = rs.find(h.id);
    assert.equal(found.display_name, 'Keep Me');
  });

  it('updates status', () => {
    const h = rs.add(baseHauler({ status: 'pending' }));
    const updated = rs.update(h.id, { status: 'active' });
    assert.equal(updated.status, 'active');
  });

  it('contact_name can be set to null explicitly (direct assignment, not COALESCE)', () => {
    const h = rs.add(baseHauler({ contact_name: 'Old Contact' }));
    const updated = rs.update(h.id, { contact_name: null });
    assert.equal(updated.contact_name, null);
  });

  it('contact_email can be set to null explicitly', () => {
    const h = rs.add(baseHauler({ contact_email: 'old@email.com' }));
    const updated = rs.update(h.id, { contact_email: null });
    assert.equal(updated.contact_email, null);
  });

  it('updates planned_start_date', () => {
    const h = rs.add(baseHauler());
    const updated = rs.update(h.id, { planned_start_date: '2026-06-01' });
    assert.equal(updated.planned_start_date, '2026-06-01');
  });

  it('updates contracted_trucks', () => {
    const h = rs.add(baseHauler({ fleet: { contracted_trucks: 5 } }));
    const updated = rs.update(h.id, { contracted_trucks: 10 });
    assert.equal(updated.fleet.contracted_trucks, 10);
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('rosterStore — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rs.all()));
  });

  it('includes added haulers', () => {
    const h = rs.add(baseHauler());
    assert.ok(rs.all().some((r) => r.id === h.id));
  });

  it('returned rows have _persisted: true', () => {
    rs.add(baseHauler());
    const rows = rs.all();
    assert.ok(rows.every((r) => r._persisted === true));
  });
});

// ── find ──────────────────────────────────────────────────────────

describe('rosterStore — find', () => {
  it('returns null for unknown id', () => {
    assert.equal(rs.find('haul-never'), null);
  });

  it('returns deserialized row for known id', () => {
    const h = rs.add(baseHauler({ display_name: 'Find Me Co' }));
    const found = rs.find(h.id);
    assert.ok(found !== null);
    assert.equal(found.display_name, 'Find Me Co');
  });

  it('found row has _persisted: true', () => {
    const h = rs.add(baseHauler());
    assert.equal(rs.find(h.id)._persisted, true);
  });

  it('found row has integration sub-object', () => {
    const h = rs.add(baseHauler({ integration: { type: 'manual' } }));
    const found = rs.find(h.id);
    assert.ok(typeof found.integration === 'object');
  });

  it('found row has fleet sub-object', () => {
    const h = rs.add(baseHauler({ fleet: { contracted_trucks: 3 } }));
    const found = rs.find(h.id);
    assert.ok(typeof found.fleet === 'object');
    assert.equal(found.fleet.contracted_trucks, 3);
  });
});
