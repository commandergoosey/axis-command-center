'use strict';

/*
 * GET /api/financials — lender-facing snapshot.
 * DSCR current + trend, P&L (MTD + YTD), covenant table, receivables
 * ageing (reused from contract fixtures), and 90-day cashflow forecast.
 */

const express = require('express');
const router = express.Router();

const { PNL_MTD, PNL_YTD, CASHFLOW_FORECAST } = require('../mock/financials');
const { PAYMENT_SECURITY } = require('../mock/contract');
const { CAPITAL_STRUCTURE } = require('../mock/tranches');
const { buildCovenants } = require('../services/covenants');
const dscrService = require('../services/dscr');
const roster = require('../state/roster');
const receivableFollowups = require('../state/receivableFollowups');
const { writeAudit } = require('../db/audit');
const { requireRole, requireAuth } = require('../middleware/auth');

router.get('/', (_req, res) => {
  const overdueUsd = PAYMENT_SECURITY.receivables.ageing.band_31_60
                    + PAYMENT_SECURITY.receivables.ageing.band_61_90
                    + PAYMENT_SECURITY.receivables.ageing.band_90p;
  const overduePct = PAYMENT_SECURITY.receivables.current_balance_usd > 0
    ? Number(((overdueUsd / PAYMENT_SECURITY.receivables.current_balance_usd) * 100).toFixed(1))
    : 0;

  // Phase 62 — DSCR now computed live from MTD revenue + debt service.
  // Falls back to static fixture if the math throws (defensive).
  const dscr = dscrService.compute(roster.list(), new Date());

  res.json({
    generated_at: new Date().toISOString(),
    dscr,
    capital: {
      debt_committed_usd:   CAPITAL_STRUCTURE.debt_committed_usd,
      debt_drawn_usd:       CAPITAL_STRUCTURE.debt_drawn_usd,
      equity_committed_usd: CAPITAL_STRUCTURE.equity_committed_usd,
      equity_drawn_usd:     CAPITAL_STRUCTURE.equity_drawn_usd,
    },
    pnl: {
      mtd: PNL_MTD,
      ytd: PNL_YTD,
    },
    // Phase 52 — covenants now live-computed from corridor state.
    // The static fixture is replaced by buildCovenants(), which adds
    // the take-or-pay floor, hauler concentration, and SLA-threshold
    // tests the fixture didn't carry.
    covenants: buildCovenants(roster.list(), new Date()),
    receivables: {
      ...PAYMENT_SECURITY.receivables,
      overdue_pct: overduePct,
      // Phase 64 — surface chase activity counts per band so the UI
      // can render "$280,000 · 3 followups" without an extra fetch.
      followup_counts: receivableFollowups.countsByBand(),
    },
    cashflow: CASHFLOW_FORECAST,
  });
});

// ── Phase 64 — Receivables collection workflow ────────────────────
//
// Per-band chase activity log. Read-open to anyone with financial
// access (axis_admin/ops/lender — lender SHOULD see chase activity
// since it directly affects covenant compliance). Writes restricted
// to axis_admin / axis_ops; hauler_admin and lender are read-only.
const COLLECTION_WRITE_ROLES = ['axis_admin', 'axis_ops'];

router.get('/receivables/followups', requireAuth, (req, res) => {
  const band = req.query.band;
  const items = band ? receivableFollowups.forBand(band) : receivableFollowups.all();
  res.json({ followups: items });
});

router.post('/receivables/followups', requireRole(...COLLECTION_WRITE_ROLES), (req, res) => {
  const { band_id, notes, outcome } = req.body ?? {};
  try {
    const followup = receivableFollowups.add({
      band_id,
      notes,
      outcome,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'receivable_followup',
      entity_id:   String(followup.id),
      action:      'create',
      summary:     `Receivables chase · ${band_id} · ${outcome} — ${followup.notes.slice(0, 80)}`,
      payload:     { band_id, outcome },
    });
    res.json({ followup });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/receivables/followups/:id', requireRole(...COLLECTION_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = receivableFollowups.findById(id);
  if (!existing) return res.status(404).json({ error: 'Followup not found' });
  // Only the author or an axis_admin can delete.
  const allowed = req.user.role === 'axis_admin' || existing.author.user_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: 'Only the author or an admin can delete' });
  receivableFollowups.remove(id);
  writeAudit({
    req,
    entity_type: 'receivable_followup',
    entity_id:   String(id),
    action:      'delete',
    summary:     `Receivables chase deleted (${existing.band_id} · ${existing.outcome})`,
    payload:     { band_id: existing.band_id },
  });
  res.json({ deleted: true });
});

module.exports = router;
