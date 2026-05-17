'use strict';

/*
 * GET   /api/drivers               — roster across all haulers (filterable)
 * GET   /api/drivers/summary       — counters for the summary strip
 * GET   /api/drivers/leaderboard   — Phase 94 corridor ranking (safety, trips, hours)
 * GET   /api/drivers/:id           — single driver, for the rig-detail drawer
 * PATCH /api/drivers/:id/status    — set availability + rest_status + flag (Phase 103)
 *
 * Hauler admins are auto-scoped to their own hauler_id; any hauler_id
 * query they send is ignored.
 */

const express = require('express');
const router = express.Router();

const driverStore = require('../state/driverStore');
const fleetStore  = require('../state/fleetStore');
const { TRIPS }   = require('../mock/trips');
const { ALERTS }  = require('../mock/alerts');
const coachingState      = require('../state/coachingState');
const roster             = require('../state/roster');
const rigAssignments     = require('../state/rigAssignments');
const driverLeaderboard  = require('../services/driverLeaderboard');
const driverStatus       = require('../state/driverStatus');
const { requireRole }    = require('../middleware/auth');
const { writeAudit }     = require('../db/audit');

const STATUS_WRITE_ROLES = ['axis_admin', 'axis_ops', 'hauler_admin'];

function scoped(req) {
  const user = req.user;
  if (user?.role === 'hauler_admin' && user.hauler_id) {
    return driverStore.list({ hauler_id: user.hauler_id });
  }
  const filter = req.query.hauler_id;
  if (typeof filter === 'string' && filter) return driverStore.list({ hauler_id: filter });
  return driverStore.list();
}

/** Merge the status-override layer onto a list of mock driver records. */
function withOverrides(drivers) {
  const overrides = driverStatus.getAllOverrides();
  if (overrides.size === 0) return drivers.map((d) => driverStatus.applyOverride(d, null));
  return drivers.map((d) => driverStatus.applyOverride(d, overrides.get(d.id)));
}

router.get('/', (req, res) => {
  const rows = withOverrides(scoped(req));

  // Phase 185 — licence expiry pipeline. Buckets all visible drivers by
  // months until licence expiry and PSV endorsement expiry so ops can see
  // the upcoming compliance cliff without opening each driver drawer.
  const LICENCE_BUCKETS = [
    { key: 'critical', label: '≤ 2 mo',  min: -Infinity, max: 2  },
    { key: 'warning',  label: '3–6 mo',  min: 3,         max: 6  },
    { key: 'watch',    label: '7–12 mo', min: 7,         max: 12 },
    { key: 'clear',    label: '12+ mo',  min: 13,        max: Infinity },
  ];
  const licenceCounts = Object.fromEntries(LICENCE_BUCKETS.map((b) => [b.key, 0]));
  rows.forEach((d) => {
    const months = d.licence_expiry_months ?? 999;
    const bucket = LICENCE_BUCKETS.find((b) => months >= b.min && months <= b.max);
    if (bucket) licenceCounts[bucket.key]++;
  });
  const psv_expiring_30d = rows.filter((d) => (d.psv_expiry_days ?? 999) <= 30).length;
  const psv_expiring_60d = rows.filter((d) => (d.psv_expiry_days ?? 999) <= 60).length;

  // Per-hauler: group counts by hauler_id for per-hauler drill-down.
  const haulerLicenceMap = {};
  rows.forEach((d) => {
    if (!haulerLicenceMap[d.hauler_id]) {
      haulerLicenceMap[d.hauler_id] = {
        hauler_id: d.hauler_id,
        hauler_display: d.hauler_display ?? d.hauler_id,
        critical: 0, warning: 0, watch: 0, clear: 0, total: 0,
      };
    }
    const h = haulerLicenceMap[d.hauler_id];
    h.total++;
    const months = d.licence_expiry_months ?? 999;
    const bucket = LICENCE_BUCKETS.find((b) => months >= b.min && months <= b.max);
    if (bucket) h[bucket.key]++;
  });

  const licence_pipeline = {
    buckets: LICENCE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: licenceCounts[b.key] })),
    psv_expiring_30d,
    psv_expiring_60d,
    by_hauler: Object.values(haulerLicenceMap).sort((a, b) => b.critical - a.critical || b.warning - a.warning),
  };

  // Phase 195 — safety score distribution histogram.
  // Buckets all visible drivers by safety_score in 5-point bands so ops
  // can see where the fleet sits on the score curve at a glance.
  const SAFETY_BANDS = [
    { band: '65–69', min: 65, max: 69 },
    { band: '70–74', min: 70, max: 74 },
    { band: '75–79', min: 75, max: 79 },
    { band: '80–84', min: 80, max: 84 },
    { band: '85–89', min: 85, max: 89 },
    { band: '90–94', min: 90, max: 94 },
    { band: '95–100', min: 95, max: 100 },
  ];
  const bandCounts = Object.fromEntries(SAFETY_BANDS.map((b) => [b.band, 0]));
  rows.forEach((d) => {
    const score = d.safety_score ?? 0;
    const band = SAFETY_BANDS.find((b) => score >= b.min && score <= b.max);
    if (band) bandCounts[band.band]++;
  });
  const safety_distribution = SAFETY_BANDS.map((b) => ({
    band:  b.band,
    count: bandCounts[b.band],
    tone:  b.min < 75 ? 'critical' : b.min < 85 ? 'warning' : 'ok',
  }));

  // Phase 211 — rest status breakdown by hauler.
  // Shows compliant/warning/breach counts per hauler so ops can spot
  // which haulers have the worst rest-compliance posture this week.
  const restByHaulerMap = {};
  rows.forEach((d) => {
    if (!restByHaulerMap[d.hauler_id]) {
      restByHaulerMap[d.hauler_id] = {
        hauler_id:      d.hauler_id,
        hauler_display: d.hauler_display ?? d.hauler_id,
        compliant: 0, warning: 0, breach: 0, total: 0,
      };
    }
    const h  = restByHaulerMap[d.hauler_id];
    const rs = d.rest_status ?? 'compliant';
    h.total++;
    if (rs === 'breach') h.breach++;
    else if (rs === 'warning') h.warning++;
    else h.compliant++;
  });
  const rest_by_hauler = Object.values(restByHaulerMap)
    .sort((a, b) => b.breach - a.breach || b.warning - a.warning);

  res.json({
    generated_at: new Date().toISOString(),
    total: rows.length,
    drivers: rows,
    licence_pipeline,
    safety_distribution,
    rest_by_hauler,
  });
});

