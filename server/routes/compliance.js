'use strict';

/*
 * GET /api/compliance — axle-load + HSE + licence + filings.
 * Joins the compliance fixtures with the hauler roster so the UI can
 * render display names rather than opaque IDs. Per-hauler overload
 * summary carries the 30-day rollup AXIS surfaces on the landing strip.
 */

const express = require('express');
const router = express.Router();

const {
  AXLE_EVENTS,
  OVERLOAD_BY_HAULER,
  HSE,
  LICENCE_EXPIRY,
  FILINGS,
} = require('../mock/compliance');
const roster = require('../state/roster');
const filingState = require('../state/filingState');
const licenceState = require('../state/licenceState');
const incidentState = require('../state/incidentState');
const weighbridgeEvents = require('../state/weighbridgeEvents');
const { FLEET } = require('../mock/fleet');
const { writeAudit } = require('../db/audit');
const { requireRole } = require('../middleware/auth');

const WB_WRITE_ROLES = ['axis_admin', 'axis_ops'];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Implicit denominator from the fixture: 3 events / 1.42 per million tonne-km
// ≈ 2.11 Mtkm in the trailing 90-day window. Used to recompute current_per_mtk
// when overlay events land. Real systems will compute Mtkm from actual deliveries.
const HSE_MTKM_90D = (HSE.trailing_events_90d > 0 && HSE.current_per_mtk > 0)
  ? HSE.trailing_events_90d / HSE.current_per_mtk
  : 2.11;

// Fixture baseline merged with the filing_state overlay so mark-filed
// actions survive restart. Fixture fields win for descriptive columns
// (agency, period, due_iso); overlay wins for status + submitted_*.
function mergedFiling(filing) {
  const st = filingState.getState(filing.id);
  if (!st) return filing;
  return {
    ...filing,
    status:       st.status,
    submitted_at: st.submitted_at,
    submitted_by: st.submitted_by,
  };
}

function mergedFilings() {
  return FILINGS.map(mergedFiling);
}

const FILING_WRITE_ROLES   = ['axis_admin', 'axis_ops'];
const LICENCE_WRITE_ROLES  = ['axis_admin', 'axis_ops'];
const INCIDENT_WRITE_ROLES = ['axis_admin', 'axis_ops'];

// Merge a fixture HSE event with overlay rows so the panel sees one
// consistent shape: { id, date, hauler_id, category, type, km_marker,
// note, status, source }. Overlay rows carry corrective-action +
// linked-coaching fields; fixture rows are presumed long-since CLOSED.
function fixtureToEvent(e) {
  return {
    ...e,
    occurred_at: e.date,
    status: 'CLOSED',                      // fixture incidents predate the lifecycle
    corrective_action: null,
    linked_coaching_id: null,
    source: 'fixture',
  };
}

function overlayToEvent(row) {
  return {
    id:                  row.id,
    date:                row.occurred_at.slice(0, 10),
    occurred_at:         row.occurred_at,
    hauler_id:           row.hauler_id,
    truck:               row.truck,
    driver:              row.driver,
    category:            row.category,
    type:                row.type,
    km_marker:           row.km_marker,
    note:                row.note,
    status:              row.status,
    corrective_action:   row.corrective_action,
    closed_at:           row.closed_at,
    closed_by_display:   row.closed_by_display,
    linked_coaching_id:  row.linked_coaching_id,
    created_by_display:  row.created_by_display,
    source:              'overlay',
  };
}

function mergedHseEvents(now = Date.now()) {
  const fixture = HSE.events.map(fixtureToEvent);
  const overlay = incidentState.all().map(overlayToEvent);
  // Drop fixture events that happen to share an id with an overlay (shouldn't
  // happen with the gen-* prefix scheme, but defensive).
  const overlayIds = new Set(overlay.map((e) => e.id));
  return [...overlay, ...fixture.filter((e) => !overlayIds.has(e.id))]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
}

function hseSummary(events, now = Date.now()) {
  const cutoff = now - 90 * ONE_DAY_MS;
  const trailing = events.filter((e) => new Date(e.occurred_at).getTime() >= cutoff);
  const current_per_mtk = +(trailing.length / HSE_MTKM_90D).toFixed(2);
  return {
    target_per_mtk: HSE.target_per_mtk,
    current_per_mtk,
    trailing_events_90d: trailing.length,
    open_count: events.filter((e) => e.status === 'OPEN').length,
    events,
  };
}

