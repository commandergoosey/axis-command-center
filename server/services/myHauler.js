'use strict';

/*
 * Hauler-side dashboard ("My hauler") — Phase 79.
 *
 * Pure read-side composition that gives the hauler_admin
 * persona — and any AXIS role passing `?hauler_id=` — a
 * dedicated landing surface for one hauler's corridor presence.
 *
 * Composition mirrors `lenderPack` (Phase 70) and
 * `weeklySynthesis` (Phase 68): aggregate from primitives that
 * already exist; no new state. The hauler admin sees AXIS's view
 * of *their* hauler — what's been logged about them, what action
 * items reference them, what fleet flags are active, what licence
 * expiries are coming.
 *
 * Sections:
 *   - corridor: the hauler's contract slot + integration status
 *   - mtd: month-to-date performance vs contracted
 *   - performance: SLA + on-time + safety
 *   - action_items: open AXIS-side action items mentioning the hauler
 *   - contacts: recent corridor contact log (read-only)
 *   - fleet_health: open workorders + licence expiries + at-risk drivers
 *   - recent_audit: recent corridor audit rows referencing the hauler
 */

const roster           = require('../state/roster');
const haulerContacts   = require('../state/haulerContacts');
const workorderState   = require('../state/workorderState');
const licenceState     = require('../state/licenceState');
const actionAssignments= require('../state/actionAssignments');
const { aggregate, CONTRACT } = require('./aggregator');
const { buildForecast } = require('./forecast');
const { allAlerts } = require('./alertSynth');
const alertState   = require('../state/alertState');
const { listAudit } = require('../db/audit');

const { FLEET } = require('../mock/fleet');
const { LICENCE_EXPIRY } = require('../mock/compliance');
const { DRIVERS } = require('../mock/drivers');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

function mergedAlertStatus(a) {
  const st = alertState.getState(a.id);
  let status = st.status_override ?? a.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) status = a.status;
  }
  return { ...a, status };
}

function payloadMentionsHauler(payload, haulerId) {
  if (!payload || !haulerId) return false;
  if (payload.hauler_id === haulerId) return true;
  try { return JSON.stringify(payload).includes(`"${haulerId}"`); }
  catch { return false; }
}

// ── Compose ───────────────────────────────────────────────────────

