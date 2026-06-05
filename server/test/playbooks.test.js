'use strict';

/*
 * Tests for state/playbooks.js —
 *   add, update, archive, unarchive, remove, findById, listActive
 *
 * Uses in-memory SQLite. playbooks.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - add: name required; name > 120 chars throws; items required (non-empty);
 *     item title required; returns shaped row with id/name/items/created_by;
 *     schedule_label stored; created_by null when no by_user_id
 *   - update: null for unknown id; updates name/description; empty items throws;
 *     updates items when valid
 *   - archive: excluded from listActive; archived_at set
 *   - unarchive: re-included; archived_at null
 *   - remove: findById null after remove
 *   - findById: null for unknown; shaped row for known
 *   - listActive: array; includes active; excludes archived
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/playbooks')];
const pb = require('../state/playbooks');

function base(overrides = {}) {
  return {
    name:           'Monday compliance pass',
    description:    'Weekly safety and compliance review',
    schedule_label: 'Weekly, Monday morning',
    items: [
      { title: 'Check tyre pressures' },
      { title: 'Review axle load records' },
    ],
    by_user_id: 'u-ops-01',
    by_display: 'Ops Lead',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('playbooks — add', () => {
  it('throws when name is missing', () => {
    assert.throws(() => pb.add({ ...base(), name: '' }), /name required/i);
  });

  it('throws when name is only whitespace', () => {
    assert.throws(() => pb.add({ ...base(), name: '   ' }), /name required/i);
  });

  it('throws when name exceeds 120 chars', () => {
    assert.throws(() => pb.add({ ...base(), name: 'x'.repeat(121) }), /too long/i);
  });

  it('throws when items is empty array', () => {
    assert.throws(() => pb.add({ ...base(), items: [] }), /at least one item/i);
  });

  it('throws when items is null', () => {
    assert.throws(() => pb.add({ ...base(), items: null }), /at least one item/i);
  });

  it('throws when an item title is missing', () => {
    assert.throws(() => pb.add({ ...base(), items: [{ title: '' }] }), /title required/i);
  });

  it('returns a shaped row with numeric id', () => {
    const row = pb.add(base());
    assert.ok(row !== null && typeof row.id === 'number');
  });

  it('stores name', () => {
    const row = pb.add(base({ name: 'Friday EOM reconciliation' }));
    assert.equal(row.name, 'Friday EOM reconciliation');
  });

  it('stores description', () => {
    const row = pb.add(base({ description: 'End-of-month runbook' }));
    assert.equal(row.description, 'End-of-month runbook');
  });

  it('stores schedule_label', () => {
    const row = pb.add(base({ schedule_label: 'Daily, 06:00' }));
    assert.equal(row.schedule_label, 'Daily, 06:00');
  });

  it('items array is returned with correct length', () => {
    const row = pb.add(base({ items: [{ title: 'Step A' }, { title: 'Step B' }] }));
    assert.ok(Array.isArray(row.items));
    assert.equal(row.items.length, 2);
  });

  it('items titles are stored', () => {
    const row = pb.add(base({ items: [{ title: 'Alpha' }, { title: 'Beta' }] }));
    assert.equal(row.items[0].title, 'Alpha');
    assert.equal(row.items[1].title, 'Beta');
  });

  it('item default_owner_display is stored when provided', () => {
    const row = pb.add(base({ items: [{ title: 'Step', default_owner_display: 'Ops Lead' }] }));
    assert.equal(row.items[0].default_owner_display, 'Ops Lead');
  });

  it('created_by.user_id is set when by_user_id provided', () => {
    const row = pb.add(base({ by_user_id: 'u-x', by_display: 'X User', by_role: 'axis_admin' }));
    assert.equal(row.created_by.user_id, 'u-x');
    assert.equal(row.created_by.display_name, 'X User');
    assert.equal(row.created_by.role, 'axis_admin');
  });

  it('created_by is null when by_user_id not provided', () => {
    const row = pb.add({ name: 'No auth', items: [{ title: 'Item 1' }] });
    assert.equal(row.created_by, null);
  });

  it('archived_at is null on creation', () => {
    const row = pb.add(base());
    assert.equal(row.archived_at, null);
  });
});

// ── update ────────────────────────────────────────────────────────

describe('playbooks — update', () => {
  it('returns null for unknown id', () => {
    assert.equal(pb.update(999999, { name: 'Ghost' }), null);
  });

  it('updates name', () => {
    const row = pb.add(base({ name: 'Old name' }));
    const updated = pb.update(row.id, { name: 'New name' });
    assert.equal(updated.name, 'New name');
  });

  it('updates description', () => {
    const row = pb.add(base());
    const updated = pb.update(row.id, { description: 'Updated desc' });
    assert.equal(updated.description, 'Updated desc');
  });

  it('updates schedule_label', () => {
    const row = pb.add(base({ schedule_label: 'Old label' }));
    const updated = pb.update(row.id, { schedule_label: 'New label' });
    assert.equal(updated.schedule_label, 'New label');
  });

  it('throws when updating items to empty array', () => {
    const row = pb.add(base());
    assert.throws(() => pb.update(row.id, { items: [] }), /at least one item/i);
  });

  it('updates items when provided', () => {
    const row = pb.add(base());
    const updated = pb.update(row.id, { items: [{ title: 'New step' }] });
    assert.equal(updated.items.length, 1);
    assert.equal(updated.items[0].title, 'New step');
  });

  it('preserves unpatched fields', () => {
    const row = pb.add(base({ name: 'Keep me' }));
    const updated = pb.update(row.id, { description: 'Only desc' });
    assert.equal(updated.name, 'Keep me');
  });
});

// ── archive / unarchive ───────────────────────────────────────────

describe('playbooks — archive / unarchive', () => {
  it('archived playbook excluded from listActive', () => {
    const row = pb.add(base({ name: 'To archive' }));
    pb.archive(row.id);
    assert.ok(!pb.listActive().some((p) => p.id === row.id));
  });

  it('archived_at is set after archive', () => {
    const row = pb.add(base());
    pb.archive(row.id);
    assert.ok(pb.findById(row.id).archived_at !== null);
  });

  it('unarchive re-includes playbook in listActive', () => {
    const row = pb.add(base({ name: 'Unarchive me' }));
    pb.archive(row.id);
    pb.unarchive(row.id);
    assert.ok(pb.listActive().some((p) => p.id === row.id));
  });

  it('archived_at is null after unarchive', () => {
    const row = pb.add(base());
    pb.archive(row.id);
    pb.unarchive(row.id);
    assert.equal(pb.findById(row.id).archived_at, null);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('playbooks — remove', () => {
  it('findById returns null after remove', () => {
    const row = pb.add(base({ name: 'Remove me' }));
    pb.remove(row.id);
    assert.equal(pb.findById(row.id), null);
  });

  it('no-op on unknown id', () => {
    assert.doesNotThrow(() => pb.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('playbooks — findById', () => {
  it('returns null for unknown id', () => {
    assert.equal(pb.findById(999999), null);
  });

  it('returns shaped row for known id', () => {
    const row = pb.add(base({ name: 'Find me' }));
    const found = pb.findById(row.id);
    assert.ok(found !== null);
    assert.equal(found.name, 'Find me');
  });

  it('items field is an array', () => {
    const row = pb.add(base({ items: [{ title: 'A' }, { title: 'B' }] }));
    const found = pb.findById(row.id);
    assert.ok(Array.isArray(found.items));
    assert.equal(found.items.length, 2);
  });
});

// ── listActive ────────────────────────────────────────────────────

describe('playbooks — listActive', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(pb.listActive()));
  });

  it('includes active playbooks', () => {
    const row = pb.add(base({ name: 'Active playbook' }));
    assert.ok(pb.listActive().some((p) => p.id === row.id));
  });

  it('excludes archived playbooks', () => {
    const row = pb.add(base({ name: 'Hidden playbook' }));
    pb.archive(row.id);
    assert.ok(!pb.listActive().some((p) => p.id === row.id));
  });
});
