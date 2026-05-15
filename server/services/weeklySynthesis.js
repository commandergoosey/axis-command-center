'use strict';

/*
 * Weekly synthesis — Phase 68.
 *
 * The cockpit's daily rhythm — Today briefing in the morning,
 * Day-in-Review in the evening — assumes the operator's mental
 * scope is one shift. But operators also need to zoom out: how
 * did last week land vs forecast, what themes carried across the
 * seven days, which haulers ran hot vs which slipped, how many
 * action items closed vs slipped.
 *
 * This module composes a "week in review" payload from primitives
 * already in the database: forecast snapshots (Phase 43), the
 * unified audit log (Phase 41+), the action assignments overlay
 * (Phase 56), and a live aggregator pass for the current
 * tonnage / hauler ranking.
 *
 * Pure read-side composition. No writes. Lender-safe.
 */

const { aggregate } = require('./aggregator');
const roster = require('../state/roster');
const forecastSnapshots = require('../state/forecastSnapshots');
const { listAudit } = require('../db/audit');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────

function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

function weekRange(endingMs) {
  // 7-day window ending at the START of the day AFTER `endingMs` —
  // i.e. inclusive of the ending day. So passing "Mon" returns
  // Tue-of-prev-week through Mon, which is the natural "last 7
  // days including today" frame.
  const endIso = new Date(endingMs).toISOString();
  const startMs = endingMs - 7 * ONE_DAY_MS + ONE_DAY_MS; // 7 days inclusive
  return {
    start_iso:   new Date(startMs).toISOString(),
    end_iso:     endIso,
    start_day:   isoDay(startMs),
    end_day:     isoDay(endingMs),
  };
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

// ── Tonnage block ────────────────────────────────────────────────
//
// Built from forecast snapshots. We compare the snapshot at the
// start of the week (or the closest one we have) to the snapshot
// at the end. Delivered tonnes is "delivered_mtd at end" minus
// "delivered_mtd at start" *only if the start and end fall in the
// same calendar month*. Otherwise we report just the end-of-week
// MTD figure as the headline.
function tonnageBlock(period) {
  const points = forecastSnapshots.recent(14).filter((s) =>
    s.snapshot_date >= period.start_day && s.snapshot_date <= period.end_day,
  );
  if (points.length === 0) {
    return {
      points:           [],
      delivered_in_week: null,
      forecast_start:   null,
      forecast_end:     null,
      forecast_delta:   null,
      verdict_start:    null,
      verdict_end:      null,
    };
  }
  const first = points[0];
  const last  = points[points.length - 1];

  // Same month? Then delivered-in-week = delta of MTD.
  const sameMonth = first.snapshot_date.slice(0, 7) === last.snapshot_date.slice(0, 7);
  const deliveredInWeek = sameMonth
    ? Math.max(0, last.delivered_mtd - first.delivered_mtd)
    : null;

  return {
    points: points.map((p) => ({
      date:           p.snapshot_date,
      eom_tonnes:     p.eom_tonnes,
      pct_of_floor:   p.pct_of_floor,
      pct_of_monthly: p.pct_of_monthly,
      delivered_mtd:  p.delivered_mtd,
      verdict:        p.verdict,
      floor_target:   p.floor_target,
    })),
    delivered_in_week: deliveredInWeek,
    forecast_start:    first.eom_tonnes,
    forecast_end:      last.eom_tonnes,
    forecast_delta:    last.eom_tonnes - first.eom_tonnes,
    verdict_start:     first.verdict,
    verdict_end:       last.verdict,
    same_month:        sameMonth,
  };
}

// ── Action item flow block ────────────────────────────────────────
//
// Reads the audit log. Action item lifecycle events are written
// as `entity_type='action_item'` with action verbs like 'assign',
// 'snooze', 'unsnooze', 'unassign', 'reassign', 'escalate',
// 'auto_clear', 'comment', 'comment_delete', 'escalation_ack'. We
// bucket the week's events into open / close / escalate / comment.
//
// "Closed" is approximated as `auto_clear` (the system marking an
// item resolved) plus `unassign` (an admin closing out an
// assignment). "Opened" is `assign` events. This is structural,
// not perfect — but it's the same signal the operator sees in the
// audit log day to day.
function actionsBlock(period) {
  const { rows } = listAudit({
    entity_type: 'action_item',
    since:       period.start_iso,
    until:       period.end_iso,
    limit:       1000,
  });

  const counts = {
    opened:    0,
    closed:    0,
    escalated: 0,
    snoozed:   0,
    commented: 0,
  };

  // Track distinct action_item_ids per bucket so we don't double-
  // count when an admin reassigns or comments multiple times on
  // the same item.
  const seen = { opened: new Set(), closed: new Set(), escalated: new Set() };

  for (const r of rows) {
    switch (r.action) {
      case 'assign':
        if (!seen.opened.has(r.entity_id)) {
          counts.opened++;
          seen.opened.add(r.entity_id);
        }
        break;
      case 'auto_clear':
      case 'unassign':
        if (!seen.closed.has(r.entity_id)) {
          counts.closed++;
          seen.closed.add(r.entity_id);
        }
        break;
      case 'escalate':
        if (!seen.escalated.has(r.entity_id)) {
          counts.escalated++;
          seen.escalated.add(r.entity_id);
        }
        break;
      case 'snooze':    counts.snoozed++;   break;
      case 'comment':   counts.commented++; break;
      default: /* ignore */
    }
  }

  return {
    ...counts,
    net:          counts.opened - counts.closed,
    total_events: rows.length,
  };
}

// ── Theme / dominant story block ──────────────────────────────────
//
// Counts entity_types touched in the audit log over the week. The
// top three become the week's "themes" — what the operator spent
// their time on. Excludes auth/session noise.
const THEME_LABEL = {
  alert:           'Alerts triaged',
  filing:          'Filings progressed',
  action_item:     'Action items',
  receivable:      'Receivables',
  receivable_followup: 'Receivable chases',
  workorder:       'Workorders',
  incident:        'Incidents',
  licence:         'Licence renewals',
  handover_note:   'Shift handovers',
  forecast_scenario: 'Forecast scenarios',
  hauler_compare:  'Hauler comparisons',
};

function themesBlock(period) {
  const { rows } = listAudit({
    since: period.start_iso,
    until: period.end_iso,
    limit: 2000,
  });
  const buckets = {};
  for (const r of rows) {
    if (!r.entity_type) continue;
    if (r.entity_type === 'session') continue; // login noise
    buckets[r.entity_type] = (buckets[r.entity_type] || 0) + 1;
  }
  const sorted = Object.entries(buckets)
    .map(([entity_type, count]) => ({
      entity_type,
      label: THEME_LABEL[entity_type] || entity_type.replace(/_/g, ' '),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return sorted;
}

// ── Hauler block — winners and strugglers ─────────────────────────
//
// Live aggregator pass + ranked by attainment_pct (delivered MTD /
// contracted MTD). Top 3 winners, bottom 3 strugglers among
// active haulers.
function haulerBlock() {
  const agg = aggregate(roster.list());
  const ranked = agg.haulers
    .filter((h) => h.status === 'active' && h.tonnes_contracted_mtd > 0)
    .map((h) => ({
      hauler_id:        h.id,
      display_name:     h.display_name,
      attainment_pct:   pct(h.tonnes_delivered_mtd, h.tonnes_contracted_mtd),
      delivered_mtd:    h.tonnes_delivered_mtd,
      contracted_mtd:   h.tonnes_contracted_mtd,
      active_trucks:    h.fleet?.active_trucks ?? null,
      contracted_trucks:h.fleet?.contracted_trucks ?? null,
    }))
    .sort((a, b) => b.attainment_pct - a.attainment_pct);

  // Threshold-driven so a hauler can't appear in both buckets when
  // the fleet is small. 80% is the take-or-pay floor — the natural
  // line between winner and struggler.
  const FLOOR_PCT = 80;
  const winners    = ranked.filter((h) => h.attainment_pct >= FLOOR_PCT).slice(0, 3);
  const strugglers = ranked.filter((h) => h.attainment_pct <  FLOOR_PCT).slice(-3).reverse();
  return { winners, strugglers };
}

// ── Compose ───────────────────────────────────────────────────────

function compose(now = Date.now()) {
  const period = weekRange(now);
  return {
    generated_at:      new Date(now).toISOString(),
    period:            { start: period.start_iso, end: period.end_iso, days: 7 },
    tonnage:           tonnageBlock(period),
    actions:           actionsBlock(period),
    themes:            themesBlock(period),
    haulers:           haulerBlock(),
  };
}

module.exports = { compose };
