'use strict';

/*
 * Tests for state/onboardingChecklist.js —
 *   STEPS, STEP_LABELS, getChecklist, setStep, allComplete, completedCount
 *
 * Uses in-memory SQLite. onboardingChecklist.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - STEPS: array of 4 steps including expected values
 *   - STEP_LABELS: object keyed by step with display strings
 *   - getChecklist: returns exactly 4 items for any hauler id; all done:
 *     false for fresh hauler; items have step/label/hint/done/done_by/done_at
 *   - setStep: unknown step throws; marks step done; done_by stored;
 *     done_at is a recent ISO; marks step undone (done: false); undone
 *     clears done_by/done_at
 *   - allComplete: false initially; true after all 4 steps are done
 *   - completedCount: 0 initially; increments per step
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/onboardingChecklist')];
const oc = require('../state/onboardingChecklist');

let _seq = 0;
function hid() { return `haul-oc-${String(++_seq).padStart(3, '0')}`; }

// ── STEPS ─────────────────────────────────────────────────────────

describe('onboardingChecklist — STEPS', () => {
  it('is an array of 4 steps', () => {
    assert.ok(Array.isArray(oc.STEPS));
    assert.equal(oc.STEPS.length, 4);
  });

  it('contains the expected step keys', () => {
    for (const s of ['integration_configured', 'driver_roster', 'fleet_manifest', 'contract_signed']) {
      assert.ok(oc.STEPS.includes(s), `missing: ${s}`);
    }
  });
});

// ── STEP_LABELS ───────────────────────────────────────────────────

describe('onboardingChecklist — STEP_LABELS', () => {
  it('has a label for every step', () => {
    for (const step of oc.STEPS) {
      assert.ok(typeof oc.STEP_LABELS[step] === 'string', `missing label for: ${step}`);
    }
  });
});

// ── getChecklist ──────────────────────────────────────────────────

describe('onboardingChecklist — getChecklist', () => {
  it('returns exactly 4 items', () => {
    assert.equal(oc.getChecklist(hid()).length, 4);
  });

  it('all items are done: false for a fresh hauler', () => {
    const items = oc.getChecklist(hid());
    assert.ok(items.every((i) => i.done === false));
  });

  it('each item has step/label/hint/done/done_by/done_at', () => {
    const items = oc.getChecklist(hid());
    for (const item of items) {
      for (const f of ['step', 'label', 'hint', 'done', 'done_by', 'done_at']) {
        assert.ok(f in item, `missing field: ${f}`);
      }
    }
  });

  it('done_by and done_at are null for fresh items', () => {
    const items = oc.getChecklist(hid());
    assert.ok(items.every((i) => i.done_by === null && i.done_at === null));
  });
});

// ── setStep ───────────────────────────────────────────────────────

describe('onboardingChecklist — setStep', () => {
  it('throws for an unknown step', () => {
    assert.throws(() => oc.setStep(hid(), 'bogus_step', { done: true }), /unknown step/i);
  });

  it('marks a step done', () => {
    const h = hid();
    const result = oc.setStep(h, 'driver_roster', { done: true, by_display: 'Ops' });
    const item = result.find((i) => i.step === 'driver_roster');
    assert.equal(item.done, true);
  });

  it('stores done_by when marking done', () => {
    const h = hid();
    oc.setStep(h, 'fleet_manifest', { done: true, by_display: 'Fleet Admin' });
    const item = oc.getChecklist(h).find((i) => i.step === 'fleet_manifest');
    assert.equal(item.done_by, 'Fleet Admin');
  });

  it('done_at is a recent ISO when marking done', () => {
    const before = Date.now();
    const h = hid();
    oc.setStep(h, 'contract_signed', { done: true, by_display: 'Legal' });
    const after = Date.now();
    const item = oc.getChecklist(h).find((i) => i.step === 'contract_signed');
    const ts = new Date(item.done_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('marks a step undone', () => {
    const h = hid();
    oc.setStep(h, 'integration_configured', { done: true, by_display: 'Tech' });
    oc.setStep(h, 'integration_configured', { done: false });
    const item = oc.getChecklist(h).find((i) => i.step === 'integration_configured');
    assert.equal(item.done, false);
  });

  it('done_by and done_at are null after marking undone', () => {
    const h = hid();
    oc.setStep(h, 'driver_roster', { done: true, by_display: 'Ops' });
    oc.setStep(h, 'driver_roster', { done: false });
    const item = oc.getChecklist(h).find((i) => i.step === 'driver_roster');
    assert.equal(item.done_by, null);
    assert.equal(item.done_at, null);
  });
});

// ── allComplete ───────────────────────────────────────────────────

describe('onboardingChecklist — allComplete', () => {
  it('returns false for a fresh hauler', () => {
    assert.equal(oc.allComplete(hid()), false);
  });

  it('returns false when only some steps are done', () => {
    const h = hid();
    oc.setStep(h, 'integration_configured', { done: true });
    oc.setStep(h, 'driver_roster', { done: true });
    assert.equal(oc.allComplete(h), false);
  });

  it('returns true when all 4 steps are done', () => {
    const h = hid();
    for (const step of oc.STEPS) {
      oc.setStep(h, step, { done: true, by_display: 'Admin' });
    }
    assert.equal(oc.allComplete(h), true);
  });
});

// ── completedCount ────────────────────────────────────────────────

describe('onboardingChecklist — completedCount', () => {
  it('returns 0 for a fresh hauler', () => {
    assert.equal(oc.completedCount(hid()), 0);
  });

  it('increments as steps are completed', () => {
    const h = hid();
    oc.setStep(h, 'integration_configured', { done: true });
    assert.equal(oc.completedCount(h), 1);
    oc.setStep(h, 'driver_roster', { done: true });
    assert.equal(oc.completedCount(h), 2);
  });

  it('returns 4 when all steps are done', () => {
    const h = hid();
    for (const step of oc.STEPS) oc.setStep(h, step, { done: true });
    assert.equal(oc.completedCount(h), 4);
  });
});
