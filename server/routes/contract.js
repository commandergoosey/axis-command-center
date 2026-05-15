'use strict';

/*
 * GET /api/contract — GIBDLC contract dashboard.
 * Combines the aggregator (for MTD tonnage) with the contract fixtures
 * (historic delivery, SLA, payment security) and derives take-or-pay state.
 */

const express = require('express');
const router = express.Router();

const { aggregate, CONTRACT } = require('../services/aggregator');
const roster = require('../state/roster');
const convoyState = require('../state/convoyState');
const {
  DELIVERY_HISTORY,
  SLA_BREAKDOWN,
  PAYMENT_SECURITY,
  CONTRACT_TERMS,
} = require('../mock/contract');

router.get('/', (_req, res) => {
  const now = new Date();
  const agg = aggregate(roster.list(), now);

  const monthlyContracted = agg.tonnes.contracted_monthly;
  const mtdContracted     = agg.tonnes.contracted_mtd;

  // Phase 117 — blend live convoy dispatches into the MTD figure.
  // monthTonnage returns {total_tonnes, convoy_count} for the current calendar month.
  // When no live data exists, falls back to the modelled figure so the page
  // always has a meaningful number. Advisory: failure returns modelled data.
  const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let liveMtd = { total_tonnes: 0, convoy_count: 0 };
  try { liveMtd = convoyState.monthTonnage(currentMonthKey); } catch (_) { /* non-fatal */ }
  const hasLiveData = liveMtd.total_tonnes > 0;

  // When live data exists, use it as the delivered figure. When it doesn't,
  // fall back to the modelled delivered_mtd from the aggregator.
  const mtdDelivered = hasLiveData
    ? Math.round(liveMtd.total_tonnes * 10) / 10
    : agg.tonnes.delivered_mtd;

  const mtdFloor     = Math.round(mtdContracted * CONTRACT.take_or_pay_floor_pct);
  const mtdCushion        = mtdDelivered - mtdFloor;
  const attainmentPct     = mtdContracted > 0
    ? Number(((mtdDelivered / mtdContracted) * 100).toFixed(1))
    : 0;

  // Project this month into the history series so the YTD chart reads
  // consistently alongside the prior months.
  // (currentMonthKey is already computed above for Phase 117.)
  const history = [
    ...DELIVERY_HISTORY.filter((r) => r.month !== currentMonthKey),
    {
      month:       currentMonthKey,
      delivered:   mtdDelivered,
      contracted:  mtdContracted,
      floor:       mtdFloor,
      partial:     true,
    },
  ];

  const ytdDelivered = history.reduce((s, r) => s + r.delivered, 0);
  const ytdContracted = monthlyContracted * (new Date().getUTCMonth() + 1);
  const annualTarget  = monthlyContracted * 12;

  // Enrich payment security with computed timing figures.
  const sblcExpiry = new Date(PAYMENT_SECURITY.sblc.expiry);
  const daysToExpiry = Math.max(0, Math.round((sblcExpiry - now) / 86_400_000));
  const overdueUsd = PAYMENT_SECURITY.receivables.ageing.band_31_60
                    + PAYMENT_SECURITY.receivables.ageing.band_61_90
                    + PAYMENT_SECURITY.receivables.ageing.band_90p;
  const overduePct = PAYMENT_SECURITY.receivables.current_balance_usd > 0
    ? Number(((overdueUsd / PAYMENT_SECURITY.receivables.current_balance_usd) * 100).toFixed(1))
    : 0;

  res.json({
    generated_at: now.toISOString(),
    counterparty: CONTRACT_TERMS.counterparty,
    terms: CONTRACT_TERMS,
    contract_basis: {
      target_mtpa:             CONTRACT.target_mtpa,
      take_or_pay_floor_pct:   CONTRACT.take_or_pay_floor_pct * 100,
      monthly_tonnes_contracted: monthlyContracted,
      base_tariff_usd_per_tonne: CONTRACT.base_tariff_usd_per_tonne,
    },
    mtd: {
      month:               currentMonthKey,
      contracted_tonnes:   mtdContracted,
      delivered_tonnes:    mtdDelivered,
      floor_tonnes:        mtdFloor,
      cushion_tonnes:      mtdCushion,
      attainment_pct:      attainmentPct,
      on_track:            mtdDelivered >= mtdFloor,
      has_live_data:       hasLiveData,
      live_convoy_count:   hasLiveData ? liveMtd.convoy_count : null,
    },
    ytd: {
      contracted_tonnes: ytdContracted,
      delivered_tonnes:  ytdDelivered,
      annual_target:     annualTarget,
      attainment_pct:    ytdContracted > 0
        ? Number(((ytdDelivered / ytdContracted) * 100).toFixed(1))
        : 0,
    },
    history,
    sla: SLA_BREAKDOWN,
    payment_security: {
      ...PAYMENT_SECURITY,
      sblc: {
        ...PAYMENT_SECURITY.sblc,
        days_to_expiry: daysToExpiry,
      },
      receivables: {
        ...PAYMENT_SECURITY.receivables,
        overdue_pct: overduePct,
      },
    },
  });
});

module.exports = router;