router.get('/summary', (req, res) => {
  const rows = withOverrides(scoped(req));
  const assigned = rows.filter((d) => d.assigned_rig_id).length;
  const breach   = rows.filter((d) => d.rest_status === 'breach').length;
  const warning  = rows.filter((d) => d.rest_status === 'warning').length;
  const flagged  = rows.filter((d) => d.flag).length;
  const avgSafety = rows.length
    ? Math.round((rows.reduce((s, d) => s + d.safety_score, 0) / rows.length) * 10) / 10
    : 0;
  res.json({
    generated_at: new Date().toISOString(),
    total: rows.length,
    assigned_primary: assigned,
    relief_pool: rows.length - assigned,
    rest_breach: breach,
    rest_warning: warning,
    coaching_flagged: flagged,
    avg_safety_score: avgSafety,
  });
});

// ── Phase 94 — Driver Leaderboard ────────────────────────────────
//
// Corridor ranking across three weekly dimensions: safety score,
// trips completed, hours on duty. A composite score (equal-weight
// normalised mean) drives the full-table sort.
//
// hauler_id query param scopes the ranking to one hauler.
// hauler_admin is auto-scoped to their own hauler_id.
// All authenticated non-lender roles can read.
router.get('/leaderboard', (req, res) => {
  const user = req.user;
  let haulerFilter = req.query.hauler_id || null;
  // Scope hauler_admin to their own fleet regardless of query param.
  if (user?.role === 'hauler_admin' && user.hauler_id) {
    haulerFilter = user.hauler_id;
  }
  res.json(driverLeaderboard.compose(haulerFilter));
});

// Lookup used by the rig-detail drawer — "who's on this truck?"
// Phase 110: checks live (operator-set) assignment first; falls back to mock.
router.get('/by-rig/:rigId', (req, res) => {
  const { rigId } = req.params;

  // Live assignment takes priority over the mock assigned_rig_id.
  const liveAssignment = rigAssignments.getAssignment(rigId);
  if (liveAssignment) {
    const rows   = scoped(req);
    const driver = rows.find((d) => d.id === liveAssignment.driver_id);
    if (driver) {
      // Merge status override so the drawer reflects any operator flags.
      const override = driverStatus.getOverride(driver.id);
      const merged   = driverStatus.applyOverride(driver, override);
      return res.json({ primary: merged, live_assignment: true, assignment_meta: liveAssignment });
    }
    // Driver not visible to this caller (scope mismatch) — fall through to mock.
  }

  // Mock fallback.
  const rows    = scoped(req);
  const primary = rows.find((d) => d.assigned_rig_id === rigId) ?? null;
  res.json({ primary, live_assignment: false });
});

