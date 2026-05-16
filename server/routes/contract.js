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
const forecastAnomalies = require('../services/forecastAnomalies');
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
    mtd: (() => {
      // Phase 135 — required daily run-rate to stay above take-or-pay floor.
      const y = now.getUTCFullYear(), m = now.getUTCMonth();
      const daysInMonth   = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const dayOfMonth    = now.getUTCDate();
      const daysRemaining = Math.max(1, daysInMonth - dayOfMonth);
      const tonnesNeeded  = Math.max(0, mtdFloor - mtdDelivered);
      const reqDailyRate  = Number((tonnesNeeded / daysRemaining).toFixed(1));
      // Current run-rate from days elapsed
      const daysElapsed   = Math.max(1, dayOfMonth - 1);
      const currentDailyRate = Number((mtdDelivered / daysElapsed).toFixed(1));
      // Pace: projected total at current rate vs floor
      const projectedTotal = currentDailyRate * daysInMonth;
      const paceVerdict    = projectedTotal >= mtdFloor
        ? (projectedTotal >= mtdContracted ? 'AHEAD' : 'ON_TRACK')
        : 'AT_RISK';

      return {
        month:               currentMonthKey,
        contracted_tonnes:   mtdContracted,
        delivered_tonnes:    mtdDelivered,
        floor_tonnes:        mtdFloor,
        cushion_tonnes:      mtdCushion,
        attainment_pct:      attainmentPct,
        on_track:            mtdDelivered >= mtdFloor,
        has_live_data:       hasLiveData,
        live_convoy_count:   hasLiveData ? liveMtd.convoy_count : null,
        // Phase 135
        days_in_month:      daysInMonth,
        days_remaining:     daysRemaining,
        days_elapsed:       daysElapsed,
        tonnes_needed:      tonnesNeeded,
        required_daily_rate: reqDailyRate,
        current_daily_rate:  currentDailyRate,
        projected_total:     Math.round(projectedTotal),
        pace:                paceVerdict,
      };
    })(),
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
    // Phase 151 — forecast anomaly alerts. Each anomaly carries
    // { id, severity, body } consistent with intelligence observations.
    // Non-fatal: returns [] when history is too shallow for detection.
    anomalies: (() => {
      try { return forecastAnomalies.detect(); } catch (_) { return []; }
    })(),
    // Phase 223 — 6-month SLA attainment trend. Seeded monthly attainment %
    // anchored to a realistic corridor SLA of 85%. Months trending below the
    // SLA floor appear in rust on the chart to surface slippage early.
    sla_monthly_trend: (() => {
      function seededSLA(n) {
        const raw = Math.sin(n * 4523 + 41) * 78_003;
        return raw - Math.floor(raw);
      }
      const SLA_TARGET_PCT = 85;
      const result = [];
      for (let m = 5; m >= 0; m--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
        const monthKey = d.toISOString().slice(0, 7);
        const seed     = d.getUTCFullYear() * 1000 + d.getUTCMonth() * 17;
        const pct      = Math.round(78 + seededSLA(seed) * 16); // 78–94%
        result.push({ month: monthKey, attainment_pct: pct, target_pct: SLA_TARGET_PCT, modelled: true });
      }
      return result;
    })(),
    // Phase 162 — cumulative take-or-pay projection to year-end.
    // Past months: actual cumulative from DELIVERY_HISTORY + live MTD.
    // Future months: extrapolated at the current MTD daily run-rate.
    // Gives ops and lenders a single chart showing whether the corridor
    // will clear the take-or-pay floor by year-end at current pace.
    top_projection: (() => {
      const yr             = now.getUTCFullYear();
      const currentMonthIdx = now.getUTCMonth(); // 0-based
      const dayOfMonth     = now.getUTCDate();
      const daysElapsed    = Math.max(1, dayOfMonth - 1);
      const dailyRate      = mtdDelivered > 0
        ? mtdDelivered / daysElapsed
        : monthlyContracted / 30.44;
      const floorPct       = CONTRACT.take_or_pay_floor_pct;

      let cumActual = 0;
      let cumProj   = 0;
      let cumFloor  = 0;
      let cumTarget = 0;

      return Array.from({ length: 12 }, (_, m) => {
        const monthKey     = `${yr}-${String(m + 1).padStart(2, '0')}`;
        const isCurrentMonth = m === currentMonthIdx;
        const isPast         = m < currentMonthIdx;
        const isFuture       = m > currentMonthIdx;
        const daysInMonth    = new Date(Date.UTC(yr, m + 1, 0)).getUTCDate();

        cumFloor  += Math.round(monthlyContracted * floorPct);
        cumTarget += monthlyContracted;

        if (isPast) {
          const hist     = DELIVERY_HISTORY.find((h) => h.month === monthKey);
          const delivered = hist?.delivered ?? 0;
          cumActual += delivered;
          cumProj   += delivered;
        } else if (isCurrentMonth) {
          cumActual += mtdDelivered;
          cumProj   += Math.round(dailyRate * daysInMonth);
        } else {
          // isFuture
          cumProj += Math.round(dailyRate * daysInMonth);
        }

        return {
          month:                monthKey,
          cumulative_actual:    isPast || isCurrentMonth ? cumActual : null,
          cumulative_projected: isCurrentMonth || isFuture ? cumProj  : null,
          cumulative_floor:     cumFloor,
          cumulative_target:    cumTarget,
          is_current:           isCurrentMonth,
          is_future:            isFuture,
        };
      });
    })(),
  });
});

module.exports = router;
