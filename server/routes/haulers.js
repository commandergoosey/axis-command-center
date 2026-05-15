'use strict';

/*
 * GET  /api/haulers       — list with corridor-rolled metrics
 * GET  /api/haulers/:id   — single hauler detail
 * POST /api/haulers       — onboard a new hauler (status: pending)
 *
 * Shape matches the Hauler model in BRIEF.md §5.1.
 * Detail endpoint returns the same summary today; fleet list, trip history,
 * SLA breakdown and API credentials panel land in Phases 3–10.
 */

const express = require('express');
const router = express.Router();

const roster = require('../state/roster');
const rosterStore = require('../state/rosterStore');
const onboardingChecklist = require('../state/onboardingChecklist');
const integrationStore = require('../state/integrationStore');
const integrationSyncLog = require('../state/integrationSyncLog');
const registry = require('../adapters/registry');
const manualAdapter = require('../adapters/manual');
const { aggregate } = require('../services/aggregator');
const { buildForecast } = require('../services/forecast');
const { requireRole } = require('../middleware/auth');
const { writeAudit, listAudit } = require('../db/audit');

const incidentState = require('../state/incidentState');
const coachingState = require('../state/coachingState');
const licenceState  = require('../state/licenceState');
const haulerContacts = require('../state/haulerContacts');
const convoyState   = require('../state/convoyState');

const { FLEET }    = require('../mock/fleet');
const { DRIVERS }  = require('../mock/drivers');
const { TRIPS }    = require('../mock/trips');
const { ALERTS }   = require('../mock/alerts');
const { LICENCE_EXPIRY } = require('../mock/compliance');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Operational write access. Hauler admins can edit their own hauler's
// integration; AXIS admin/ops can edit any hauler. Lenders are read-only.
const OPS_ROLES    = ['axis_admin', 'axis_ops'];
const WRITE_ROLES  = ['axis_admin', 'axis_ops', 'hauler_admin'];

function assertHaulerScope(req, res) {
  if (req.user?.role === 'hauler_admin' && req.params.id !== req.user.hauler_id) {
    res.status(403).json({ error: 'Hauler admins can only manage their own hauler' });
    return false;
  }
  return true;
}

function withIntegration(h) {
  return { ...h, integration_state: integrationStore.summary(h.id) };
}

router.get('/', (_req, res) => {
  const agg = aggregate(roster.list());

  // Phase 125 — blend live today stats per hauler (advisory, never blocks response).
  let liveStats = {};
  try { liveStats = convoyState.liveHaulerStats(); } catch (_) { /* non-fatal */ }

  res.json({
    haulers: agg.haulers.map((h) => ({
      ...withIntegration(h),
      live_today: liveStats[h.id] ?? null,
    })),
    totals: {
      contracted_trucks: agg.fleet.contracted_trucks,
      active_trucks:     agg.fleet.active_trucks,
      live_haulers:      agg.haulers.filter((h) => integrationStore.summary(h.id).live).length,
    },
  });
});

// ── Phase 65 — Multi-hauler comparison (declared BEFORE /:id) ─────
//
// `/compare` would otherwise match the `/:id` regex below and 404
// because Express matches routes in registration order. Putting
// compare first ensures it's resolved as a literal path.
router.get('/compare', compareHandler);

// ── Hauler detail ─────────────────────────────────────────────────
//   GET /api/haulers/:id — enriches the list summary with fleet-status
//   breakdown, driver-roster roll-up, month-to-date economics from the
//   trip ledger, 12-week SLA trend, settlement / invoicing posture
//   (synthesised deterministically per hauler so the lender view is
//   stable), and any open alerts referencing this hauler.
router.get('/:id', (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });

  // Hauler admins are scoped to their own hauler. The list endpoint
  // already filters them client-side, but this is the authoritative
  // door — stop them reading another hauler's settlement/audit trail.
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id !== h.id) {
    return res.status(403).json({ error: 'Hauler admins can only view their own hauler' });
  }

  const agg = aggregate(roster.list());
  const summary = agg.haulers.find((x) => x.id === req.params.id);

  const fleet_breakdown = buildFleetBreakdown(h.id);
  const driver_roster   = buildDriverRoster(h.id);
  const mtd             = buildMtd(h.id);
  const sla_series      = buildSlaSeries(h);
  const settlement      = buildSettlement(h, mtd);
  const open_alerts     = buildOpenAlerts(h.id);
  const lifecycle       = buildLifecycle(h.id);
  // Phase 44 — surface this hauler's slice of the corridor month-end
  // projection alongside the existing summary. Derived from the same
  // forecast service the Today card uses, so the per-hauler drawer
  // never disagrees with the corridor scoreboard.
  const corridorForecast = buildForecast(roster.list(), new Date());
  const forecast = corridorForecast.haulers.find((p) => p.hauler_id === h.id) ?? null;

  // Lender persona gets the governance metrics (HSE / licences /
  // coaching counters belong in their underwriting view) but NOT the
  // raw audit-log tail — same compliance line we draw for the Today
  // operations log and digest.
  if (req.user?.role === 'lender') {
    lifecycle.audit = { total_30d: 0, recent: [], restricted: true };
  }

  // Phase 109 — include onboarding checklist for pending haulers so
  // the detail drawer can render the onboarding progress panel.
  const checklist = h.status === 'pending'
    ? onboardingChecklist.getChecklist(h.id)
    : null;

  // Carry the extra fields captured at onboarding for pending haulers.
  const onboarding_meta = h._persisted ? {
    contact_name:       h.contact_name       ?? null,
    contact_email:      h.contact_email      ?? null,
    contract_share_pct: h.contract_share_pct ?? null,
    planned_start_date: h.planned_start_date ?? null,
    activated_at:       h.activated_at       ?? null,
  } : null;

  res.json({
    ...withIntegration(summary),
    fleet_breakdown,
    driver_roster,
    mtd,
    sla_series,
    settlement,
    open_alerts,
    lifecycle,
    forecast,
    forecast_horizon: {
      days_in_month:  corridorForecast.horizon.days_in_month,
      days_elapsed:   corridorForecast.horizon.days_elapsed,
      days_remaining: corridorForecast.horizon.days_remaining,
    },
    checklist,
    onboarding_meta,
  });
});

