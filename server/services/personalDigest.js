'use strict';

/*
 * Personal activity digest — Phase 91.
 *
 * Composes a per-user "what did I do" view from the existing
 * audit log. Pure read-side: filters audit on actor_user_id +
 * a since horizon, then groups + summarises by entity_type and
 * action. Returns counts per category + a flat recent-events
 * timeline for the page.
 *
 * Distinct from Phase 51 (Day-in-Review — corridor close-out for
 * the operator's shift) and Phase 68 (Week-in-Review — corridor
 * synthesis for the week). My activity is the *first-person*
 * view of personal contribution.
 */

const { listAudit } = require('../db/audit');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Group entity_types into operator-meaningful categories. The
// audit log uses many fine-grained types; the page surfaces the
// rolled-up categories the user actually thinks in.
const CATEGORY_BY_TYPE = {
  action_item:        'action_items',
  handover_note:      'handovers',
  risk:               'risks',
  risk_step:          'risks',
  risk_comment:       'risks',
  hauler_contact:     'contacts',
  forecast_scenario:  'planning',
  playbook:           'playbooks',
  playbook_run:       'playbooks',
  playbook_item:      'playbooks',
  maintenance_schedule: 'maintenance',
  settlement:         'settlements',
  claim:              'claims',
  broadcast:          'broadcasts',
  lender_pack:        'lender_outputs',
  forecast:           'forecasts',
  forecast_snapshot:  'forecasts',
  integration_sync:   'integrations',
};

// Within action_items specifically, action verbs map to
// outcome-meaningful labels (closed vs reassigned vs commented).
const ACTION_LABEL = {
  assign:           'opened',
  unassign:         'closed',
  auto_clear:       'closed',
  snooze:           'snoozed',
  unsnooze:         'unsnoozed',
  reassign:         'reassigned',
  comment:          'commented',
  comment_delete:   'comment_deleted',
  escalate:         'escalated',
  escalation_ack:   'escalation_acknowledged',
};

function compose({ actor_user_id, days = 7, now = Date.now() } = {}) {
  if (!actor_user_id) {
    return { generated_at: new Date(now).toISOString(), days, counts: {}, by_category: {}, recent: [], total: 0 };
  }
  const since = new Date(now - days * ONE_DAY_MS).toISOString();
  const { rows, total } = listAudit({
    actor_user_id,
    since,
    limit: 500,        // cap; for active operators this is plenty
  });

  // Counts by entity_type → category roll-up + by action.
  const byCategory = {};
  const byAction = {};
  let actionItemFlow = { opened: 0, closed: 0, snoozed: 0, commented: 0, escalated: 0, reassigned: 0 };
  for (const r of rows) {
    const cat = CATEGORY_BY_TYPE[r.entity_type] || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const key = `${r.entity_type}:${r.action}`;
    byAction[key] = (byAction[key] || 0) + 1;

    // Special-case action item flow (the most-used surface so it
    // gets its own KPI grid).
    if (r.entity_type === 'action_item') {
      const label = ACTION_LABEL[r.action];
      if (label && actionItemFlow[label] !== undefined) {
        actionItemFlow[label]++;
      }
    }
  }

  // Most recent 25 events for the timeline.
  const recent = rows.slice(0, 25);

  // Daily activity buckets (last `days` days) for a sparkline.
  // Each bucket is an ISO date.
  const dailyBuckets = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(now - i * ONE_DAY_MS).toISOString().slice(0, 10);
    dailyBuckets[day] = 0;
  }
  for (const r of rows) {
    const day = r.ts.slice(0, 10);
    if (dailyBuckets[day] !== undefined) dailyBuckets[day]++;
  }
  // Convert to array, oldest → newest.
  const dailySeries = Object.entries(dailyBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, n]) => ({ date, n }));

  return {
    generated_at: new Date(now).toISOString(),
    days,
    horizon: { since, until: new Date(now).toISOString() },
    counts: {
      total: rows.length,
      by_category: byCategory,
      action_item_flow: actionItemFlow,
    },
    daily_series: dailySeries,
    by_action: byAction,
    recent,
  };
}

module.exports = { compose };