// Merge renewal overlay with fixture row. `days_remaining` is recomputed
// against the server clock so the pipeline is always current — a renewal
// posted today for a licence that was 12 d out shifts it to (e.g.) 740 d
// immediately, and the row drops off the 90-day pipeline.
function mergedLicence(licence, now = Date.now()) {
  const st = licenceState.getState(licence.id);
  const expiryIso = st?.expiry_iso ?? licence.expiry;
  const daysRemaining = Math.ceil((new Date(expiryIso).getTime() - now) / ONE_DAY_MS);
  return {
    ...licence,
    expiry: expiryIso,
    days_remaining: daysRemaining,
    renewed: !!st,
    renewed_at: st?.renewed_at ?? null,
    renewed_by: st?.renewed_by ?? null,
    ref_number: st?.ref_number ?? null,
  };
}

function mergedLicences(now = Date.now()) {
  return LICENCE_EXPIRY.map((l) => mergedLicence(l, now));
}

// Per-agency contact ledger. Real onboarding will replace with the live
// regulator desk; for v1 this gives the drawer a credible counterparty.
const AGENCY_DESK = {
  'DVLA':                { internal_owner: 'Adwoa Mensah · AXIS Compliance', regulator_desk: 'fleetops@dvla.gov.gh',     phone: '+233 30 224 4144' },
  'GHA':                 { internal_owner: 'Kojo Appiah · AXIS Ops',         regulator_desk: 'levy@gha.gov.gh',           phone: '+233 30 266 8200' },
  'EPA':                 { internal_owner: 'Adwoa Mensah · AXIS Compliance', regulator_desk: 'compliance@epa.gov.gh',     phone: '+233 30 266 4697' },
  'Minerals Commission': { internal_owner: 'Yaw Osei · AXIS Contract',       regulator_desk: 'returns@mineralscom.gov.gh', phone: '+233 30 277 2783' },
};

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function evidenceFor(filing) {
  // Each agency expects a different bundle. Names mirror the regulator's
  // checklist so the operator recognises what's owed before submission.
  const map = {
    'DVLA': filing.id.includes('-ann')
      ? ['Annual fleet registry CSV', 'Roadworthy certificates · all rigs', 'Insurance schedule']
      : ['Roadworthy certificates · 18 trucks', 'Axle-load annexe', 'Insurance schedule'],
    'GHA':                 ['Axle-load levy ledger', 'Weighbridge tickets · prior month', 'Bank receipt'],
    'EPA':                 ['Dust-suppression log · Nyinahin loading zone', 'PM10 readings · weekly', 'Mitigation plan addendum'],
    'Minerals Commission': ['Activity return template', 'Tonnage attestation', 'Royalty reconciliation'],
  };
  return map[filing.agency] ?? [];
}

function historyFor(filing) {
  // Rolling 4-period submission history. Deterministic per filing id so
  // the drawer is stable across page reloads in demo mode.
  const seed = hashOf(filing.id);
  const periods = ['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026'];
  return periods.map((label, i) => {
    const days = (seed + i * 7) % 12;
    const submittedDays = days < 9 ? days : null;
    const past = i < periods.length - 1 || filing.status === 'FILED';
    if (!past) return { period: label, status: 'UPCOMING', submitted_at: null, days_to_due: null };
    return {
      period: label,
      status: submittedDays != null ? 'FILED' : 'LATE',
      submitted_at: null,
      days_to_due: submittedDays != null ? submittedDays - 4 : 3, // negative = early
    };
  });
}

function detailFor(filing) {
  const merged = mergedFiling(filing);
  const desk = AGENCY_DESK[merged.agency] ?? {};
  return {
    ...merged,
    ...desk,
    evidence_required: evidenceFor(merged),
    submission_history: historyFor(merged),
  };
}