function compose(haulerId, now = new Date()) {
  const hauler = roster.find(haulerId);
  if (!hauler) return null;

  const haulers = roster.list();
  const agg     = aggregate(haulers, now);
  const forecast = buildForecast(haulers, now);
  const aggHauler = agg.haulers.find((h) => h.id === haulerId) || hauler;
  const fcHauler  = forecast.haulers.find((h) => h.hauler_id === haulerId) || null;

  // ── 1. Corridor block — slot + integration ──────────────────────
  const corridor = {
    hauler_id:         hauler.id,
    display_name:      hauler.display_name,
    onboarded_date:    hauler.onboarded_date,
    contracted_trucks: hauler.fleet?.contracted_trucks ?? null,
    active_trucks:     hauler.fleet?.active_trucks ?? null,
    idle_trucks:       Math.max(0, (hauler.fleet?.contracted_trucks ?? 0) - (hauler.fleet?.active_trucks ?? 0)),
    status:            hauler.status,
    integration: {
      type:           hauler.integration?.type,
      adapter:        hauler.integration?.adapter,
      api_status:     hauler.api_status,
      last_sync:      hauler.integration?.last_sync,
      error_count_24h: hauler.integration?.error_count_24h,
    },
    contract_share:    hauler.contract_share,
    take_or_pay_floor_pct: Math.round(CONTRACT.take_or_pay_floor_pct * 100),
  };

  // ── 2. MTD block — tonnes delivered vs contracted, attainment ───
  const mtd = {
    delivered_mtd:     aggHauler.tonnes_delivered_mtd ?? 0,
    contracted_mtd:    aggHauler.tonnes_contracted_mtd ?? 0,
    attainment_pct:    pct(aggHauler.tonnes_delivered_mtd, aggHauler.tonnes_contracted_mtd),
    forecast_eom:      fcHauler?.projected_eom ?? null,
    forecast_verdict:  fcHauler?.verdict ?? null,
    pct_of_contracted: fcHauler ? pct(fcHauler.projected_eom, fcHauler.contracted_monthly) : null,
  };

  // ── 3. Performance ─────────────────────────────────────────────
  const performance = hauler.status === 'active' ? {
    on_time_pct:        hauler.performance?.on_time_pct,
    sla_attainment_pct: hauler.performance?.sla_attainment_pct,
    safety_score:       hauler.performance?.safety_score,
  } : null;

  // ── 4. Action items mentioning this hauler ─────────────────────
  // Read assignments from durable state; cross-reference against
  // the synth's IDs implicitly via payload mentions in audit.
  // For UI purposes: open assignments where action_item_id contains
  // the hauler ID slug, OR where the assignment notes mention it.
  const allMine = actionAssignments.all();
  const actionItems = allMine
    .filter((a) => {
      const blob = `${a.action_item_id} ${a.notes || ''}`.toLowerCase();
      return blob.includes(haulerId);
    })
    .filter((a) => !a.snooze?.until || new Date(a.snooze.until).getTime() < now.getTime())
    .slice(0, 8);

  // ── 5. Recent contacts — what AXIS has logged about this hauler.
  const contacts = haulerContacts.forHauler(haulerId, 5);

  // ── 6. Fleet health — open workorders + licence expiries + at-risk drivers
  const haulerRigs = FLEET.filter((r) => r.hauler_id === haulerId);
  const haulerRigIds = new Set(haulerRigs.map((r) => r.id));
  const openWorkorders = workorderState.allOpen().filter((wo) => haulerRigIds.has(wo.rig_id));
  // Licence expiries within 60 days for drivers belonging to this hauler.
  const upcomingLicences = LICENCE_EXPIRY
    .filter((l) => l.hauler_id === haulerId)
    .map((l) => ({
      ...l,
      live: licenceState.getState(l.id),
    }))
    .filter((l) => !l.live?.renewed)
    .sort((a, b) => a.days_remaining - b.days_remaining)
    .slice(0, 5);
  // At-risk drivers — flagged ones from the deterministic mock.
  const atRiskDrivers = DRIVERS
    .filter((d) => d.hauler_id === haulerId && d.flag)
    .slice(0, 5);

  const fleetHealth = {
    open_workorder_count: openWorkorders.length,
    open_workorders:      openWorkorders.slice(0, 5),
    licence_expiries_60d: upcomingLicences,
    at_risk_drivers:      atRiskDrivers,
    rigs_total:           haulerRigs.length,
    rigs_in_garage:       haulerRigs.filter((r) => r.status === 'garage').length,
    rigs_with_critical:   haulerRigs.filter((r) => r.maintenance_flag === 'critical').length,
  };

  // ── 7. Open alerts referencing the hauler ──────────────────────
  const openAlerts = allAlerts()
    .map(mergedAlertStatus)
    .filter((a) => a.hauler_id === haulerId)
    .filter((a) => ['OPEN', 'IN_TRIAGE', 'NEEDS_ACTION'].includes(a.status))
    .slice(0, 8);

  // ── 8. Recent audit log mentioning this hauler ─────────────────
  const since = new Date(now.getTime() - 30 * ONE_DAY_MS).toISOString();
  const { rows: auditRows } = listAudit({ since, limit: 200 });
  const recentAudit = auditRows
    .filter((r) => (
      r.entity_id === haulerId ||
      payloadMentionsHauler(r.payload, haulerId) ||
      (r.summary && r.summary.toLowerCase().includes(haulerId))
    ))
    .slice(0, 10);

  return {
    generated_at: now.toISOString(),
    corridor,
    mtd,
    performance,
    action_items: actionItems,
    contacts,
    fleet_health: fleetHealth,
    open_alerts:  openAlerts,
    recent_audit: recentAudit,
  };
}

module.exports = { compose };
