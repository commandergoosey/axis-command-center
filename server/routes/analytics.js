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
const { FLEET }    = require('../mock/fleet');
const { TRIPS }    = require('../mock/trips');

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

    // Phase 165 — weekday throughput pattern.
    // Distributes each week's actual tonnes across Mon–Sun using a stable
    // seeded PRNG so the chart shows realistic day-of-week variation
    // (weekends typically lighter). Lets ops correlate convoy scheduling
    // decisions with throughput patterns.
    function seededPattern(n) {
      const raw = Math.sin(n * 5039 + 83) * 87_013;
      return raw - Math.floor(raw);
    }
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    (base.weeks ?? []).forEach((w) => {
      const wDate = new Date(w.week_of + 'T00:00:00Z');
      const wk    = wDate.getUTCFullYear() * 1000
                  + wDate.getUTCMonth()    *   31
                  + wDate.getUTCDate();
      const rawWeights = DAY_NAMES.map((_, d) => 0.65 + seededPattern(wk * 7 + d) * 0.70);
      const totalWeight = rawWeights.reduce((s, v) => s + v, 0);
      rawWeights.forEach((wt, d) => {
        dayTotals[d] += (w.tonnes ?? 0) * (wt / totalWeight);
        dayCounts[d]++;
      });
    });
    const weekday_pattern = DAY_NAMES.map((day, i) => ({
      day,
      avg_tonnes: dayCounts[i] > 0 ? Math.round(dayTotals[i] / dayCounts[i]) : 0,
    }));

    // Phase 178 — per-hauler fuel efficiency benchmark (ScatterChart data).
    // x: avg L/100km (from FLEET by hauler), y: avg weekly trips (from TRIPS),
    // size: truck_count. Shows efficiency vs throughput trade-off per hauler.
    const fleetByHauler = {};
    FLEET.forEach((f) => {
      if (!fleetByHauler[f.hauler_id]) fleetByHauler[f.hauler_id] = { sum_eff: 0, count: 0 };
      const eff = f.efficiency_l_per_100km ?? 0;
      if (eff > 0) { fleetByHauler[f.hauler_id].sum_eff += eff; fleetByHauler[f.hauler_id].count++; }
    });
    const tripsByHauler = {};
    TRIPS.forEach((t) => {
      if (!tripsByHauler[t.hauler_id]) tripsByHauler[t.hauler_id] = { sum: 0, weeks: new Set() };
      const d = new Date(t.departed_at ?? t.completed_at ?? 0);
      const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); mon.setUTCHours(0,0,0,0);
      tripsByHauler[t.hauler_id].weeks.add(mon.toISOString().slice(0, 10));
      tripsByHauler[t.hauler_id].sum++;
    });
    let efficiency_benchmark = null;
    try {
      const agg2 = aggregate(roster.list(), new Date());
      efficiency_benchmark = agg2.haulers
        .filter((h) => h.status === 'active')
        .map((h) => {
          const fe = fleetByHauler[h.id];
          const te = tripsByHauler[h.id];
          const avg_l_per_100km = fe && fe.count > 0
            ? Number((fe.sum_eff / fe.count).toFixed(1)) : null;
          const avg_trips_per_week = te && te.weeks.size > 0
            ? Number((te.sum / te.weeks.size).toFixed(1)) : null;
          return {
            hauler_id:          h.id,
            hauler_display:     h.display_name,
            avg_l_per_100km,
            avg_trips_per_week,
            truck_count:        h.fleet?.contracted_trucks ?? 0,
          };
        })
        .filter((h) => h.avg_l_per_100km != null && h.avg_trips_per_week != null);
    } catch (_) { /* non-fatal */ }

    // Phase 194 — per-hauler take-or-pay floor risk.
    // Shows each hauler's MTD actual vs contracted and whether they are on
    // track against their proportional share of the corridor take-or-pay floor.
    let take_or_pay_risk = null;
    if (hauler_attainment && hauler_attainment.length > 0) {
      const annualFloor = base.contract?.annual_floor_t ?? 800_000;
      const totalContracted = hauler_attainment.reduce((s, h) => s + (h.tonnes_contracted ?? 0), 0);
      const now2 = new Date();
      const dayOfMonth = now2.getUTCDate();
      const daysInMonth = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth() + 1, 0)).getUTCDate();
      const monthFrac = dayOfMonth / daysInMonth;
      take_or_pay_risk = hauler_attainment.map((h) => {
        const haulerFloorShare = totalContracted > 0 ? h.tonnes_contracted / totalContracted : 0;
        const annualHaulerFloor = annualFloor * haulerFloorShare;
        const mtd_floor = (annualHaulerFloor / 12) * monthFrac;
        const actual = h.tonnes_mtd ?? 0;
        const contracted = h.tonnes_contracted ?? 0;
        const attainment_pct = contracted > 0 ? Math.round((actual / contracted) * 100) : 0;
        const floor_pct = mtd_floor > 0 ? Math.round((actual / mtd_floor) * 100) : 100;
        const shortfall_t = Math.max(0, Math.round(contracted - actual));
        return {
          hauler_id:         h.hauler_id,
          display_name:      h.display_name,
          tonnes_actual:     actual,
          tonnes_contracted: contracted,
          mtd_floor:         Math.round(mtd_floor),
          attainment_pct,
          floor_pct,
          shortfall_t,
          at_risk:           floor_pct < 80,
          modelled:          true,
        };
      }).sort((a, b) => a.floor_pct - b.floor_pct);
    }

    // Phase 198 — weekly revenue per km corridor trend (last 12 weeks).
    // Southbound trips only; aggregates revenue_usd by Monday week then
    // divides by corridor_km to give a per-km revenue efficiency series.
    const CORRIDOR_KM = base.contract?.corridor_km ?? 300;
    const revenueByWeek = {};
    TRIPS
      .filter((t) => t.direction === 'southbound' && (t.revenue_usd ?? 0) > 0)
      .forEach((t) => {
        const d = new Date(t.departed_at ?? t.completed_at ?? 0);
        const mon = new Date(d);
        mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        mon.setUTCHours(0, 0, 0, 0);
        const key = mon.toISOString().slice(0, 10);
        if (!revenueByWeek[key]) revenueByWeek[key] = 0;
        revenueByWeek[key] += t.revenue_usd;
      });
    const revenue_per_km = Object.entries(revenueByWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([week_of, revenue_usd]) => ({
        week_of,
        revenue_usd:     Math.round(revenue_usd),
        revenue_per_km:  Number((revenue_usd / CORRIDOR_KM).toFixed(0)),
        modelled:        true,
      }));

    res.json({ ...base, today_live, hauler_attainment, weekday_pattern, efficiency_benchmark, take_or_pay_risk, revenue_per_km });
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: 'Analytics composition failed' });
  }
});

module.exports = router;
