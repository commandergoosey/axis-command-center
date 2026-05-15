'use strict';

/*
 * onboardingChecklist — Phase 109.
 *
 * Tracks the four onboarding steps a pending hauler must complete before
 * they can be activated on the corridor. Steps are manually checked off
 * by axis_admin / axis_ops (and the hauler's own admin for the steps
 * they can action).
 *
 * Steps (in order):
 *   integration_configured — API token entered + probe passed, or manual
 *                            CSV mode acknowledged.
 *   driver_roster         — Driver roster uploaded and reviewed.
 *   fleet_manifest        — Truck plates and specs confirmed.
 *   contract_signed       — Hauler-side contract documentation filed.
 *
 * Activation is gated on all four steps being done (enforced in the
 * route, not here). Steps can be toggled back to undone if corrections
 * are needed.
 */

const db = require('../db');

const STEPS = ['integration_configured', 'driver_roster', 'fleet_manifest', 'contract_signed'];

const STEP_LABELS = {
  integration_configured: 'Configure integration',
  driver_roster:          'Upload driver roster',
  fleet_manifest:         'Verify fleet manifest',
  contract_signed:        'File signed contract',
};

const STEP_HINTS = {
  integration_configured: 'Set API token + run probe, or confirm Manual CSV mode.',
  driver_roster:          'Submit driver list with PSV classes and shift patterns.',
  fleet_manifest:         'Confirm GR-plate assignments and axle-load certs.',
  contract_signed:        'Upload countersigned haulage agreement to document store.',
};

db.exec(`
  CREATE TABLE IF NOT EXISTS onboarding_checklist (
    hauler_id  TEXT NOT NULL,
    step       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    done_by    TEXT,
    done_at    TEXT,
    PRIMARY KEY (hauler_id, step)
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO onboarding_checklist (hauler_id, step, done, done_by, done_at)
  VALUES (@hauler_id, @step, @done, @done_by, @done_at)
  ON CONFLICT(hauler_id, step) DO UPDATE SET
    done    = excluded.done,
    done_by = CASE WHEN excluded.done = 1 THEN excluded.done_by ELSE NULL END,
    done_at = CASE WHEN excluded.done = 1 THEN excluded.done_at ELSE NULL END
`);

const listStmt  = db.prepare('SELECT * FROM onboarding_checklist WHERE hauler_id = ?');
const countStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM onboarding_checklist WHERE hauler_id = ? AND done = 1',
);

function getChecklist(hauler_id) {
  const rows = listStmt.all(hauler_id);
  const byStep = Object.fromEntries(rows.map((r) => [r.step, r]));
  return STEPS.map((step) => ({
    step,
    label:   STEP_LABELS[step],
    hint:    STEP_HINTS[step],
    done:    byStep[step]?.done === 1,
    done_by: byStep[step]?.done_by ?? null,
    done_at: byStep[step]?.done_at ?? null,
  }));
}

function setStep(hauler_id, step, { done, by_display }) {
  if (!STEPS.includes(step)) throw new Error(`Unknown step: ${step}`);
  upsertStmt.run({
    hauler_id,
    step,
    done:    done ? 1 : 0,
    done_by: done ? (by_display || null) : null,
    done_at: done ? new Date().toISOString() : null,
  });
  return getChecklist(hauler_id);
}

function allComplete(hauler_id) {
  const { n } = countStmt.get(hauler_id);
  return n >= STEPS.length;
}

function completedCount(hauler_id) {
  return countStmt.get(hauler_id)?.n ?? 0;
}

module.exports = { STEPS, STEP_LABELS, getChecklist, setStep, allComplete, completedCount };
