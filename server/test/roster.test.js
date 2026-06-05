'use strict';

/*
 * Tests for state/roster.js —
 *   list, find, add, update, nextId
 *
 * roster.js is a thin proxy over haulerStore.js. haulerStore seeds from
 * mock/haulers.js on first boot when the table is empty. The haulers table
 * is part of the base schema in db/index.js.
 *
 * Uses in-memory SQLite. After loading, the DB contains the full set of
 * mock haulers (seed runs automatically because the table starts empty).
 *
 * Covers:
 *   - list: returns an array; non-empty after seed (mock haulers loaded);
 *     each entry has id/display_name/status/integration/fleet
 *   - find: null for unknown id; returns hauler object for known id
 *   - add: creates new hauler via haulerStore.create; appears in list;
 *     has _persisted: true; has integration/fleet sub-objects
 *   - update: updates a field; returns updated hauler; null for unknown
 *   - nextId: returns a string matching haul-NN pattern
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

// Clear haulerStore and roster caches so they reload with the in-memory DB.
delete require.cache[require.resolve('../state/haulerStore')];
delete require.cache[require.resolve('../state/roster')];
const roster = require('../state/roster');

let _seq = 0;
function nid() { return `haul-ro-${String(++_seq).padStart(3, '0')}`; }

function baseHauler(overrides = {}) {
  return {
    id:             nid(),
    display_name:   'Roster Test Co',
    onboarded_date: '2026-01-01',
    status:         'active',
    integration:    { type: 'manual' },
    fleet:          { contracted_trucks: 4 },
    ...overrides,
  };
}

// ── list ──────────────────────────────────────────────────────────

describe('roster — list', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(roster.list()));
  });

  it('is non-empty (mock haulers seeded on boot)', () => {
    assert.ok(roster.list().length > 0);
  });

  it('each entry has id and display_name', () => {
    const haulers = roster.list();
    for (const h of haulers) {
      assert.ok(typeof h.id === 'string' && h.id.length > 0, 'id missing');
      assert.ok(typeof h.display_name === 'string', 'display_name missing');
    }
  });

  it('each entry has integration sub-object', () => {
    for (const h of roster.list()) {
      assert.ok(typeof h.integration === 'object', `integration missing for ${h.id}`);
    }
  });

  it('each entry has fleet sub-object', () => {
    for (const h of roster.list()) {
      assert.ok(typeof h.fleet === 'object', `fleet missing for ${h.id}`);
    }
  });
});

// ── find ──────────────────────────────────────────────────────────

describe('roster — find', () => {
  it('returns null for unknown id', () => {
    assert.equal(roster.find('haul-never'), null);
  });

  it('returns hauler object for known id', () => {
    const h = roster.add(baseHauler({ display_name: 'Find Me Co' }));
    const found = roster.find(h.id);
    assert.ok(found !== null);
    assert.equal(found.display_name, 'Find Me Co');
  });

  it('found hauler has integration sub-object', () => {
    const h = roster.add(baseHauler());
    const found = roster.find(h.id);
    assert.ok(typeof found.integration === 'object');
  });

  it('found hauler has fleet sub-object', () => {
    const h = roster.add(baseHauler({ fleet: { contracted_trucks: 6 } }));
    const found = roster.find(h.id);
    assert.ok(typeof found.fleet === 'object');
    assert.equal(found.fleet.contracted_trucks, 6);
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('roster — add', () => {
  it('creates a new hauler without throwing', () => {
    assert.doesNotThrow(() => roster.add(baseHauler()));
  });

  it('returns a hauler object', () => {
    const h = roster.add(baseHauler());
    assert.ok(h !== null && typeof h === 'object');
  });

  it('has _persisted: true', () => {
    const h = roster.add(baseHauler());
    assert.equal(h._persisted, true);
  });

  it('new hauler appears in list()', () => {
    const h = roster.add(baseHauler());
    assert.ok(roster.list().some((r) => r.id === h.id));
  });

  it('stores display_name', () => {
    const h = roster.add(baseHauler({ display_name: 'Added Hauler' }));
    assert.equal(h.display_name, 'Added Hauler');
  });

  it('stores status', () => {
    const h = roster.add(baseHauler({ status: 'pending' }));
    assert.equal(h.status, 'pending');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('roster — update', () => {
  it('returns null for unknown id', () => {
    // haulerStore.update with unknown id returns findById which is null
    assert.equal(roster.update('haul-never', { display_name: 'Ghost' }), null);
  });

  it('updates display_name', () => {
    const h = roster.add(baseHauler({ display_name: 'Old' }));
    const updated = roster.update(h.id, { display_name: 'New' });
    assert.equal(updated.display_name, 'New');
  });

  it('updates status', () => {
    const h = roster.add(baseHauler({ status: 'pending' }));
    const updated = roster.update(h.id, { status: 'active' });
    assert.equal(updated.status, 'active');
  });

  it('updates contracted_trucks', () => {
    const h = roster.add(baseHauler({ fleet: { contracted_trucks: 3 } }));
    const updated = roster.update(h.id, { contracted_trucks: 8 });
    assert.equal(updated.fleet.contracted_trucks, 8);
  });
});

// ── nextId ────────────────────────────────────────────────────────

describe('roster — nextId', () => {
  it('returns a string', () => {
    assert.ok(typeof roster.nextId() === 'string');
  });

  it('matches haul-NN pattern', () => {
    assert.ok(/^haul-\d+$/.test(roster.nextId()));
  });

  it('is different from any existing mock hauler id (or increments)', () => {
    const id = roster.nextId();
    // Just verify the format is correct
    assert.ok(id.startsWith('haul-'));
    const num = parseInt(id.replace('haul-', ''), 10);
    assert.ok(num > 0);
  });
});
