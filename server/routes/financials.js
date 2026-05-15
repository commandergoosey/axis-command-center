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
const { aggregate, CONTRACT } = require('../services/aggregator');
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

  // Phase 129 — per-hauler revenue contribution.
  // Derived from the same aggregator used by the corridor view so numbers
  // are always consistent. Revenue = tonnes_delivered_mtd × effective tariff.
  // Outstanding receivable is allocated proportionally by contract_share.
  const agg = aggregate(roster.list(), new Date());
  const totalReceivable = PAYMENT_SECURITY.receivables.current_balance_usd ?? 0;
  const byHauler = agg.haulers
    .filter((h) => h.status === 'active')
    .map((h) => {
      const revenue_usd = Math.round(h.tonnes_delivered_mtd * CONTRACT.base_tariff_usd_per_tonne);
      const receivable_usd = Math.round(totalReceivable * h.contract_share);
      const total_revenue = agg.haulers
        .filter((x) => x.status === 'active')
        .reduce((s, x) => s + x.tonnes_delivered_mtd * CONTRACT.base_tariff_usd_per_tonne, 0);
      const corridor_share_pct = total_revenue > 0
        ? Number(((revenue_usd / total_revenue) * 100).toFixed(1))
        : 0;
      return {
        hauler_id:          h.id,
        display_name:       h.display_name,
        tonnes_mtd:         h.tonnes_delivered_mtd,
        tonnes_contracted:  h.tonnes_contracted_mtd,
        sla_attainment_pct: h.performance.sla_attainment_pct,
        revenue_usd,
        receivable_usd,
        corridor_share_pct,
      };
    });

  // Phase 156 — monthly P&L trend (Nov 2025 – current MTD).
  // Jan–Mar figures reconcile to PNL_YTD totals; Apr MTD is live from PNL_MTD.
  // Marked MODELLED per §12.4 for all months except the current MTD entry.
  const pnl_trend = [
    { month: '2025-11', revenue_usd:   820_000, operating_costs_usd:  720_000, ebitda_usd:  100_000, partial: false, modelled: true },
    { month: '2025-12', revenue_usd: 1_340_000, operating_costs_usd:  950_000, ebitda_usd:  390_000, partial: false, modelled: true },
    { month: '2026-01', revenue_usd: 1_750_000, operating_costs_usd: 1_110_000, ebitda_usd:  640_000, partial: false, modelled: true },
    { month: '2026-02', revenue_usd: 1_810_000, operating_costs_usd: 1_148_000, ebitda_usd:  662_000, partial: false, modelled: true },
    { month: '2026-03', revenue_usd: 1_837_000, operating_costs_usd: 1_162_000, ebitda_usd:  675_000, partial: false, modelled: true },
    { month: '2026-04', revenue_usd: PNL_MTD.revenue_usd, operating_costs_usd: PNL_MTD.operating_costs_usd, ebitda_usd: PNL_MTD.ebitda_usd, partial: true, modelled: false },
  ];

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
    pnl_trend,
    by_hauler: byHauler,   // Phase 129
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
