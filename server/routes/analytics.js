'use strict';

/*
 * GET /api/analytics — corridor performance analytics. Phase 96.
 *
 * Returns 12-week trailing weekly throughput, YTD progress vs the
 * GIBDLC tonnage minimum, and per-hauler contribution breakdown.
 *
 * All four roles can read this (same stance as /api/corridor and
 * /api/financials — the lender needs the trajectory view for
 * covenant monitoring; hauler admins see how they compare).
 *
 * No write endpoints on this route — it is a pure read-side
 * composition of existing operational + contract data.
 */

const express      = require('express');
const router       = express.Router();
const analytics    = require('../services/corridorAnalytics');
const convoyState  = require('../state/convoyState');
const roster       = require('../state/roster');
const { aggregate } = require('../services/aggregator');

router.get('/', (req, res) => {
  try {
    const base = analytics.compose();

    // Phase 127 — blend today's live convoy activity so the KPI strip can
    // show actual vs modelled throughput for the current day.
    let today_live = null;
    try {
      const dateKey = new Date().toISOString().slice(0, 10);
      const { total_tonnes, convoy_count } = convoyState.todayTonnage(dateKey);
      const active = convoyState.listActive();
      today_live = {
        date:             dateKey,
        convoy_count_today: convoy_count,
        tonnes_today:       Math.round(total_tonnes * 10) / 10,
        active_convoys:     active.length,
        has_live_data:      convoy_count > 0 || active.length > 0,
      };
    } catch (_) { /* non-fatal */ }

    // Phase 130 — per-hauler SLA & throughput for the attainment chart.
    // Merges live roster SLA records with the trailing analytics totals.
    let hauler_attainment = null;
    try {
      const agg = aggregate(roster.list(), new Date());
      const totalsById = Object.fromEntries(
        (base.hauler_totals ?? []).map((h) => [h.hauler_id, h]),
      );
      hauler_attainment = agg.haulers
        .filter((h) => h.status === 'active')
        .map((h) => ({
          hauler_id:           h.id,
          display_name:        h.display_name,
          tonnes_mtd:          h.tonnes_delivered_mtd,
          tonnes_contracted:   h.tonnes_contracted_mtd,
          sla_attainment_pct:  h.performance.sla_attainment_pct,
          on_time_pct:         totalsById[h.id]?.on_time_pct ?? h.performance.sla_attainment_pct,
          trailing_12w_tonnes: totalsById[h.id]?.tonnes ?? 0,
          trailing_share_pct:  totalsById[h.id]?.share_pct ?? 0,
        }));
    } catch (_) { /* non-fatal */ }

    res.json({ ...base, today_live, hauler_attainment });
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: 'Analytics composition failed' });
  }
});

module.exports = router;