// ── Driver detail ─────────────────────────────────────────────────
//   GET /api/drivers/:id — single driver with assigned rig, recent trips
//   attributed deterministically from the hauler's trip pool, licence /
//   PSV / medical / training certifications, 8-week safety trend, and any
//   open alerts that reference this driver by licence number, asset_ref,
//   or hauler-scoped licence_expiry / hse_event.
router.get('/:id', (req, res) => {
  const rows = scoped(req);
  const driver = rows.find((d) => d.id === req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  const rig = driver.assigned_rig_id
    ? fleetStore.findById(driver.assigned_rig_id)
    : null;

  const seed = hashOf(driver.id);

  // Recent trips: deterministically attribute ~6 trips from this driver's
  // hauler to this driver. Trip fixtures don't carry driver_id, so we seed
  // on (trip.id + driver.id) and take the lowest-sorted N — stable per driver.
  const haulerTrips = TRIPS.filter((t) => t.hauler_id === driver.hauler_id);
  const recentTrips = haulerTrips
    .map((t) => ({ trip: t, rank: hashOf(t.id + driver.id) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 6)
    .map(({ trip }) => ({
      id:           trip.id,
      route_id:     trip.route_id,
      direction:    trip.direction,
      departed_at:  trip.departed_at,
      cycle_h:      trip.cycle_h,
      tonnage_t:    trip.tonnage_t,
      delay_min:    trip.delay_min,
      status:       trip.status,
      cost_total_usd: trip.cost.total_usd,
    }))
    .sort((a, b) => new Date(b.departed_at) - new Date(a.departed_at));

  const licence = {
    number:      driver.licence_number,
    class:       driver.licence_class,
    expiry_iso:  driver.licence_expiry_iso,
    months_to_expiry: driver.licence_expiry_months,
    tone:        driver.licence_expiry_months <= 2 ? 'critical'
               : driver.licence_expiry_months <= 6 ? 'warning'
               : 'ok',
  };

  const today = Date.now();
  const psv = {
    days_to_expiry: driver.psv_expiry_days,
    expiry_iso:     new Date(today + driver.psv_expiry_days * 24 * 60 * 60 * 1000).toISOString(),
    tone:           driver.psv_expiry_days <= 30 ? 'critical'
                  : driver.psv_expiry_days <= 60 ? 'warning'
                  : 'ok',
  };

  // Medical + training are synthesised deterministically per driver.
  const medicalDays = 45 + (seed % 320);
  const medical = {
    days_to_expiry: medicalDays,
    expiry_iso:     new Date(today + medicalDays * 24 * 60 * 60 * 1000).toISOString(),
    tone:           medicalDays <= 30 ? 'critical' : medicalDays <= 90 ? 'warning' : 'ok',
  };

  const training = buildTraining(driver, seed);
  const safety_series = buildSafetySeries(driver, seed);
  const open_alerts = buildOpenAlerts(driver);

  // Phase 54 — coaching attendance for the last 90 days. Sessions in
  // the overlay where this driver is an attendee. Most-recent first.
  const coaching_history = coachingState.recentForDriver(driver.id, 90)
    .sort((a, b) => (a.held_at < b.held_at ? 1 : -1))
    .slice(0, 10)
    .map((s) => ({
      id:                  s.id,
      held_at:             s.held_at,
      topic:               s.topic,
      dispatcher_name:     s.dispatcher_name,
      attendees_count:     s.attendees_count,
      expected_delta_pct:  s.expected_delta_pct,
      created_by_display:  s.created_by_display,
      linked_alert_count:  Array.isArray(s.linked_alert_ids) ? s.linked_alert_ids.length : 0,
    }));

  // Merge status override so the dossier reflects operator overrides.
  const override = driverStatus.getOverride(driver.id);
  const merged   = driverStatus.applyOverride(driver, override);

  res.json({
    ...merged,
    assigned_rig: rig ? {
      id:     rig.id,
      plate:  rig.plate,
      make:   rig.make,
      model:  rig.model,
      status: rig.status,
      maintenance_flag: rig.maintenance_flag,
      total_km: rig.total_km,
    } : null,
    recent_trips:   recentTrips,
    licence,
    psv,
    medical,
    training,
    safety_series,
    open_alerts,
    coaching_history,
  });
});

// ── Phase 58 — Per-driver weekly scorecard ────────────────────────
//
// Mirrors the Phase 49 hauler scorecard but at driver granularity.
// Each driver-admin / dispatch can hand a driver their weekly card —
// safety score trajectory, hours vs rest cap, coaching attended,
// HSE incidents, trips run.
//
// Scope: axis_admin / axis_ops can pull any driver. hauler_admin
// scoped to drivers in their hauler. Lender excluded — driver
// performance is operational PII.
router.get('/:id/scorecard', (req, res) => {
  const driver = driverStore.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  if (req.user?.role === 'lender') {
    return res.status(403).json({ error: 'Driver scorecards are restricted for the lender persona' });
  }
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id !== driver.hauler_id) {
    return res.status(403).json({ error: 'Hauler admins can only view their own drivers' });
  }

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const weekOffset = Math.max(-12, Math.min(0, Number(req.query.week_offset) || 0));
  const now        = new Date();
  const periodEnd  = new Date(now.getTime() + weekOffset * 7 * ONE_DAY);
  const periodStart = new Date(periodEnd.getTime() - 7 * ONE_DAY);
  const periodStartIso = periodStart.toISOString();
  const periodEndIso   = periodEnd.toISOString();

  // Trips for this driver in window — TRIPS doesn't carry driver_id
  // directly so we infer via assigned rig (one driver, one rig at a
  // time on the corridor, except relief pool).
  const driverTrips = TRIPS.filter((t) =>
    t.hauler_id === driver.hauler_id
    && (driver.assigned_rig_id ? t.rig_id === driver.assigned_rig_id : false)
  );
  const weekTrips = driverTrips.filter((t) => {
    const ts = new Date(t.departed_at).getTime();
    return ts >= periodStart.getTime() && ts < periodEnd.getTime();
  });

  const tonnesWeek    = weekTrips.reduce((s, t) => s + (t.tonnage_t || 0), 0);
  const delayedWeek   = weekTrips.filter((t) => t.status === 'delayed').length;
  const onTimeWeekPct = weekTrips.length
    ? Math.round(((weekTrips.length - delayedWeek) / weekTrips.length) * 1000) / 10
    : null;

  // Coaching attended in window.
  const coaching = coachingState.recentForDriver(driver.id, 7, now)
    .map((c) => ({
      id:       c.id,
      held_at:  c.held_at,
      topic:    c.topic,
      dispatcher_name: c.dispatcher_name,
      expected_delta_pct: c.expected_delta_pct,
    }));

  // 8-week safety series (reuses the same deterministic synthesizer
  // the dossier uses, so the scorecard and dossier agree).
  const safety_series = buildSafetySeries(driver, hashOf(driver.id));
  const last4 = safety_series.slice(-4).map((p) => p.score);
  const safety_trend_delta = last4.length >= 2 ? Math.round((last4[last4.length - 1] - last4[0]) * 10) / 10 : 0;

  // Verdict — composite of rest status, safety score change, on-time.
  let verdict;
  if      (driver.rest_status === 'breach' || (onTimeWeekPct != null && onTimeWeekPct < 80)) verdict = 'attention';
  else if (driver.rest_status === 'warning' || safety_trend_delta < -3)                       verdict = 'watch';
  else if (driver.safety_score >= 90 && safety_trend_delta >= 0)                              verdict = 'top_tier';
  else                                                                                         verdict = 'in_band';

  res.json({
    generated_at: now.toISOString(),
    generated_by: req.user ? {
      display_name: req.user.display_name,
      role:         req.user.role,
      organisation: req.user.organisation,
    } : null,
    driver: {
      id:                  driver.id,
      full_name:           driver.full_name,
      hauler_id:           driver.hauler_id,
      hauler_display:      roster.list().find((h) => h.id === driver.hauler_id)?.display_name ?? driver.hauler_id,
      licence_number:      driver.licence_number,
      years_experience:    driver.years_experience,
      shift:               driver.shift,
      assigned_rig_id:     driver.assigned_rig_id,
      assigned_plate:      driver.assigned_plate,
      phone:               driver.phone,
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
      on_time_pct:  onTimeWeekPct,
      delayed:      delayedWeek,
      hours:        driver.hours_this_week,
      harsh_events: driver.harsh_events_7d,
    },
    safety: {
      score:           driver.safety_score,
      trend_delta:     safety_trend_delta,
      series:          safety_series,
      rest_status:     driver.rest_status,
    },
    coaching,
    verdict,
  });
});

// ── Phase 103 — driver status write ───────────────────────────────
//
// PATCH /api/drivers/:driverId/status
//
// Body: { availability, rest_status, flag (optional), notes (optional) }
//
// Role gate:
//   axis_admin / axis_ops — any driver
//   hauler_admin          — only drivers belonging to their own hauler_id

router.patch(
  '/:driverId/status',
  requireRole(...STATUS_WRITE_ROLES),
  (req, res) => {
    const { driverId } = req.params;

    const driver = driverStore.findById(driverId);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    // Hauler_admin scope: can only update their own hauler's drivers.
    if (req.user.role === 'hauler_admin' && driver.hauler_id !== req.user.hauler_id) {
      return res.status(403).json({ error: 'You can only update your own hauler\'s drivers' });
    }

    const { availability, rest_status, flag, notes } = req.body || {};

    try {
      const override = driverStatus.setStatus({
        driver_id:       driverId,
        availability,
        rest_status,
        flag:            flag !== undefined ? flag : null,
        notes,
        updated_by_id:   req.user.id,
        updated_by_name: req.user.display_name,
      });

      const updated = driverStatus.applyOverride(driver, override);

      writeAudit({
        req,
        entity_type: 'driver',
        entity_id:   driverId,
        action:      'status_update',
        summary:     `${driverId} (${driver.full_name}) → ${availability} / ${rest_status}${flag ? ` [${flag}]` : ''}${notes ? ` — ${notes.slice(0, 60)}` : ''}`,
      });

      res.json({ driver: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },
);

// ── Helpers ────────────────────────────────────────────────────────

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildTraining(driver, seed) {
  // Four standard certs on the GIBDLC corridor: defensive-driving (2y),
  // hazmat-awareness (3y), first-aid (2y), site-induction (1y). Issued date
  // staggered deterministically per driver so expiries spread naturally.
  const today = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const CERTS = [
    { code: 'def_drv',  label: 'Defensive driving',   valid_months: 24 },
    { code: 'hazmat',   label: 'Hazmat awareness',    valid_months: 36 },
    { code: 'first_aid',label: 'First aid',           valid_months: 24 },
    { code: 'site_ind', label: 'GIBDLC site induction', valid_months: 12 },
  ];
  return CERTS.map((c, i) => {
    const issuedMonthsAgo = (seed + i * 7) % c.valid_months;
    const expiresMonthsOut = c.valid_months - issuedMonthsAgo;
    const issuedIso  = new Date(today - issuedMonthsAgo * 30 * DAY).toISOString();
    const expiresIso = new Date(today + expiresMonthsOut * 30 * DAY).toISOString();
    const tone = expiresMonthsOut <= 1 ? 'critical'
               : expiresMonthsOut <= 3 ? 'warning'
               : 'ok';
    return {
      code:   c.code,
      label:  c.label,
      issued_iso:  issuedIso,
      expires_iso: expiresIso,
      months_to_expiry: expiresMonthsOut,
      tone,
    };
  });
}

function buildSafetySeries(driver, seed) {
  // 8-week trend leading to driver.safety_score. Walk backwards from the
  // current score with deterministic ±3 point jitter; clamp to 0..100.
  const points = [];
  let score = driver.safety_score;
  for (let i = 0; i < 8; i += 1) {
    points.push({ week_offset: -i, score });
    const delta = ((seed + i * 13) % 7) - 3; // -3..+3
    score = Math.max(55, Math.min(100, score - delta));
  }
  return points.reverse(); // oldest → newest
}

function buildOpenAlerts(driver) {
  return ALERTS
    .filter((a) => {
      if (a.status === 'RESOLVED') return false;
      if (a.asset_ref === driver.licence_number) return true;
      if (a.asset_ref === driver.full_name) return true;
      if (a.asset_ref && a.asset_ref.includes(driver.id)) return true;
      // Driver-scoped alert types that land on this driver's hauler &
      // resemble the driver's flag. Coarse but deterministic.
      if (a.hauler_id !== driver.hauler_id) return false;
      if (a.type === 'licence_expiry' && driver.flag === 'licence_expiring') return true;
      if (a.type === 'hse_event'      && driver.flag === 'coaching_due')     return true;
      return false;
    })
    .map((a) => ({
      id: a.id, severity: a.severity, type: a.type,
      title: a.title, status: a.status, opened_at: a.opened_at,
    }));
}

module.exports = router;