// ── Phase 65 — Multi-hauler comparison ────────────────────────────
//
// Returns a thin slice of each requested hauler's metrics, packed
// into one call so the comparison UI doesn't have to fan out N
// fetches. Same role gating as the detail endpoint:
//   - axis_admin / axis_ops — any subset
//   - hauler_admin          — must include only their own (or 403)
//   - lender                — full access; audit blanked at row
//                              level since this is portfolio analysis
//
// Limited to 4 haulers per call to keep the response shape sane and
// the comparison UI legible. Handler is a named function so it can
// be wired before /:id in the registration sequence (Express matches
// routes in declaration order — /compare would 404 as a missing id
// otherwise).
function compareHandler(req, res) {
  const ids = (req.query.ids || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) return res.status(400).json({ error: 'pick at least 2 hauler IDs' });
  if (ids.length > 4) return res.status(400).json({ error: 'max 4 haulers per comparison' });

  // Hauler admin guard — they can only compare within their own
  // hauler (which is degenerate, but explicit). Reject if any non-own
  // ID slipped in.
  if (req.user?.role === 'hauler_admin') {
    if (!ids.every((id) => id === req.user.hauler_id)) {
      return res.status(403).json({ error: 'Hauler admins can only view their own hauler' });
    }
  }

  const corridorForecast = buildForecast(roster.list(), new Date());
  const agg = aggregate(roster.list());

  const ONE_DAY_MS_LOCAL = ONE_DAY_MS;
  const cutoffIso = new Date(Date.now() - 30 * ONE_DAY_MS_LOCAL).toISOString();

  const haulers = ids.map((id) => {
    const h = roster.find(id);
    if (!h) return { id, missing: true };
    const summary = agg.haulers.find((x) => x.id === id);
    const forecast = corridorForecast.haulers.find((p) => p.hauler_id === id) ?? null;

    // Lifecycle counts in the last 30 d (mirrors Phase 41 dossier).
    const hseAll = incidentState.all().filter((i) => i.hauler_id === id);
    const hseOpen     = hseAll.filter((i) => i.status === 'OPEN').length;
    const hseClosed30 = hseAll.filter((i) =>
      i.status === 'CLOSED' && (i.closed_at || '') >= cutoffIso
    ).length;
    const coachingWindow = coachingState.recentWindow(30, Date.now())
      .filter((c) => c.hauler_id === id).length;
    const licencesAll = LICENCE_EXPIRY.filter((l) => l.hauler_id === id);
    const licencesExpiring = licencesAll
      .map((l) => ({ ...l, overlay: licenceState.getState(l.id) }))
      .filter((l) => {
        const expiry = l.overlay?.expiry_iso ?? l.expiry;
        const days = Math.round((new Date(expiry).getTime() - Date.now()) / ONE_DAY_MS_LOCAL);
        return days <= 30;
      }).length;
    const licencesRenewed30 = licencesAll
      .filter((l) => {
        const overlay = licenceState.getState(l.id);
        return overlay?.renewed_at && overlay.renewed_at >= cutoffIso;
      }).length;

    // Per-hauler audit count in window. Lender doesn't need this.
    let auditCount30 = null;
    if (req.user?.role !== 'lender') {
      const { rows } = listAudit({ since: cutoffIso, limit: 500 });
      auditCount30 = rows.filter((r) => (
        r.entity_id === id || (r.payload && JSON.stringify(r.payload).includes(`"${id}"`))
      )).length;
    }

    // Open alerts count from Phase 19 helper.
    const openAlerts = ALERTS.filter((a) => a.hauler_id === id && a.status !== 'RESOLVED').length;

    return {
      id,
      display_name:        h.display_name,
      onboarded_date:      h.onboarded_date,
      api_status:          summary?.api_status ?? h.integration?.type,
      contracted_trucks:   h.fleet.contracted_trucks,
      active_trucks:       h.fleet.active_trucks,
      tonnes_delivered_mtd:  summary?.tonnes_delivered_mtd ?? 0,
      tonnes_contracted_mtd: summary?.tonnes_contracted_mtd ?? 0,
      on_time_pct:          summary?.performance?.on_time_pct ?? null,
      sla_attainment_pct:   summary?.performance?.sla_attainment_pct ?? null,
      forecast,
      lifecycle: {
        hse_open:               hseOpen,
        hse_closed_30d:         hseClosed30,
        coaching_30d:           coachingWindow,
        licences_expiring_30d:  licencesExpiring,
        licences_renewed_30d:   licencesRenewed30,
      },
      audit_count_30d: auditCount30,
      open_alerts:     openAlerts,
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    horizon: {
      days_in_month:  corridorForecast.horizon.days_in_month,
      days_elapsed:   corridorForecast.horizon.days_elapsed,
      days_remaining: corridorForecast.horizon.days_remaining,
    },
    haulers,
  });
}

// ── Phase 49 — Per-hauler weekly scorecard ────────────────────────
//
// Mirrors the Today digest pattern (Phase 40) but at hauler granularity
// and on a weekly cadence. Each hauler-admin gets a tangible artifact
// they can take to their internal Monday meeting; axis_admin can share
// it as accountability with their hauler partners.
//
// `?week_offset=N` lets the operator print last week's card (N = -1)
// or the week before (N = -2). Default is the current rolling 7-day
// window ending now.
//
// Scope:
//   - axis_admin / axis_ops — any hauler
//   - hauler_admin          — own hauler only (403 otherwise)
//   - lender                — full corridor access (per-hauler
//                              performance is what they price risk
//                              on); operational write history (audit
//                              trail) is blanked, same line we draw
//                              for the Today digest.
router.get('/:id/scorecard', (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id !== h.id) {
    return res.status(403).json({ error: 'Hauler admins can only view their own scorecard' });
  }

  const weekOffset = Math.max(-12, Math.min(0, Number(req.query.week_offset) || 0));
  const now        = new Date();
  const periodEnd  = new Date(now.getTime() + weekOffset * 7 * ONE_DAY_MS);
  const periodStart = new Date(periodEnd.getTime() - 7 * ONE_DAY_MS);
  const periodStartIso = periodStart.toISOString();
  const periodEndIso   = periodEnd.toISOString();

  // ── Trip & tonnes window ────────────────────────────────────────
  const haulerTrips = TRIPS.filter((t) => t.hauler_id === h.id);
  const weekTrips   = haulerTrips.filter((t) => {
    const ts = new Date(t.departed_at).getTime();
    return ts >= periodStart.getTime() && ts < periodEnd.getTime();
  });
  const tonnesWeek    = weekTrips.reduce((s, t) => s + (t.tonnage_t || 0), 0);
  const revenueWeek   = weekTrips.reduce((s, t) => s + (t.revenue_usd || 0), 0);
  const costWeek      = weekTrips.reduce((s, t) => s + (t.cost?.total_usd || 0), 0);
  const delayedWeek   = weekTrips.filter((t) => t.status === 'delayed').length;
  const onTimeWeekPct = weekTrips.length
    ? Math.round(((weekTrips.length - delayedWeek) / weekTrips.length) * 1000) / 10
    : null;

  // Daily tonnage over the 7-day window for the inline sparkline.
  const dailyTonnes = [];
  for (let i = 0; i < 7; i += 1) {
    const dayStart = new Date(periodStart.getTime() + i * ONE_DAY_MS);
    const dayEnd   = new Date(dayStart.getTime() + ONE_DAY_MS);
    const t = weekTrips.filter((tr) => {
      const ts = new Date(tr.departed_at).getTime();
      return ts >= dayStart.getTime() && ts < dayEnd.getTime();
    });
    dailyTonnes.push({
      date:    dayStart.toISOString().slice(0, 10),
      tonnes:  Math.round(t.reduce((s, x) => s + (x.tonnage_t || 0), 0)),
      trips:   t.length,
      delayed: t.filter((x) => x.status === 'delayed').length,
    });
  }

  // ── Lifecycle activity in window ────────────────────────────────
  const hseAll       = incidentState.all().filter((i) => i.hauler_id === h.id);
  const hseInWeek    = hseAll.filter((i) => i.occurred_at >= periodStartIso && i.occurred_at < periodEndIso);
  const hseClosedWk  = hseAll.filter((i) => i.status === 'CLOSED' && (i.closed_at || '') >= periodStartIso && (i.closed_at || '') < periodEndIso);
  const coachingWk   = coachingState.forHauler(h.id)
    .filter((c) => c.held_at >= periodStartIso && c.held_at < periodEndIso);
  const licencesAll  = LICENCE_EXPIRY.filter((l) => l.hauler_id === h.id);
  const licencesRenewedInWeek = licencesAll
    .map((l) => ({ ...l, overlay: licenceState.getState(l.id) }))
    .filter((l) => l.overlay?.renewed_at && l.overlay.renewed_at >= periodStartIso && l.overlay.renewed_at < periodEndIso);

  // ── Forecast slice (corridor month-end projection) ──────────────
  const corridorForecast = buildForecast(roster.list(), now);
  const forecast = corridorForecast.haulers.find((p) => p.hauler_id === h.id) ?? null;
  const corridorRank = (() => {
    const sorted = [...corridorForecast.haulers]
      .filter((p) => p.status === 'active')
      .sort((a, b) => b.projected_pct_contracted - a.projected_pct_contracted);
    const idx = sorted.findIndex((p) => p.hauler_id === h.id);
    return idx >= 0 ? { rank: idx + 1, of: sorted.length } : null;
  })();

  // ── Audit feed (per-hauler writes in window) — lender-blanked ──
  const { rows: audit } = listAudit({ since: periodStartIso, limit: 500 });
  const haulerAudit = audit.filter((r) => (
    r.entity_id === h.id || payloadMentionsHauler(r.payload, h.id)
  ));

  res.json({
    generated_at: now.toISOString(),
    generated_by: req.user ? {
      display_name: req.user.display_name,
      role:         req.user.role,
      organisation: req.user.organisation,
    } : null,
    hauler: {
      id: h.id,
      display_name: h.display_name,
      onboarded_date: h.onboarded_date,
      contracted_trucks: h.fleet.contracted_trucks,
      active_trucks:     h.fleet.active_trucks,
    },
    period: {
      since: periodStartIso,
      until: periodEndIso,
      week_offset: weekOffset,
      label: `${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
    },
    week: {
      trips:        weekTrips.length,
      laden_trips:  weekTrips.filter((t) => t.direction === 'southbound').length,
      tonnes:       Math.round(tonnesWeek),
      revenue_usd:  revenueWeek,
      cost_usd:     costWeek,
      margin_usd:   revenueWeek - costWeek,
      on_time_pct:  onTimeWeekPct,
      delayed:      delayedWeek,
      daily:        dailyTonnes,
    },
    lifecycle: {
      hse_logged:      hseInWeek.length,
      hse_closed:      hseClosedWk.length,
      coaching_held:   coachingWk.length,
      licences_renewed: licencesRenewedInWeek.length,
    },
    forecast,
    corridor_rank: corridorRank,
    audit: req.user?.role === 'lender'
      ? { restricted: true, recent: [] }
      : {
          recent: haulerAudit.slice(0, 15).map((r) => ({
            id: r.id, ts: r.ts,
            entity_type: r.entity_type, entity_id: r.entity_id,
            action: r.action, summary: r.summary,
            actor: r.actor?.display_name ?? r.actor?.email ?? null,
          })),
        },
  });
});

/* ── Integration ────────────────────────────────────────────────── */

router.get('/:id/integration', (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  res.json({
    hauler_id: h.id,
    integration: h.integration,
    state: integrationStore.summary(h.id),
  });
});

router.post('/:id/integration/probe', requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    if (!assertHaulerScope(req, res)) return;
    const h = roster.find(req.params.id);
    if (!h) return res.status(404).json({ error: 'Hauler not found' });
    const result = await registry.probe(h, req.body ?? {});
    const { csv_text, password, ...safeCreds } = req.body ?? {};
    integrationStore.setCreds(h.id, { ...safeCreds, stored_at: new Date().toISOString() });
    integrationStore.setProbe(h.id, result);
    // Reflect the probe in the hauler record — operator sees the connection
    // transition from degraded/pending to live without a page reload.
    h.integration.last_sync      = result.probed_at;
    h.integration.error_count_24h = result.ok ? 0 : (h.integration.error_count_24h ?? 0) + 1;
    writeAudit({
      req,
      entity_type: 'integration',
      entity_id:   h.id,
      action:      result.ok ? 'probe_ok' : 'probe_failed',
      summary:     `Probed ${h.display_name} · ${h.integration.type}${result.ok ? ' · OK' : ' · FAILED'}`,
      payload:     { type: h.integration.type, ok: !!result.ok, probed_at: result.probed_at },
    });
    res.json({ probe: result, state: integrationStore.summary(h.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/integration/csv', requireRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    if (!assertHaulerScope(req, res)) return;
    const h = roster.find(req.params.id);
    if (!h) return res.status(404).json({ error: 'Hauler not found' });
    if (h.integration.type !== 'manual') {
      return res.status(400).json({ error: 'CSV upload is only valid for manual integration' });
    }
    const { csv_text } = req.body ?? {};
    if (typeof csv_text !== 'string' || !csv_text.trim()) {
      return res.status(400).json({ error: 'csv_text (string) is required' });
    }
    const { rows, errors } = manualAdapter.parseCsv(csv_text);
    if (!rows.length) {
      return res.status(400).json({ error: 'No valid rows parsed', errors });
    }
    integrationStore.setCsv(h.id, rows);
    h.integration.last_sync = new Date().toISOString();
    writeAudit({
      req,
      entity_type: 'integration',
      entity_id:   h.id,
      action:      'csv_upload',
      summary:     `CSV upload · ${h.display_name} · ${rows.length} rows`,
      payload:     { rows_loaded: rows.length, errors: errors.length },
    });
    res.json({
      rows_loaded: rows.length,
      errors,
      state: integrationStore.summary(h.id),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/integration/token', requireRole(...WRITE_ROLES), (req, res) => {
  if (!assertHaulerScope(req, res)) return;
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  integrationStore.clearCreds(h.id);
  writeAudit({
    req,
    entity_type: 'integration',
    entity_id:   h.id,
    action:      'rotate_token',
    summary:     `Cleared credentials for ${h.display_name}`,
  });
  res.json({ cleared: true, state: integrationStore.summary(h.id) });
});

// ── Phase 109: Onboard — multi-field wizard payload ──────────────────────────
router.post('/', requireRole(...OPS_ROLES), (req, res) => {
  const {
    display_name, contracted_trucks, integration_type,
    contact_name, contact_email, contract_share_pct, planned_start_date,
  } = req.body || {};

  if (typeof display_name !== 'string' || !display_name.trim()) {
    return res.status(400).json({ error: 'display_name is required' });
  }
  const trucks = Number(contracted_trucks);
  if (!Number.isInteger(trucks) || trucks <= 0) {
    return res.status(400).json({ error: 'contracted_trucks must be a positive integer' });
  }
  if (!['loconav', 'custom', 'manual'].includes(integration_type)) {
    return res.status(400).json({ error: 'integration_type must be loconav, custom, or manual' });
  }
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return res.status(400).json({ error: 'contact_email must be a valid email address' });
  }
  if (planned_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(planned_start_date)) {
    return res.status(400).json({ error: 'planned_start_date must be YYYY-MM-DD' });
  }

  const created = {
    id:                 roster.nextId(),
    display_name:       display_name.trim(),
    onboarded_date:     new Date().toISOString().slice(0, 10),
    status:             'pending',
    contact_name:       contact_name?.trim()  || null,
    contact_email:      contact_email?.trim() || null,
    contract_share_pct: contract_share_pct != null ? Number(contract_share_pct) : null,
    planned_start_date: planned_start_date || null,
    integration: {
      type:            integration_type,
      adapter:         null,
      last_sync:       null,
      error_count_24h: integration_type === 'manual' ? null : 0,
    },
    fleet:       { contracted_trucks: trucks, active_trucks: 0 },
    performance: { on_time_pct: 0, sla_attainment_pct: 0, safety_score: 0 },
    run_rate:    0,
    _persisted:  true,
  };

  // Persist to DB first, then add to in-memory roster.
  rosterStore.add(created);
  roster.add(created);

  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   created.id,
    action:      'onboard',
    summary:     `Onboarded ${created.display_name} (${trucks} rigs, ${integration_type})`,
    payload:     {
      display_name:       created.display_name,
      contracted_trucks:  trucks,
      integration_type,
      contact_email:      created.contact_email,
      planned_start_date: created.planned_start_date,
    },
  });
  res.status(201).json({ id: created.id, status: created.status });
});

// ── Phase 109: Update pending hauler fields ───────────────────────────────────
router.patch('/:id', requireRole(...OPS_ROLES), (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (!h._persisted) {
    return res.status(400).json({ error: 'Mock haulers cannot be edited via API' });
  }

  const {
    display_name, contracted_trucks,
    contact_name, contact_email, contract_share_pct, planned_start_date,
  } = req.body || {};

  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return res.status(400).json({ error: 'contact_email must be a valid email address' });
  }
  if (planned_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(planned_start_date)) {
    return res.status(400).json({ error: 'planned_start_date must be YYYY-MM-DD' });
  }

  const fields = {};
  if (display_name       != null) fields.display_name       = display_name.trim();
  if (contracted_trucks  != null) fields.contracted_trucks  = Number(contracted_trucks);
  if ('contact_name'        in (req.body || {})) fields.contact_name       = contact_name?.trim()  || null;
  if ('contact_email'       in (req.body || {})) fields.contact_email      = contact_email?.trim() || null;
  if ('contract_share_pct'  in (req.body || {})) fields.contract_share_pct = contract_share_pct != null ? Number(contract_share_pct) : null;
  if ('planned_start_date'  in (req.body || {})) fields.planned_start_date = planned_start_date || null;

  rosterStore.update(h.id, fields);
  roster.update(h.id, fields);

  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   h.id,
    action:      'update',
    summary:     `Updated ${h.display_name} — ${Object.keys(fields).join(', ')}`,
    payload:     fields,
  });
  res.json({ hauler: roster.find(h.id) });
});

// ── Phase 109: Checklist step toggle ─────────────────────────────────────────
router.patch('/:id/checklist/:step', requireRole(...OPS_ROLES), (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (h.status !== 'pending') {
    return res.status(400).json({ error: 'Hauler is already active; checklist is read-only' });
  }
  const { done } = req.body ?? {};
  try {
    const checklist = onboardingChecklist.setStep(h.id, req.params.step, {
      done:       done !== false,  // default true; pass false to un-check
      by_display: req.user.display_name,
    });
    writeAudit({
      req,
      entity_type: 'hauler',
      entity_id:   h.id,
      action:      done !== false ? 'checklist_done' : 'checklist_undo',
      summary:     `${done !== false ? 'Checked' : 'Unchecked'} "${req.params.step}" for ${h.display_name}`,
      payload:     { step: req.params.step, done: done !== false },
    });
    res.json({ checklist });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Phase 109: Activate hauler ────────────────────────────────────────────────
// Transitions status from pending → active. Requires all checklist steps
// to be complete. Only axis_admin can activate (axis_ops can configure but
// the final activation is an admin decision).
router.post('/:id/activate', requireRole('axis_admin'), (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (h.status === 'active') {
    return res.status(400).json({ error: 'Hauler is already active' });
  }
  if (!h._persisted) {
    return res.status(400).json({ error: 'Mock haulers cannot be activated via API' });
  }
  if (!onboardingChecklist.allComplete(h.id)) {
    const cl = onboardingChecklist.getChecklist(h.id);
    const missing = cl.filter((s) => !s.done).map((s) => s.label);
    return res.status(400).json({
      error: 'Cannot activate — checklist incomplete',
      missing_steps: missing,
    });
  }

  const activatedAt = new Date().toISOString();
  rosterStore.update(h.id, { status: 'active', activated_at: activatedAt });
  roster.update(h.id,   { status: 'active', activated_at: activatedAt });

  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   h.id,
    action:      'activate',
    summary:     `Activated ${h.display_name} — now live on corridor`,
    payload:     { display_name: h.display_name, contracted_trucks: h.fleet.contracted_trucks },
  });
  res.json({ id: h.id, status: 'active', activated_at: activatedAt });
});

// ── Helpers ────────────────────────────────────────────────────────

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildFleetBreakdown(haulerId) {
  const rigs = FLEET.filter((t) => t.hauler_id === haulerId);
  const status = { in_transit: 0, at_origin: 0, at_destination: 0, garage: 0 };
  const flags  = { critical: 0, service_due: 0, road_worthy_30d: 0, healthy: 0 };
  for (const r of rigs) {
    if (status[r.status] != null) status[r.status] += 1;
    if (r.maintenance_flag && flags[r.maintenance_flag] != null) {
      flags[r.maintenance_flag] += 1;
    } else {
      flags.healthy += 1;
    }
  }
  return { total: rigs.length, status, flags };
}

function buildDriverRoster(haulerId) {
  const drivers = DRIVERS.filter((d) => d.hauler_id === haulerId);
  return {
    total:    drivers.length,
    primary:  drivers.filter((d) => d.assigned_rig_id).length,
    relief:   drivers.filter((d) => !d.assigned_rig_id).length,
    rest_breach:  drivers.filter((d) => d.rest_status === 'breach').length,
    rest_warning: drivers.filter((d) => d.rest_status === 'warning').length,
    coaching_flagged: drivers.filter((d) => d.flag).length,
    avg_safety_score: drivers.length
      ? Math.round((drivers.reduce((s, d) => s + d.safety_score, 0) / drivers.length) * 10) / 10
      : 0,
  };
}

function buildMtd(haulerId) {
  // "Month to date" = all trips for this hauler inside the current UTC
  // calendar month. Trips carry departed_at; fuel/driver/maintenance/tolls
  // stack summed for the cost side; southbound revenue only for the income.
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const trips = TRIPS.filter((t) =>
    t.hauler_id === haulerId &&
    new Date(t.departed_at).getTime() >= monthStart,
  );
  let tonnes = 0, revenue = 0, cost = 0, delayed = 0;
  for (const t of trips) {
    tonnes  += t.tonnage_t;
    revenue += t.revenue_usd;
    cost    += t.cost.total_usd;
    if (t.status === 'delayed') delayed += 1;
  }
  return {
    trip_count:       trips.length,
    laden_count:      trips.filter((t) => t.direction === 'southbound').length,
    delayed_count:    delayed,
    tonnes_delivered: Math.round(tonnes * 10) / 10,
    revenue_usd:      revenue,
    cost_usd:         cost,
    margin_usd:       revenue - cost,
    on_time_pct:      trips.length
      ? Math.round(((trips.length - delayed) / trips.length) * 1000) / 10
      : null,
  };
}

function buildSlaSeries(h) {
  // Twelve-week walk-back from today's SLA attainment with ±1.5 pt drift.
  // Deterministic per hauler so the lender sparkline doesn't flicker.
  const seed = hashOf(h.id);
  const base = h.performance.sla_attainment_pct || 90;
  const points = [];
  let v = base;
  for (let i = 0; i < 12; i += 1) {
    points.push({ week_offset: -i, value: Math.round(v * 10) / 10 });
    const delta = ((seed + i * 19) % 7) / 2 - 1.5;  // -1.5..+1.5
    v = Math.max(75, Math.min(99, v - delta));
  }
  return points.reverse();
}

function buildSettlement(h, mtd) {
  // Invoicing cadence for haulage corridor: weekly run-rate invoice,
  // 14-day payment term per the GIBDLC treasury schedule. Outstanding is
  // a fraction of MTD revenue; days-to-settle derived deterministically.
  const seed = hashOf(h.id);
  const invoicedUsd   = mtd.revenue_usd;
  const paidRatio     = 0.70 + ((seed % 25) / 100);  // 0.70–0.94
  const paidUsd       = Math.round(invoicedUsd * paidRatio);
  const outstandingUsd = Math.max(0, invoicedUsd - paidUsd);
  const daysToSettle  = 6 + (seed % 9);                // 6–14 days
  const onTimePayPct  = Math.round((88 + (seed % 11)) * 10) / 10; // 88.0–98.0
  return {
    term_days:      14,
    invoiced_usd:   invoicedUsd,
    paid_usd:       paidUsd,
    outstanding_usd: outstandingUsd,
    avg_days_to_settle: daysToSettle,
    on_time_pay_pct: onTimePayPct,
    next_invoice_iso: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function buildOpenAlerts(haulerId) {
  return ALERTS
    .filter((a) => a.hauler_id === haulerId && a.status !== 'RESOLVED')
    .map((a) => ({
      id: a.id, severity: a.severity, type: a.type,
      title: a.title, status: a.status, opened_at: a.opened_at,
    }));
}

// ── Phase 41 — Lifecycle dossier ──────────────────────────────────
//   Aggregate the operational write history (HSE / coaching / licence /
//   audit) into a single per-hauler block. The four overlay tables added
//   in Phases 30–38 each carry hauler scope, so this is a thin assembly:
//   trim to a 30-day rolling window, surface a small "recent" tail per
//   stream, and lift the audit log entries that mention this hauler
//   anywhere in their payload (matching the digest's substring rule).
function buildLifecycle(haulerId, now = Date.now()) {
  const cutoffIso = new Date(now - 30 * ONE_DAY_MS).toISOString();

  // HSE — open count is timeless (any unfinished incident still counts);
  // closed_30d narrows to the rolling window so the number tracks effort.
  const hseAll      = incidentState.all().filter((i) => i.hauler_id === haulerId);
  const hseOpen     = hseAll.filter((i) => i.status === 'OPEN');
  const hseClosed30 = hseAll.filter((i) => i.status === 'CLOSED' && (i.closed_at || '') >= cutoffIso);
  const hseRecent   = hseAll.slice(0, 5).map((i) => ({
    id:                 i.id,
    occurred_at:        i.occurred_at,
    category:           i.category,
    type:               i.type,
    km_marker:          i.km_marker,
    status:             i.status,
    corrective_action:  i.corrective_action,
    closed_at:          i.closed_at,
    closed_by_display:  i.closed_by_display,
  }));

  // Coaching — sessions in last 30d plus the most recent (which may be
  // older than 30d if the dispatcher has been quiet).
  const coachingWindow = coachingState.recentWindow(30, now)
    .filter((c) => c.hauler_id === haulerId);
  const coachingLast = coachingState.forHauler(haulerId)[0] ?? null;
  const coachingRecent = coachingWindow.slice(0, 5).map((c) => ({
    id:                  c.id,
    held_at:             c.held_at,
    topic:               c.topic,
    dispatcher_name:     c.dispatcher_name,
    attendees_count:     c.attendees_count,
    expected_delta_pct:  c.expected_delta_pct,
    created_by_display:  c.created_by_display,
    linked_alert_count:  Array.isArray(c.linked_alert_ids) ? c.linked_alert_ids.length : 0,
  }));

  // Licences — match the static driver pipeline against the renewal
  // overlay so we surface "renewed in the last 30d" plus the live
  // expiry list. Days remaining is recomputed against the new expiry
  // when an overlay exists.
  const licencesForHauler = LICENCE_EXPIRY.filter((l) => l.hauler_id === haulerId);
  const licenceRows = licencesForHauler.map((l) => {
    const overlay = licenceState.getState(l.id);
    const expiry  = overlay?.expiry_iso ?? l.expiry;
    const daysRemaining = Math.round((new Date(expiry).getTime() - now) / ONE_DAY_MS);
    return {
      id:               l.id,
      driver:           l.driver,
      document:         l.document,
      expiry,
      days_remaining:   daysRemaining,
      renewed_at:       overlay?.renewed_at ?? null,
      renewed_by:       overlay?.renewed_by ?? null,
      ref_number:       overlay?.ref_number ?? null,
    };
  });
  const licencesRenewed30 = licenceRows.filter(
    (l) => l.renewed_at && l.renewed_at >= cutoffIso,
  );
  const licencesExpiring = licenceRows
    .filter((l) => l.days_remaining <= 30)
    .sort((a, b) => a.days_remaining - b.days_remaining);

  // Audit trail — pull the top 50 writes since the cutoff, then keep
  // those whose payload (or entity_id) mentions this hauler. Trim to 10
  // for the dossier; the full feed is still on the Settings audit panel.
  const { rows: auditRecent } = listAudit({ since: cutoffIso, limit: 200 });
  const auditForHauler = auditRecent.filter((r) => (
    r.entity_id === haulerId || payloadMentionsHauler(r.payload, haulerId)
  )).slice(0, 10).map((r) => ({
    id:           r.id,
    ts:           r.ts,
    entity_type:  r.entity_type,
    entity_id:    r.entity_id,
    action:       r.action,
    summary:      r.summary,
    actor:        r.actor?.display_name ?? r.actor?.email ?? null,
    actor_role:   r.actor?.role ?? null,
  }));

  return {
    window_days: 30,
    hse: {
      open:        hseOpen.length,
      closed_30d:  hseClosed30.length,
      recent:      hseRecent,
    },
    coaching: {
      sessions_30d:  coachingWindow.length,
      last_held_at:  coachingLast?.held_at ?? null,
      recent:        coachingRecent,
    },
    licences: {
      renewed_30d:  licencesRenewed30.length,
      expiring:     licencesExpiring,
    },
    audit: {
      total_30d: auditForHauler.length,
      recent:    auditForHauler,
    },
  };
}

// Match the substring rule used by routes/today.js so the per-hauler
// audit feed here stays consistent with the operations log scope.
function payloadMentionsHauler(payload, haulerId) {
  if (!payload || !haulerId) return false;
  if (payload.hauler_id === haulerId) return true;
  try { return JSON.stringify(payload).includes(`"${haulerId}"`); }
  catch { return false; }
}

// ── Phase 69 — Hauler contact log ─────────────────────────────────
//
// Per-hauler structured record of phone / WhatsApp / email / site
// visit / meeting contacts with the hauler's manager (or whoever
// the operator reaches). Mirrors the receivables chase log
// (Phase 64) generalized to any hauler.
//
// Read access — all roles. Write access — axis_admin, axis_ops,
// hauler_admin (the hauler can log inbound contacts they
// initiated). Lender is read-only.
const CONTACT_WRITE_ROLES = ['axis_admin', 'axis_ops', 'hauler_admin'];

router.get('/:id/contacts', (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (!assertHaulerScope(req, res)) return;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({
    hauler_id: h.id,
    contacts:  haulerContacts.forHauler(h.id, limit),
  });
});

router.post('/:id/contacts', requireRole(...CONTACT_WRITE_ROLES), (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (!assertHaulerScope(req, res)) return;
  try {
    const contact = haulerContacts.add({
      hauler_id:         h.id,
      channel:           req.body?.channel,
      direction:         req.body?.direction || 'outbound',
      counterparty_name: req.body?.counterparty_name,
      counterparty_role: req.body?.counterparty_role,
      summary:           req.body?.summary,
      outcome:           req.body?.outcome,
      follow_up_at:      req.body?.follow_up_at,
      by_user_id:        req.user.id,
      by_display:        req.user.display_name,
      by_role:           req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'hauler_contact',
      entity_id:   String(contact.id),
      action:      'create',
      summary:     `${h.display_name} · ${contact.channel} (${contact.direction}) · ${contact.outcome}: ${contact.summary.slice(0, 80)}${contact.summary.length > 80 ? '…' : ''}`,
      payload:     { hauler_id: h.id, channel: contact.channel, outcome: contact.outcome },
    });
    res.json({ contact });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/contacts/:contactId/resolve', requireRole(...CONTACT_WRITE_ROLES), (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (!assertHaulerScope(req, res)) return;
  const contactId = parseInt(req.params.contactId, 10);
  const existing = haulerContacts.findById(contactId);
  if (!existing || existing.hauler_id !== h.id) {
    return res.status(404).json({ error: 'Contact not found for this hauler' });
  }
  haulerContacts.resolveFollowup(contactId);
  writeAudit({
    req,
    entity_type: 'hauler_contact',
    entity_id:   String(contactId),
    action:      'resolve_followup',
    summary:     `${h.display_name} · resolved follow-up on ${existing.channel} contact`,
    payload:     { hauler_id: h.id },
  });
  res.json({ resolved: true, contact: haulerContacts.findById(contactId) });
});

router.delete('/:id/contacts/:contactId', requireRole('axis_admin'), (req, res) => {
  const h = roster.find(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  const contactId = parseInt(req.params.contactId, 10);
  const existing = haulerContacts.findById(contactId);
  if (!existing || existing.hauler_id !== h.id) {
    return res.status(404).json({ error: 'Contact not found for this hauler' });
  }
  haulerContacts.remove(contactId);
  writeAudit({
    req,
    entity_type: 'hauler_contact',
    entity_id:   String(contactId),
    action:      'delete',
    summary:     `${h.display_name} · deleted contact log entry`,
    payload:     { hauler_id: h.id },
  });
  res.json({ deleted: true });
});

// ── Phase 88 — Integration health monitor ────────────────────────
//
// Per-hauler API sync log + summary. Read open to all roles
// (operators, lender, hauler-admin own scope). Manual retry
// restricted to write roles for the calling hauler.

router.get('/:id/integration-health', (req, res) => {
  const id = req.params.id;
  const h = roster.find(id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  // Hauler-admin scope.
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Compute api_status the same way the aggregator does. Avoids
  // pulling in the whole aggregator just for this field.
  const apiStatus = h.status === 'pending' ? 'pending'
                  : h.integration?.type === 'manual' ? 'manual'
                  : (h.integration?.error_count_24h || 0) > 0 ? 'degraded'
                  : 'connected';
  res.json({
    hauler_id:    h.id,
    display_name: h.display_name,
    api_status:   apiStatus,
    integration_state: integrationStore.summary(h.id),
    health:    integrationSyncLog.health(h.id),
  });
});

router.post('/:id/integration-retry', requireRole(...WRITE_ROLES), (req, res) => {
  const id = req.params.id;
  const h = roster.find(id);
  if (!h) return res.status(404).json({ error: 'Hauler not found' });
  if (req.user.role === 'hauler_admin' && req.user.hauler_id !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Synthetic retry — same shape as a real probe success would
  // record. Demo mode doesn't have a real connector to call, so
  // we record an attempt with the latency mock-data shape.
  const now = Date.now();
  // 80% chance of success on manual retry — operator's pushing
  // the button, the underlying service has a real chance of
  // being up.
  const success = Math.random() < 0.8;
  const latency = success ? Math.round(80 + Math.random() * 220) : null;
  integrationSyncLog.record({
    hauler_id: id,
    success,
    latency_ms: latency,
    rows_synced: success ? Math.round(Math.random() * 80) + 12 : 0,
    error_code: success ? null : 'MANUAL_RETRY_FAILED',
    error_message: success ? null : 'Manual retry hit the same upstream failure mode',
  });
  writeAudit({
    req,
    entity_type: 'integration_sync',
    entity_id:   id,
    action:      success ? 'manual_retry_success' : 'manual_retry_failure',
    summary:     success
      ? `Manual sync retry succeeded for ${h.display_name} (${latency}ms)`
      : `Manual sync retry failed for ${h.display_name}`,
  });
  res.json({
    success,
    latency_ms: latency,
    health: integrationSyncLog.health(id),
  });
});

module.exports = router;
