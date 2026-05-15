'use strict';

/*
 * GET  /api/tranches                       — Capital deployment view.
 * GET  /api/tranches/:id/drawdown          — Current drawdown request for tranche (requireAuth).
 * POST /api/tranches/:id/drawdown          — Submit drawdown request (axis_admin, axis_ops).
 * PATCH /api/tranches/:id/drawdown         — Lender responds to request (lender).
 *
 * Phase 97 — drawdown request workflow added to the existing read-only route.
 */

const express = require('express');
const router = express.Router();

const { PROGRAMME, TRANCHES, CAPITAL_STRUCTURE } = require('../mock/tranches');
const drawdownRequests = require('../state/drawdownRequests');
const { requireAuth, requireRole } = require('../middleware/auth');

/* ── Programme + tranche list ─────────────────────────────────────── */

router.get('/', (_req, res) => {
  const tranches = TRANCHES.map((t) => ({
    ...t,
    gates_met:    t.gates.filter((g) => g.met).length,
    gates_total:  t.gates.length,
    all_gates_met: t.gates.every((g) => g.met),
  }));

  res.json({
    generated_at: new Date().toISOString(),
    programme:    PROGRAMME,
    tranches,
    capital:      CAPITAL_STRUCTURE,
  });
});

/* ── Drawdown request — read ─────────────────────────────────────── */

router.get('/:id/drawdown', requireAuth, (req, res) => {
  const { id } = req.params;
  const tranche = TRANCHES.find((t) => t.id === id);
  if (!tranche) return res.status(404).json({ error: 'Tranche not found' });

  const request = drawdownRequests.get(id);
  res.json({ tranche_id: id, request }); // request may be null
});

/* ── Drawdown request — submit ───────────────────────────────────── */

router.post(
  '/:id/drawdown',
  requireRole('axis_admin', 'axis_ops'),
  (req, res) => {
    const { id } = req.params;
    const tranche = TRANCHES.find((t) => t.id === id);
    if (!tranche) return res.status(404).json({ error: 'Tranche not found' });

    // Gate check — all gates must be met before a request can be submitted.
    const allMet = tranche.gates.every((g) => g.met);
    if (!allMet) {
      return res.status(422).json({
        error: 'Not all gate conditions are met',
        gates_met:   tranche.gates.filter((g) => g.met).length,
        gates_total: tranche.gates.length,
      });
    }

    const { amount_usd, notes } = req.body || {};
    const amount = Number(amount_usd);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount_usd is required and must be positive' });
    }

    try {
      const request = drawdownRequests.submit({
        trancheId:  id,
        userId:     req.user.id,
        userName:   req.user.display_name,
        amountUsd:  amount,
        notes:      String(notes || '').trim(),
      });
      res.status(201).json({ request });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  },
);

/* ── Drawdown request — lender responds ─────────────────────────── */

router.patch(
  '/:id/drawdown',
  requireRole('lender'),
  (req, res) => {
    const { id } = req.params;
    const tranche = TRANCHES.find((t) => t.id === id);
    if (!tranche) return res.status(404).json({ error: 'Tranche not found' });

    const { status, response_note } = req.body || {};
    const VALID = ['approved', 'rejected', 'info_requested'];
    if (!VALID.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${VALID.join(', ')}`,
      });
    }

    try {
      const request = drawdownRequests.respond({
        trancheId:        id,
        status,
        respondedByName:  req.user.display_name,
        responseNote:     String(response_note || '').trim(),
      });
      res.json({ request });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  },
);

module.exports = router;
