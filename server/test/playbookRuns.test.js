'use strict';

/*
 * Tests for state/playbookRuns.js —
 *   ITEM_STATUSES, run, completeItem, reopenItem, findRun, findItem,
 *   itemsForRun, runsForPlaybook, recentRuns, openItems
 *
 * Uses in-memory SQLite. playbookRuns.js creates its own tables but has a
 * FOREIGN KEY on playbooks(id). playbooks.js is loaded first so the parent
 * table exists before the FK is established.
 *
 * Covers:
 *   - ITEM_STATUSES: array with 'open' and 'done'
 *   - run: returns {run, items}; run has id/playbook_id/started_at;
 *     items has title from playbook template; all items initially 'open'
 *   - completeItem: item status becomes 'done'; completed_at set; completed_by stored;
 *     run auto-completes when all items done
 *   - reopenItem: item status reverts to 'open'; completed_at/by cleared;
 *     run completed_at cleared when not all items done
 *   - findRun: null for unknown; shaped run for known
 *   - findItem: null for unknown; shaped item for known
 *   - itemsForRun: returns items for a run in sort_index order
 *   - runsForPlaybook: returns runs for a playbook; includes counts
 *   - recentRuns: returns recent runs; respects limit
 *   - openItems: returns open items across all runs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

// Load playbooks first — creates the playbooks table that playbookRuns FKs into.
delete require.cache[require.resolve('../state/playbooks')];
const pb = require('../state/playbooks');

delete require.cache[require.resolve('../state/playbookRuns')];
const pr = require('../state/playbookRuns');

// Fixture playbook used across multiple tests.
const PLAYBOOK = pb.add({
  name:  'Test playbook',
  items: [
    { title: 'Step Alpha' },
    { title: 'Step Beta' },
    { title: 'Step Gamma' },
  ],
});

// ── ITEM_STATUSES ─────────────────────────────────────────────────

describe('playbookRuns — ITEM_STATUSES', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(pr.ITEM_STATUSES));
  });

  it('contains open and done', () => {
    assert.ok(pr.ITEM_STATUSES.includes('open'));
    assert.ok(pr.ITEM_STATUSES.includes('done'));
  });
});

// ── run ───────────────────────────────────────────────────────────

describe('playbookRuns — run', () => {
  it('returns an object with run and items', () => {
    const result = pr.run(PLAYBOOK, {});
    assert.ok('run' in result && 'items' in result);
  });

  it('run has id and playbook_id', () => {
    const { run } = pr.run(PLAYBOOK, {});
    assert.ok(typeof run.id === 'number' && run.id > 0);
    assert.equal(run.playbook_id, PLAYBOOK.id);
  });

  it('run has playbook_name', () => {
    const { run } = pr.run(PLAYBOOK, {});
    assert.equal(run.playbook_name, PLAYBOOK.name);
  });

  it('run started_at is a recent ISO', () => {
    const before = Date.now();
    const { run } = pr.run(PLAYBOOK, {});
    const after = Date.now();
    const ts = new Date(run.started_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('run completed_at is null on creation', () => {
    const { run } = pr.run(PLAYBOOK, {});
    assert.equal(run.completed_at, null);
  });

  it('items count matches playbook item count', () => {
    const { items } = pr.run(PLAYBOOK, {});
    assert.equal(items.length, PLAYBOOK.items.length);
  });

  it('item titles match playbook template', () => {
    const { items } = pr.run(PLAYBOOK, {});
    assert.equal(items[0].title, 'Step Alpha');
    assert.equal(items[1].title, 'Step Beta');
  });

  it('all items are initially open', () => {
    const { items } = pr.run(PLAYBOOK, {});
    assert.ok(items.every((i) => i.status === 'open'));
  });

  it('stores started_by when by_user_id provided', () => {
    const { run } = pr.run(PLAYBOOK, { by_user_id: 'u-ops', by_display: 'Ops Lead', by_role: 'axis_ops' });
    assert.ok(run.started_by !== null);
    assert.equal(run.started_by.user_id, 'u-ops');
  });

  it('started_by is null when by_user_id not provided', () => {
    const { run } = pr.run(PLAYBOOK, {});
    assert.equal(run.started_by, null);
  });
});

// ── completeItem ──────────────────────────────────────────────────

describe('playbookRuns — completeItem', () => {
  it('item status becomes done', () => {
    const { items } = pr.run(PLAYBOOK, {});
    const updated = pr.completeItem(items[0].id, 'Ops Lead');
    assert.equal(updated.status, 'done');
  });

  it('completed_at is set to a recent ISO', () => {
    const before = Date.now();
    const { items } = pr.run(PLAYBOOK, {});
    const updated = pr.completeItem(items[0].id);
    const after = Date.now();
    const ts = new Date(updated.completed_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('completed_by is stored', () => {
    const { items } = pr.run(PLAYBOOK, {});
    const updated = pr.completeItem(items[0].id, 'HSE Manager');
    assert.equal(updated.completed_by, 'HSE Manager');
  });

  it('completeItem is idempotent on already-done item', () => {
    const { items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id, 'First');
    const second = pr.completeItem(items[0].id, 'Second');
    // Status should still be done; completed_at/by should be from the first call
    // because the UPDATE has WHERE status = 'open'
    assert.equal(second.status, 'done');
  });

  it('run auto-completes when all items done', () => {
    // Use a single-item playbook so we can complete all items at once
    const singlePb = pb.add({ name: 'Single item', items: [{ title: 'Only step' }] });
    const { run, items } = pr.run(singlePb, {});
    pr.completeItem(items[0].id, 'Admin');
    const found = pr.findRun(run.id);
    assert.ok(found.completed_at !== null);
  });

  it('run does NOT auto-complete when not all items done', () => {
    const { run, items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id);
    const found = pr.findRun(run.id);
    assert.equal(found.completed_at, null);
  });
});

// ── reopenItem ────────────────────────────────────────────────────

describe('playbookRuns — reopenItem', () => {
  it('item status reverts to open', () => {
    const { items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id);
    const reopened = pr.reopenItem(items[0].id);
    assert.equal(reopened.status, 'open');
  });

  it('completed_at is cleared', () => {
    const { items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id);
    const reopened = pr.reopenItem(items[0].id);
    assert.equal(reopened.completed_at, null);
  });

  it('completed_by is cleared', () => {
    const { items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id, 'Ops');
    const reopened = pr.reopenItem(items[0].id);
    assert.equal(reopened.completed_by, null);
  });

  it('run completed_at is cleared when item reopened after all done', () => {
    const singlePb = pb.add({ name: 'Reopen test', items: [{ title: 'Step' }] });
    const { run, items } = pr.run(singlePb, {});
    pr.completeItem(items[0].id);
    pr.reopenItem(items[0].id);
    const found = pr.findRun(run.id);
    assert.equal(found.completed_at, null);
  });
});

// ── findRun ───────────────────────────────────────────────────────

describe('playbookRuns — findRun', () => {
  it('returns null for unknown run id', () => {
    assert.equal(pr.findRun(999999), null);
  });

  it('returns shaped run for known id', () => {
    const { run } = pr.run(PLAYBOOK, {});
    const found = pr.findRun(run.id);
    assert.ok(found !== null);
    assert.equal(found.id, run.id);
    assert.equal(found.playbook_id, PLAYBOOK.id);
  });
});

// ── findItem ──────────────────────────────────────────────────────

describe('playbookRuns — findItem', () => {
  it('returns null for unknown item id', () => {
    assert.equal(pr.findItem(999999), null);
  });

  it('returns shaped item for known id', () => {
    const { items } = pr.run(PLAYBOOK, {});
    const found = pr.findItem(items[0].id);
    assert.ok(found !== null);
    assert.equal(found.title, 'Step Alpha');
  });
});

// ── itemsForRun ───────────────────────────────────────────────────

describe('playbookRuns — itemsForRun', () => {
  it('returns array of items for the run', () => {
    const { run, items } = pr.run(PLAYBOOK, {});
    const found = pr.itemsForRun(run.id);
    assert.ok(Array.isArray(found));
    assert.equal(found.length, items.length);
  });

  it('items are in sort_index order', () => {
    const { run } = pr.run(PLAYBOOK, {});
    const found = pr.itemsForRun(run.id);
    for (let i = 1; i < found.length; i++) {
      assert.ok(found[i].sort_index >= found[i - 1].sort_index);
    }
  });

  it('returns empty array for unknown run_id', () => {
    assert.deepEqual(pr.itemsForRun(999999), []);
  });
});

// ── runsForPlaybook ───────────────────────────────────────────────

describe('playbookRuns — runsForPlaybook', () => {
  it('returns array of runs for the playbook', () => {
    pr.run(PLAYBOOK, {});
    const runs = pr.runsForPlaybook(PLAYBOOK.id);
    assert.ok(Array.isArray(runs) && runs.length >= 1);
  });

  it('each run includes counts object with total and done', () => {
    pr.run(PLAYBOOK, {});
    const runs = pr.runsForPlaybook(PLAYBOOK.id);
    const r = runs[0];
    assert.ok('counts' in r);
    assert.ok('total' in r.counts && 'done' in r.counts);
  });

  it('counts.total equals number of items in template', () => {
    const { run } = pr.run(PLAYBOOK, {});
    const runs = pr.runsForPlaybook(PLAYBOOK.id);
    const found = runs.find((r) => r.id === run.id);
    assert.equal(found.counts.total, PLAYBOOK.items.length);
  });

  it('counts.done reflects completed items', () => {
    const { run, items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id);
    const runs = pr.runsForPlaybook(PLAYBOOK.id);
    const found = runs.find((r) => r.id === run.id);
    assert.ok(found.counts.done >= 1);
  });

  it('respects the limit parameter', () => {
    const runs = pr.runsForPlaybook(PLAYBOOK.id, 1);
    assert.ok(runs.length <= 1);
  });
});

// ── recentRuns ────────────────────────────────────────────────────

describe('playbookRuns — recentRuns', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(pr.recentRuns()));
  });

  it('includes recently created runs', () => {
    const { run } = pr.run(PLAYBOOK, {});
    const recent = pr.recentRuns(50);
    assert.ok(recent.some((r) => r.id === run.id));
  });

  it('respects the limit parameter', () => {
    const recent = pr.recentRuns(1);
    assert.ok(recent.length <= 1);
  });

  it('each run includes counts', () => {
    const recent = pr.recentRuns(5);
    if (recent.length > 0) {
      assert.ok('counts' in recent[0]);
    }
  });
});

// ── openItems ─────────────────────────────────────────────────────

describe('playbookRuns — openItems', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(pr.openItems()));
  });

  it('includes open items from recent runs', () => {
    const { items } = pr.run(PLAYBOOK, {});
    const open = pr.openItems(100);
    // At least some of our items should appear
    assert.ok(open.some((i) => i.id === items[0].id || i.id === items[1].id));
  });

  it('does not include completed items', () => {
    const { items } = pr.run(PLAYBOOK, {});
    pr.completeItem(items[0].id);
    const open = pr.openItems(100);
    assert.ok(!open.some((i) => i.id === items[0].id));
  });

  it('respects the limit parameter', () => {
    const open = pr.openItems(1);
    assert.ok(open.length <= 1);
  });
});
