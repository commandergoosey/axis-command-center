'use strict';

/*
 * Corridor performance analytics service — Phase 96.
 *
 * Builds a 12-week trailing view of corridor throughput: weekly tonnes,
 * on-time delivery rate, per-hauler contribution, and YTD progress versus
 * the GIBDLC contract minimum.
 *
 * Contract constants (Tranche 1, from aggregator.js):
 *   - Annual target:  1,000,000 tonnes
 *   - Annual floor:     800,000 tonnes (80% of target — take-or-pay minimum)
 *   - Weekly target:    19,231 tonnes  (= 1,000,000 / 52)
 *   - Weekly floor:     15,385 tonnes  (= 800,000  / 52)
 *
 * YTD is derived from the contract mock monthly series (Jan-Apr 2026)
 * plus a synthetic May partial from the most recent weekly bucket.
 *
 * Data is deterministic (seeded PRNG) so the page is stable across calls.
 */

const roster = require('../state/roster');

/* ── Contract constants ────────────────────────────────────────────── */
const ANNUAL_TARGET  = 1_000_000;   // tonnes
const ANNUAL_FLOOR   = 800_000;     // tonnes (80% take-or-pay floor)
const WEEKLY_TARGET  = Math.round(ANNUAL_TARGET / 52);  // 19,231
const WEEKLY_FLOOR   = Math.round(ANNUAL_FLOOR  / 52);  // 15,385

/* ── Jan-Apr 2026 monthly actuals (from contract mock) ─────────────── */
const MONTHLY_YTD_BEFORE_WINDOW = [
  { month: '2026-01', delivered: 68_200 },
  { month: '2026-02', delivered: 75_400 },
  { month: '2026-03', delivered: 79_100 },
  { month: '2026-04', delivered: 81_500 },
];

/* ── Hauler effective shares ──────────────────────────────────────── */
// Derived from contracted_trucks × run_rate; normalised to sum = 1.
const HAULER_META = [
  { id: 'haul-01', share: 0.303, on_time_base: 94.0 },
  { id: 'haul-02', share: 0.235, on_time_base: 88.0 },
  { id: 'haul-03', share: 0.241, on_time_base: 91.0 },
  { id: 'haul-04', share: 0.127, on_time_base: 86.0 },
  { id: 'haul-05', share: 0.095, on_time_base: 79.0 },
];

/* ── Seeded PRNG ──────────────────────────────────────────────────── */
function s(i) {
  const x = Math.sin(i * 14_159 + 2) * 100_000;
  return x - Math.floor(x);   // 0..1
}