router.get('/', (_req, res) => {
  const nameById = Object.fromEntries(roster.list().map((h) => [h.id, h.display_name]));

  // Phase 116 — blend live weighbridge hold events on top of the mock baseline.
  const since30d  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Normalize live events to the same field shape as the mock AXLE_EVENTS.
  const liveWbEvts = weighbridgeEvents.since(since30d).map((e) => ({
    id:                  `live-${e.id}`,
    timestamp:           e.logged_at,                        // same field as mock
    hauler_id:           e.hauler_id ?? '',
    hauler_display_name: e.hauler_id ? (nameById[e.hauler_id] ?? e.hauler_id) : 'Unknown',
    truck:               e.plate,                            // plate replaces truck code
    gvw_tonnes:          e.gross_weight_t,
    overload_kg:         e.overage_t != null ? Math.round(e.overage_t * 1000) : 0,
    action:              'HOLD',
    delay_min:           e.hold_minutes ?? null,
    note:                [
      e.weighbridge ? `Weighbridge: ${e.weighbridge}` : null,
      e.notes ?? null,
      e.logged_by_name ? `Logged by ${e.logged_by_name}` : null,
    ].filter(Boolean).join(' · ') || null,
    is_live:             true,
  }));

  const axleEvents = [
    ...liveWbEvts,                          // live events first
    ...AXLE_EVENTS.map((e) => ({
      ...e,
      hauler_display_name: nameById[e.hauler_id] ?? e.hauler_id,
      is_live: false,
    })),
  ];

  // Recompute 30d summary from the merged set.
  const wbSummary = weighbridgeEvents.summary(since30d);

  const overloadByHauler = OVERLOAD_BY_HAULER.map((h) => ({
    ...h,
    hauler_display_name: nameById[h.hauler_id] ?? h.hauler_id,
  }));

  const mergedEvents = mergedHseEvents();
  const hseRollup = hseSummary(mergedEvents);
  const hse = {
    ...hseRollup,
    events: hseRollup.events.map((e) => ({
      ...e,
      hauler_display_name: nameById[e.hauler_id] ?? e.hauler_id,
    })),
  };

  // Pipeline shows the live 90-day window. Renewed licences with a new
  // expiry beyond 90 d drop off; renewals that still fall inside the
  // window remain visible with a `renewed: true` flag so the UI can
  // surface the DVLA reference and recent-renewal timestamp.
  const now = Date.now();
  const licenceExpiry = mergedLicences(now)
    .filter((l) => l.days_remaining <= 90)
    .sort((a, b) => a.days_remaining - b.days_remaining)
    .map((l) => ({
      ...l,
      hauler_display_name: nameById[l.hauler_id] ?? l.hauler_id,
    }));

  // 30-day axle summary — holds vs warnings totals (merged set).
  const summary = axleEvents.reduce(
    (s, e) => {
      if (e.action === 'HOLD')    s.holds += 1;
      if (e.action === 'WARNING') s.warnings += 1;
      s.delay_min_total += e.delay_min ?? 0;
      return s;
    },
    { holds: 0, warnings: 0, delay_min_total: 0 },
  );

  // Phase 150 — unified compliance deadline countdown.
  // Merges driver licences (already filtered to ≤90d) with regulatory
  // filings that are not yet FILED, sorted urgency-first so operators
  // see what needs action before they dig into detail panels.
  const filingDeadlines = mergedFilings()
    .filter((f) => f.status !== 'FILED')
    .map((f) => {
      const daysRem = Math.round((new Date(f.due).getTime() - now) / 86_400_000);
      return {
        id:             f.id,
        kind:           'filing',
        label:          f.detail,
        agency:         f.agency,
        days_remaining: daysRem,
        due_date:       f.due,
        status:         f.status,
        overdue:        daysRem < 0,
      };
    })
    .filter((d) => d.days_remaining <= 90);

  const licenceDeadlines = licenceExpiry.map((l) => ({
    id:             l.id,
    kind:           'licence',
    label:          `${l.driver} — ${l.document}`,
    hauler_display: l.hauler_display_name,
    days_remaining: l.days_remaining,
    due_date:       l.expiry,
    status:         l.renewed ? 'RENEWED' : 'DUE',
    overdue:        l.days_remaining < 0,
  }));

  const upcoming_deadlines = [...filingDeadlines, ...licenceDeadlines]
    .sort((a, b) => a.days_remaining - b.days_remaining);

  // Phase 167 — compliance health score + 8-week trend.
  // Score = share of tracked items currently compliant (0–100).
  // Licences counted compliant if > 30 days remaining and not overdue.
  // Filings counted compliant if status === 'FILED'.
  // Prior 7 weeks use a seeded PRNG; current week is live.
  const allFilings   = mergedFilings();
  const allLicences  = mergedLicences(now).filter((l) => l.days_remaining <= 90);
  const compliantLic = allLicences.filter((l) => l.days_remaining > 30 && !l.overdue).length;
  const compliantFil = allFilings.filter((f)  => f.status === 'FILED').length;
  const totalItems   = allLicences.length + allFilings.length;
  const currentScore = totalItems > 0
    ? Math.round(((compliantLic + compliantFil) / totalItems) * 100)
    : 100;

  function seededHealthScore(n) {
    const raw = Math.sin(n * 3571 + 29) * 61_739;
    return raw - Math.floor(raw);
  }
  const nowH = new Date();
  const health_trend = [];
  for (let w = 7; w >= 0; w--) {
    const ref    = new Date(nowH.getTime() - w * 7 * 86_400_000);
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7));
    const weekLabel = monday.toISOString().slice(0, 10);
    const wk = monday.getUTCFullYear() * 1000
             + monday.getUTCMonth()    *   31
             + monday.getUTCDate();
    health_trend.push({
      week:  weekLabel,
      score: w === 0 ? currentScore : Math.round(68 + seededHealthScore(wk) * 28),
    });
  }

  const health_score = {
    current:          currentScore,
    status:           currentScore >= 85 ? 'GOOD' : currentScore >= 70 ? 'WATCH' : 'RISK',
    compliant_items:  compliantLic + compliantFil,
    total_items:      totalItems,
    trend:            health_trend,
  };

  // Phase 208 — 8-week axle-event frequency trend. Shows whether holds and
  // warnings are trending up or down week-on-week. Current week uses live
  // counts from the merged summary; prior 7 weeks are seeded. MODELLED.
  function seededAxleWeek(n) {
    const raw = Math.sin(n * 5003 + 47) * 89_041;
    return raw - Math.floor(raw);
  }
  const axle_weekly_trend = [];
  for (let w = 7; w >= 0; w--) {
    const weekMs = now - w * 7 * 86_400_000;
    const monDay = new Date(weekMs);
    monDay.setUTCDate(monDay.getUTCDate() - ((monDay.getUTCDay() + 6) % 7));
    monDay.setUTCHours(0, 0, 0, 0);
    const weekLabel = monDay.toISOString().slice(0, 10);
    const wk        = Math.round(weekMs / (7 * 86_400_000));
    const holds     = w === 0 ? summary.holds    : Math.round(1 + seededAxleWeek(wk) * 5);
    const warnings  = w === 0 ? summary.warnings : Math.round(seededAxleWeek(wk + 200) * 4);
    axle_weekly_trend.push({
      week:       weekLabel,
      holds,
      warnings,
      total:      holds + warnings,
      is_current: w === 0,
      modelled:   w > 0,
    });
  }

  res.json({
    generated_at: new Date().toISOString(),
    axle: {
      window_days:     30,
      holds:           summary.holds,
      warnings:        summary.warnings,
      delay_min_total: summary.delay_min_total,
      has_live_data:   wbSummary.has_live_data,
      events:          axleEvents,
      by_hauler:       overloadByHauler,
    },
    hse,
    licence_expiry: licenceExpiry,
    filings: mergedFilings(),
    upcoming_deadlines,
    health_score,
    axle_weekly_trend,
  });
});

// ── Filing detail drawer + mark-filed action ─────────────────────
//   GET  /api/compliance/filings/:id     — enriched detail
//   POST /api/compliance/filings/:id/mark-filed — flip DUE/ON_TRACK → FILED
//
// The mark-filed action mutates the in-memory FILINGS array and writes
// an audit line into the filing's submission history. Phase 10 gives
// this durable storage; for now the state survives until server restart.

router.get('/filings/:id', (req, res) => {
  const filing = FILINGS.find((f) => f.id === req.params.id);
  if (!filing) return res.status(404).json({ error: 'Filing not found' });
  res.json(detailFor(filing));
});

router.post('/filings/:id/mark-filed', requireRole(...FILING_WRITE_ROLES), (req, res) => {
  const filing = FILINGS.find((f) => f.id === req.params.id);
  if (!filing) return res.status(404).json({ error: 'Filing not found' });
  const merged = mergedFiling(filing);
  if (merged.status === 'FILED') {
    return res.status(400).json({ error: 'Filing is already marked as FILED' });
  }

  const submitted_by = `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`;
  const { submitted_at } = filingState.markFiled(filing.id, { submitted_by });

  writeAudit({
    req,
    entity_type: 'filing',
    entity_id:   filing.id,
    action:      'mark_filed',
    summary:     `Marked ${filing.agency} · ${filing.period ?? filing.name ?? filing.id} as filed`,
    payload:     { agency: filing.agency, period: filing.period ?? null, submitted_at },
  });

  res.json({
    filing: detailFor(filing),
    submitted_at,
    submitted_by,
  });
});