/* ── Week builder ──────────────────────────────────────────────────── */
function getLastCompleteWeekMonday() {
  // Compute today in Africa/Accra (UTC = Accra, no DST offset)
  const nowAccra = new Date();
  const yyyy = Number(new Date(nowAccra).toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' }).slice(0, 4));
  const mm   = Number(new Date(nowAccra).toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' }).slice(5, 7));
  const dd   = Number(new Date(nowAccra).toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' }).slice(8, 10));
  const today = new Date(Date.UTC(yyyy, mm - 1, dd));
  const dow   = today.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  // Most recent Monday that has already ended (complete week)
  // If today=Wed(3): last Mon = today - 2 days, but that's the CURRENT week → go back 7 more
  const daysToLastCompleteMonday = dow === 0
    ? 6       // Sunday → the Monday 6 days ago started the most-recent complete week
    : dow + 6; // Wed(3) → 3+6=9 days back → Mon of previous week
  const lastCompleteMonday = new Date(today);
  lastCompleteMonday.setUTCDate(today.getUTCDate() - daysToLastCompleteMonday);
  return lastCompleteMonday;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/* ── Weekly data synthesiser ──────────────────────────────────────── */
function buildWeeks() {
  const haulers  = roster.list();
  const haulerMap = Object.fromEntries(haulers.map((h) => [h.id, h]));
  const lastMon  = getLastCompleteWeekMonday();
  const WEEKS    = 12;

  const weeks = [];

  for (let w = WEEKS - 1; w >= 0; w -= 1) {
    // w=11 → oldest week, w=0 → most recent
    const weekIdx = WEEKS - 1 - w;  // 0=oldest, 11=newest

    // Week Monday (go back w full weeks from lastMon)
    const weekMon = addDays(lastMon, -(w * 7));
    const weekSun = addDays(weekMon, 6);

    // Base tonnes: ramp from ~17,200 (week 0) to ~19,000 (week 11)
    // with a dip at week 7 (Apr 6–12 port berth queue)
    const t = weekIdx / (WEEKS - 1);
    let baseTonnes = Math.round(17_200 + t * 1_800);

    // Port congestion dip: weekIdx 7 (Apr 6–12, 2026) → ±10% downward
    // Detect by checking the week's Monday date
    const monStr = isoDate(weekMon);
    const isPortDip = monStr >= '2026-04-06' && monStr <= '2026-04-12';
    if (isPortDip) baseTonnes = Math.round(baseTonnes * 0.88);

    const noise  = Math.round((s(weekIdx + 1) - 0.5) * 700);
    const tonnes = Math.max(WEEKLY_FLOOR, baseTonnes + noise);

    // Trips — southbound (laden): ~40 t/trip; northbound return is equal count
    const ladenTrips    = Math.round(tonnes / 40);
    const onTimePct     = Math.min(97, Math.max(75,
      88 + (s(weekIdx + 20) - 0.5) * 10 + (isPortDip ? -6 : 0)
    ));
    const delayedTrips  = Math.round(ladenTrips * (1 - onTimePct / 100));
    const avgCycleH     = Number((13.5 + (s(weekIdx + 40) - 0.5) * 2).toFixed(1));

    // Per-hauler breakdown
    const haulerBreakdown = HAULER_META.map((hm, j) => {
      const h      = haulerMap[hm.id];
      const noise2 = (s(weekIdx * 5 + j + 60) - 0.5) * 0.08; // ±4%
      const share  = Math.max(0, hm.share + noise2);
      const hTonnes = Math.round(tonnes * (share / 1.0));
      const hTrips  = Math.round(hTonnes / 40);
      const hOtp    = Math.min(98, Math.max(70,
        hm.on_time_base + (s(weekIdx * 5 + j + 80) - 0.5) * 8
      ));
      return {
        hauler_id:     hm.id,
        display_name:  h?.display_name ?? hm.id,
        tonnes:        hTonnes,
        trips:         hTrips,
        on_time_pct:   Math.round(hOtp * 10) / 10,
      };
    });

    // Normalise hauler tonnes so they sum to corridor total
    const haulerSum = haulerBreakdown.reduce((a, b) => a + b.tonnes, 0);
    if (haulerSum > 0) {
      haulerBreakdown.forEach((hb) => {
        hb.tonnes = Math.round(hb.tonnes * (tonnes / haulerSum));
      });
    }

    weeks.push({
      week_of:         isoDate(weekMon),
      week_ending:     isoDate(weekSun),
      tonnes,
      laden_trips:     ladenTrips,
      delayed_trips:   delayedTrips,
      on_time_pct:     Math.round(onTimePct * 10) / 10,
      avg_cycle_h:     avgCycleH,
      hauler_breakdown: haulerBreakdown,
    });
  }

  return weeks;  // oldest → newest
}

/* ── YTD summary ──────────────────────────────────────────────────── */
function buildYtd(weeks) {
  // Full months before the analytics window (Jan-Apr 2026)
  const totalBeforeWindow = MONTHLY_YTD_BEFORE_WINDOW.reduce(
    (s, m) => s + m.delivered, 0
  );

  // Weeks in the analytics window that fall in May (partial month-to-date)
  const mayWeeks = weeks.filter((w) => w.week_of.startsWith('2026-05'));
  const mayFromWindow = mayWeeks.reduce((s, w) => s + w.tonnes, 0);

  // Add partial current week (today is mid-week — estimate 3/7 of weekly run rate)
  const lastWeek = weeks[weeks.length - 1];
  const partialCurrentWeekEst = Math.round(lastWeek ? (lastWeek.tonnes * 3 / 7) : 0);

  const tonnesYtd = totalBeforeWindow + mayFromWindow + partialCurrentWeekEst;

  // Days elapsed in 2026 as of today
  const now = new Date();
  const jan1 = new Date(Date.UTC(2026, 0, 1));
  const daysElapsed = Math.floor((now - jan1) / 86_400_000) + 1;
  const yearFraction = daysElapsed / 365;

  const targetYtd = Math.round(ANNUAL_TARGET * yearFraction);
  const floorYtd  = Math.round(ANNUAL_FLOOR  * yearFraction);

  const surplusVsFloor = tonnesYtd - floorYtd;

  // Last-4-week run rate
  const recentWeeks   = weeks.slice(-4);
  const recentTonnes  = recentWeeks.reduce((s, w) => s + w.tonnes, 0);
  const weeklyRunRate = Math.round(recentTonnes / recentWeeks.length);

  // Project full year at current run rate (weeks already elapsed + remaining at run rate)
  const weeksElapsed   = Math.round(daysElapsed / 7);
  const weeksRemaining = 52 - weeksElapsed;
  const projectedYearEnd = tonnesYtd + weeklyRunRate * weeksRemaining;

  return {
    tonnes_actual:         tonnesYtd,
    tonnes_target:         targetYtd,
    tonnes_floor:          floorYtd,
    pct_of_target:         Math.round((tonnesYtd / targetYtd) * 1000) / 10,
    pct_of_floor:          Math.round((tonnesYtd / floorYtd)  * 1000) / 10,
    surplus_vs_floor:      surplusVsFloor,
    above_floor:           surplusVsFloor >= 0,
    weekly_run_rate:       weeklyRunRate,
    projected_year_end:    Math.round(projectedYearEnd),
    projected_vs_target:   Math.round((projectedYearEnd / ANNUAL_TARGET) * 1000) / 10,
    days_elapsed:          daysElapsed,
  };
}

/* ── Hauler period totals ─────────────────────────────────────────── */
function buildHaulerTotals(weeks) {
  const totalsMap = {};
  for (const w of weeks) {
    for (const hb of w.hauler_breakdown) {
      if (!totalsMap[hb.hauler_id]) {
        totalsMap[hb.hauler_id] = {
          hauler_id:    hb.hauler_id,
          display_name: hb.display_name,
          tonnes:       0,
          trips:        0,
          on_time_sum:  0,
          weeks:        0,
        };
      }
      totalsMap[hb.hauler_id].tonnes      += hb.tonnes;
      totalsMap[hb.hauler_id].trips       += hb.trips;
      totalsMap[hb.hauler_id].on_time_sum += hb.on_time_pct;
      totalsMap[hb.hauler_id].weeks       += 1;
    }
  }

  const corridorTotalTonnes = Object.values(totalsMap)
    .reduce((s, h) => s + h.tonnes, 0);

  return Object.values(totalsMap)
    .sort((a, b) => b.tonnes - a.tonnes)
    .map((h) => ({
      hauler_id:    h.hauler_id,
      display_name: h.display_name,
      tonnes:       h.tonnes,
      trips:        h.trips,
      on_time_pct:  Math.round((h.on_time_sum / h.weeks) * 10) / 10,
      share_pct:    Math.round((h.tonnes / corridorTotalTonnes) * 1000) / 10,
    }));
}

/* ── Main compose ─────────────────────────────────────────────────── */
function compose() {
  const weeks       = buildWeeks();
  const ytd         = buildYtd(weeks);
  const haulerTotals = buildHaulerTotals(weeks);

  return {
    generated_at:    new Date().toISOString(),
    period:          `${weeks[0].week_of} to ${weeks[weeks.length - 1].week_ending}`,
    weeks_shown:     weeks.length,
    contract: {
      annual_target_t: ANNUAL_TARGET,
      annual_floor_t:  ANNUAL_FLOOR,
      weekly_target_t: WEEKLY_TARGET,
      weekly_floor_t:  WEEKLY_FLOOR,
    },
    weeks,
    ytd,
    hauler_totals: haulerTotals,
  };
}

module.exports = { compose };