// ── Licence renewal ──────────────────────────────────────────────
//   POST /api/compliance/licences/:id/renew
//     body: { expiry_iso: "2028-04-24", ref_number?: "DVLA-E-887214", note?: "..." }
//
// Writes the new expiry to licence_state (overlay) and audits the event.
// The 30-day pipeline recomputes live against the server clock.
router.post('/licences/:id/renew', requireRole(...LICENCE_WRITE_ROLES), (req, res) => {
  const licence = LICENCE_EXPIRY.find((l) => l.id === req.params.id);
  if (!licence) return res.status(404).json({ error: 'Licence not found' });

  const { expiry_iso, ref_number, note } = req.body || {};
  if (!expiry_iso || Number.isNaN(new Date(expiry_iso).getTime())) {
    return res.status(400).json({ error: 'expiry_iso required (ISO 8601 date)' });
  }
  const newExpiryMs = new Date(expiry_iso).getTime();
  if (newExpiryMs <= Date.now()) {
    return res.status(400).json({ error: 'expiry_iso must be in the future' });
  }

  const prevExpiry = licenceState.getState(licence.id)?.expiry_iso ?? licence.expiry;
  const renewed_by = `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`;
  const saved = licenceState.renew(licence.id, { expiry_iso, ref_number, renewed_by, note });

  writeAudit({
    req,
    entity_type: 'licence',
    entity_id:   licence.id,
    action:      'renew',
    summary:     `Renewed ${licence.document} for ${licence.driver} — new expiry ${expiry_iso.slice(0, 10)}`,
    payload: {
      driver:       licence.driver,
      hauler_id:    licence.hauler_id,
      document:     licence.document,
      prev_expiry:  prevExpiry,
      new_expiry:   expiry_iso,
      ref_number:   ref_number || null,
    },
  });

  res.json({
    licence: mergedLicence(licence),
    saved,
  });
});

// ── HSE incident lifecycle ─────────────────────────────────────────
//   POST /api/compliance/incidents          — log a new incident
//   POST /api/compliance/incidents/:id/close — record corrective action
//
// Each event lands on the panel immediately and shifts the
// trailing-90d events-per-million-tonne-km readout. Cat A events
// surface a coaching nudge in Intelligence; close-out captures the
// regulator's chain-of-custody note.

const VALID_CATEGORIES = new Set(['A', 'B']);

router.post('/incidents', requireRole(...INCIDENT_WRITE_ROLES), (req, res) => {
  const {
    occurred_at, hauler_id, truck, driver, category, type,
    km_marker, note,
  } = req.body || {};

  if (!hauler_id) return res.status(400).json({ error: 'hauler_id required' });
  if (!type)      return res.status(400).json({ error: 'type required' });
  if (!VALID_CATEGORIES.has(category)) return res.status(400).json({ error: 'category must be A or B' });

  const created_by_display = `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`;

  let row;
  try {
    row = incidentState.create({
      occurred_at,
      hauler_id,
      truck,
      driver,
      category,
      type,
      km_marker,
      note,
      created_by_user_id: req.user.user_id,
      created_by_display,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  writeAudit({
    req,
    entity_type: 'hse_incident',
    entity_id:   row.id,
    action:      'create',
    summary:     `Logged Cat ${category} incident on ${hauler_id}: ${type}${km_marker != null ? ` (km ${km_marker})` : ''}`,
    payload:     { hauler_id, category, type, km_marker: km_marker ?? null, occurred_at: row.occurred_at },
  });

  res.status(201).json({ incident: overlayToEvent(row) });
});

router.post('/incidents/:id/close', requireRole(...INCIDENT_WRITE_ROLES), (req, res) => {
  const { corrective_action, linked_coaching_id } = req.body || {};
  if (!corrective_action || !corrective_action.trim()) {
    return res.status(400).json({ error: 'corrective_action required' });
  }

  const closed_by_display = `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`;
  let row;
  try {
    row = incidentState.close(req.params.id, {
      corrective_action,
      closed_by_display,
      linked_coaching_id,
    });
  } catch (err) {
    const status = err.message === 'Incident not found' ? 404 : 400;
    return res.status(status).json({ error: err.message });
  }

  writeAudit({
    req,
    entity_type: 'hse_incident',
    entity_id:   row.id,
    action:      'close',
    summary:     `Closed Cat ${row.category} incident on ${row.hauler_id} — ${row.type}`,
    payload:     {
      hauler_id: row.hauler_id, category: row.category, type: row.type,
      linked_coaching_id: row.linked_coaching_id ?? null,
    },
  });

  res.json({ incident: overlayToEvent(row) });
});

// ── Phase 116 — Weighbridge hold write path ───────────────────────
//
// POST /api/compliance/weighbridge
//
// Log a live weighbridge hold or overload event. axis_admin and
// axis_ops only — this is a corridor-level record, not per-hauler.
//
// Required: plate, gross_weight_t
// Optional: rig_id, hauler_id, limit_t (default 60T GVW), hold_minutes,
//           weighbridge (name/location), notes

router.post('/weighbridge', requireRole(...WB_WRITE_ROLES), (req, res) => {
  const { plate, gross_weight_t, rig_id, hauler_id, limit_t,
          hold_minutes, weighbridge, notes } = req.body || {};

  if (!plate || !String(plate).trim()) {
    return res.status(400).json({ error: 'plate is required' });
  }
  const grossNum = parseFloat(gross_weight_t);
  if (!gross_weight_t || Number.isNaN(grossNum) || grossNum <= 0) {
    return res.status(400).json({ error: 'gross_weight_t must be a positive number' });
  }
  if (limit_t !== undefined) {
    const lim = parseFloat(limit_t);
    if (Number.isNaN(lim) || lim <= 0) {
      return res.status(400).json({ error: 'limit_t must be a positive number' });
    }
  }
  if (hold_minutes !== undefined && hold_minutes !== null) {
    const hm = parseInt(hold_minutes, 10);
    if (Number.isNaN(hm) || hm < 0) {
      return res.status(400).json({ error: 'hold_minutes must be a non-negative integer' });
    }
  }

  // Attempt to look up the rig from the fleet mock if plate is known.
  let resolvedRigId   = rig_id ?? null;
  let resolvedHaulerId = hauler_id ?? null;
  if (!resolvedRigId) {
    const truck = FLEET.find((t) => t.plate === plate.trim().toUpperCase());
    if (truck) {
      resolvedRigId    = truck.id;
      resolvedHaulerId = resolvedHaulerId ?? truck.hauler_id;
    }
  }

  const event = weighbridgeEvents.add({
    rig_id:         resolvedRigId,
    plate:          plate.trim().toUpperCase(),
    hauler_id:      resolvedHaulerId,
    gross_weight_t: grossNum,
    limit_t:        limit_t != null ? parseFloat(limit_t) : 60,
    hold_minutes:   hold_minutes != null ? parseInt(hold_minutes, 10) : null,
    weighbridge:    weighbridge ? String(weighbridge).trim() : null,
    notes:          notes ? String(notes).trim() : null,
    logged_by_id:   req.user.id,
    logged_by_name: req.user.display_name,
  });

  writeAudit({
    req,
    entity_type: 'compliance',
    entity_id:   String(event.id),
    action:      'weighbridge_hold',
    summary:     `${event.plate} — ${event.gross_weight_t} t GVW (+${event.overage_t} t over limit)${event.hold_minutes != null ? ` · ${event.hold_minutes} min hold` : ''}`,
  });

  res.status(201).json({ event });
});

module.exports = router;
