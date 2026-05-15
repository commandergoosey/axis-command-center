'use strict';

/*
 * GET /api/maintenance — four buckets derived from the fleet roster:
 *   in_workshop              — status === 'garage'
 *   service_due              — maintenance_flag === 'service_due'
 *   road_worthy_expiring_30d — maintenance_flag === 'road_worthy_30d'
 *   recent_completions       — synthetic last-10 services completed in 30d
 *
 * Hauler-admin scope is applied identically to /api/fleet so operators
 * only see their own rigs.
 */

const express = require('express');
const router = express.Router();

const { FLEET } = require('../mock/fleet');
const { DRIVERS } = require('../mock/drivers');
const { ALERTS }  = require('../mock/alerts');
const workorderState = require('../state/workorderState');
const maintenanceSchedule = require('../state/maintenanceSchedule');
const { writeAudit } = require('../db/audit');
const { requireAuth, requireRole } = require('../middleware/auth');

const SCHEDULE_WRITE_ROLES = ['axis_admin', 'axis_ops', 'hauler_admin'];

function scopedFleet(req) {
  const user = req.user;
  if (user?.role === 'hauler_admin' && user.hauler_id) {
    return FLEET.filter((t) => t.hauler_id === user.hauler_id);
  }
  return FLEET;
}

// Synthetic recent services — deterministic per truck id so the list
// doesn't flicker between requests.
function recentCompletions(rows) {
  const seedable = rows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 18);
  const now = Date.now();
  return seedable.map((t, i) => {
    const daysAgo = (i * 2 + (parseInt(t.id.slice(-4), 10) % 5)) % 28 + 1;
    return {
      rig_id:       t.id,
      plate:        t.plate,
      hauler_id:    t.hauler_id,
      hauler_display: t.hauler_display,
      service_type: i % 3 === 0 ? 'Axle service · 40,000 km' : i % 3 === 1 ? 'Brake overhaul' : 'Full service + filters',
      workshop:     i % 2 === 0 ? 'Takoradi depot workshop' : 'Kumasi service partner',
      completed_at: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      cost_usd:     i % 3 === 0 ? 1850 : i % 3 === 1 ? 2400 : 3200,
    };
  }).slice(0, 10);
}

router.get('/', (req, res) => {
  const rows = scopedFleet(req);
  const inWorkshop = rows.filter((t) => t.status === 'garage');
  const serviceDue = rows.filter((t) => t.maintenance_flag === 'service_due');
  const roadWorthy = rows
    .filter((t) => t.maintenance_flag === 'road_worthy_30d')
    .sort((a, b) => a.road_worthy_expiry_days - b.road_worthy_expiry_days);
  const critical   = rows.filter((t) => t.maintenance_flag === 'critical');

  // Annotate rigs with any active workorder so the client can show
  // an "in remediation" badge without a second round-trip.
  const remediating = workorderState.rigsInRemediation();
  const decorate = (r) => ({
    ...r,
    active_workorder: remediating.has(r.id)
      ? workorderState.openForRig(r.id)[0] ?? null
      : null,
  });

  const criticalDecorated = critical.map(decorate);
  const criticalUnremediated = criticalDecorated.filter((r) => !r.active_workorder);

  // Phase 175 — 8-week maintenance cost trend (MODELLED).
  // Proxy: each rig-week in workshop = ~$380 labour + $120 overhead.
  // Parts cost is seeded separately. Current week uses live counters;
  // prior 7 weeks are seeded for demo stability.
  function seededMaint(n) {
    const raw = Math.sin(n * 5479 + 43) * 91_013;
    return raw - Math.floor(raw);
  }
  const WORKSHOP_DAILY_USD = 380 + 120;  // labour + overhead per rig-day
  const now = new Date();
  const cost_trend = [];
  for (let w = 7; w >= 0; w--) {
    const weekMs = Date.now() - w * 7 * 86_400_000;
    const monday = new Date(weekMs);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const label = monday.toISOString().slice(0, 10);
    const wk    = Math.round(weekMs / (7 * 86_400_000));
    const rigs  = w === 0
      ? inWorkshop.length + Math.round(serviceDue.length * 0.3) // live
      : Math.round(2 + seededMaint(wk) * 5);                    // seeded
    const workshop_usd = Math.round(rigs * 5 * WORKSHOP_DAILY_USD);     // ~5 days avg stay
    const parts_usd    = Math.round(800 + seededMaint(wk + 200) * 3_200);
    cost_trend.push({
      week:         label,
      workshop_usd,
      parts_usd,
      total_usd:    workshop_usd + parts_usd,
      rigs_in_shop: rigs,
      is_current:   w === 0,
      modelled:     true,
    });
  }

  res.json({
    generated_at: new Date().toISOString(),
    counters: {
      in_workshop: inWorkshop.length,
      service_due: serviceDue.length,
      road_worthy_expiring_30d: roadWorthy.length,
      critical: critical.length,
      critical_remediating: critical.length - criticalUnremediated.length,
      critical_unremediated: criticalUnremediated.length,
    },
    in_workshop: inWorkshop.map(decorate),
    service_due: serviceDue.map(decorate),
    road_worthy_expiring_30d: roadWorthy.map(decorate),
    critical: criticalDecorated,
    recent_completions: recentCompletions(rows),
    cost_trend,
  });
});

// ── Workorder detail ──────────────────────────────────────────────
//   GET /api/maintenance/:rigId — per-rig workorder lifecycle: rig spec +
//   current flag, service history (last 4 workorders synthesised
//   deterministically from rig id), open defects (only when the rig is
//   in garage or flagged), parts on order (garage only), assigned
//   driver, and cross-linked alerts (road-worthy / licence / axle-load
//   breach that reference the plate, rig_id, or the hauler).
router.get('/:rigId', (req, res, next) => {
  // Reserved sub-paths (registered later in the file) — let
  // express fall through so the right handler claims them.
  if (req.params.rigId === 'schedule' || req.params.rigId === 'workorders') {
    return next();
  }
  const rig = FLEET.find((t) => t.id === req.params.rigId);
  if (!rig) return res.status(404).json({ error: 'Rig not found' });

  // Hauler-admin scope
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id
   && rig.hauler_id !== req.user.hauler_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const primaryDriver = DRIVERS.find((d) => d.assigned_rig_id === rig.id) ?? null;

  const history    = buildHistory(rig);
  const openDefects = buildOpenDefects(rig);
  const partsOnOrder = rig.status === 'garage' ? buildPartsOnOrder(rig) : [];

  const related = ALERTS
    .filter((a) => (
      a.asset_ref === rig.plate ||
      a.asset_ref === rig.id ||
      (a.hauler_id === rig.hauler_id && a.status !== 'RESOLVED'
        && ['axle_load_breach', 'payload_variance', 'licence_expiry', 'hse_event'].includes(a.type))
    ))
    .map((a) => ({
      id: a.id, severity: a.severity, type: a.type,
      title: a.title, status: a.status, opened_at: a.opened_at,
    }));

  const workorders = workorderState.forRig(rig.id);
  const activeWorkorder = workorders.find((w) => w.status !== 'RESOLVED') || null;

  res.json({
    ...rig,
    primary_driver: primaryDriver ? {
      id:            primaryDriver.id,
      display_name:  primaryDriver.full_name,
      phone:         primaryDriver.phone,
      licence_class: primaryDriver.licence_class,
      rest_status:   primaryDriver.rest_status,
    } : null,
    history,
    open_defects:    openDefects,
    parts_on_order:  partsOnOrder,
    related_alerts:  related,
    workorders,
    active_workorder: activeWorkorder,
  });
});

// ── Workorder writes ──────────────────────────────────────────────
// Scope: axis_ops / axis_admin, and hauler_admin scoped to their own
// hauler. A rig can only have one non-RESOLVED workorder at a time —
// guarding against accidental double-opens.
function canWriteForRig(user, rig) {
  if (!user) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops') return true;
  if (user.role === 'hauler_admin') return rig.hauler_id === user.hauler_id;
  return false;
}

function loadRigAndAuthorise(req, res) {
  const rig = FLEET.find((t) => t.id === req.params.rigId);
  if (!rig) { res.status(404).json({ error: 'Rig not found' }); return null; }
  if (!canWriteForRig(req.user, rig)) {
    res.status(403).json({ error: 'You cannot write workorders for this rig' });
    return null;
  }
  return rig;
}

function loadWorkorderAndAuthorise(req, res) {
  const wo = workorderState.findById(req.params.id);
  if (!wo) { res.status(404).json({ error: 'Workorder not found' }); return null; }
  const rig = FLEET.find((t) => t.id === wo.rig_id);
  if (!rig || !canWriteForRig(req.user, rig)) {
    res.status(403).json({ error: 'You cannot write this workorder' });
    return null;
  }
  return { wo, rig };
}

router.post('/:rigId/workorders', requireAuth, express.json(), (req, res) => {
  const rig = loadRigAndAuthorise(req, res); if (!rig) return;

  const existing = workorderState.openForRig(rig.id);
  if (existing.length > 0) {
    return res.status(409).json({
      error: 'Rig already has an active workorder',
      workorder: existing[0],
    });
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'title is required' });

  const wo = workorderState.open({
    rig_id: rig.id,
    hauler_id: rig.hauler_id,
    title,
    opened_by_user_id: req.user.id,
    opened_by_display: `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`,
  });

  writeAudit({
    req,
    entity_type: 'workorder',
    entity_id:   wo.id,
    action:      'open',
    summary:     `Opened workorder on ${rig.plate} (${rig.id}) · ${title}`,
    payload:     { rig_id: rig.id, plate: rig.plate, hauler_id: rig.hauler_id, title },
  });

  res.status(201).json(wo);
});

router.post('/workorders/:id/progress', requireAuth, express.json(), (req, res) => {
  const loaded = loadWorkorderAndAuthorise(req, res); if (!loaded) return;
  const { wo, rig } = loaded;
  if (wo.status === 'RESOLVED') {
    return res.status(400).json({ error: 'Workorder is already resolved' });
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const updated = workorderState.progress(wo.id, {
    note: note || null,
    by_display: `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`,
  });
  writeAudit({
    req,
    entity_type: 'workorder',
    entity_id:   wo.id,
    action:      'progress',
    summary:     `Workorder on ${rig.plate} moved to IN_PROGRESS`,
    payload:     note ? { note } : null,
  });
  res.json(updated);
});

router.post('/workorders/:id/resolve', requireAuth, express.json(), (req, res) => {
  const loaded = loadWorkorderAndAuthorise(req, res); if (!loaded) return;
  const { wo, rig } = loaded;
  if (wo.status === 'RESOLVED') {
    return res.status(400).json({ error: 'Workorder is already resolved' });
  }
  const note = typeof req.body?.resolution_note === 'string' ? req.body.resolution_note.trim() : '';
  if (!note) return res.status(400).json({ error: 'resolution_note is required' });
  const cost_usd = Number.isFinite(+req.body?.cost_usd) ? +req.body.cost_usd : null;
  const hours    = Number.isFinite(+req.body?.hours)    ? +req.body.hours    : null;

  const updated = workorderState.resolve(wo.id, {
    note,
    by_display: `${req.user.organisation ?? 'AXIS'} · ${req.user.display_name}`,
    cost_usd,
    hours,
  });
  writeAudit({
    req,
    entity_type: 'workorder',
    entity_id:   wo.id,
    action:      'resolve',
    summary:     `Resolved workorder on ${rig.plate} (${rig.id})`,
    payload:     { resolution_note: note, cost_usd, hours },
  });
  res.json(updated);
});

router.get('/workorders/list', (req, res) => {
  // Hauler-admin scope mirrors the /api/maintenance scope rules.
  let rows = workorderState.all();
  if (req.user?.role === 'hauler_admin' && req.user.hauler_id) {
    rows = rows.filter((w) => w.hauler_id === req.user.hauler_id);
  }
  res.json({ generated_at: new Date().toISOString(), workorders: rows });
});

// ── Helpers ────────────────────────────────────────────────────────

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildHistory(rig) {
  // Four prior workorders, stepping back in 20,000 km service intervals
  // from last_service_km. Alternate service types for realism.
  const SERVICE_TYPES = [
    { type: 'Full service + filters', workshop: 'Takoradi depot workshop', cost: 3200 },
    { type: 'Axle service',           workshop: 'Kumasi service partner',  cost: 1850 },
    { type: 'Brake overhaul',         workshop: 'Takoradi depot workshop', cost: 2400 },
    { type: 'Tyre rotation + DVLA',   workshop: 'Nyinahin yard workshop',  cost: 1100 },
  ];
  const seed = hashOf(rig.id);
  const now = Date.now();
  const history = [];
  for (let i = 0; i < 4; i += 1) {
    const spec = SERVICE_TYPES[(seed + i) % SERVICE_TYPES.length];
    const km = rig.last_service_km - i * 20_000;
    if (km < 2_000) break;
    const daysAgo = 14 + i * 62 + (seed % 9);       // ~2w, 2m, 4m, 6m
    history.push({
      id:           `wo-${rig.id}-${i}`,
      km_at_service: km,
      service_type: spec.type,
      workshop:     spec.workshop,
      completed_at: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      cost_usd:     spec.cost,
      notes:        i === 0 ? 'Signed off for return to line.' : null,
    });
  }
  return history;
}

function buildOpenDefects(rig) {
  const defects = [];
  if (rig.maintenance_flag === 'critical') {
    defects.push({
      id:       `def-${rig.id}-1`,
      opened_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      severity: 'CRITICAL',
      system:   'Axle',
      title:    'Rear bogie bearing play outside tolerance',
      reported_by: 'Pre-departure check · Takoradi depot',
    });
  }
  if (rig.maintenance_flag === 'service_due' || rig.km_since_service > 20000) {
    defects.push({
      id:       `def-${rig.id}-2`,
      opened_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      severity: 'WARNING',
      system:   'Schedule',
      title:    `20,000 km service interval crossed · ${(rig.km_since_service - 20000).toLocaleString()} km over`,
      reported_by: 'Preventive-maintenance rule',
    });
  }
  if (rig.maintenance_flag === 'road_worthy_30d') {
    defects.push({
      id:       `def-${rig.id}-3`,
      opened_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      severity: rig.road_worthy_expiry_days <= 7 ? 'CRITICAL' : 'WARNING',
      system:   'DVLA compliance',
      title:    `Road-worthy certificate expires in ${rig.road_worthy_expiry_days} days`,
      reported_by: 'Compliance calendar',
    });
  }
  return defects;
}

function buildPartsOnOrder(rig) {
  // Deterministic parts list for rigs in garage.
  const PARTS_BY_FLAG = {
    critical: [
      { part: 'Rear bogie bearing kit',   qty: 1, eta_days: 3, supplier: 'Sinotruk Ghana' },
      { part: 'Propshaft UJ × 2',         qty: 2, eta_days: 2, supplier: 'Kumasi parts partner' },
    ],
    service_due: [
      { part: 'Oil filter · primary',     qty: 1, eta_days: 0, supplier: 'Takoradi depot stock' },
      { part: 'Fuel filter',              qty: 2, eta_days: 0, supplier: 'Takoradi depot stock' },
    ],
    road_worthy_30d: [
      { part: 'Brake pad set · front',    qty: 1, eta_days: 1, supplier: 'Kumasi parts partner' },
    ],
  };
  const base = PARTS_BY_FLAG[rig.maintenance_flag] ?? [
    { part: 'Standard service kit',      qty: 1, eta_days: 1, supplier: 'Takoradi depot stock' },
  ];
  const seed = hashOf(rig.id);
  return base.map((p, i) => ({
    id:      `po-${rig.id}-${i}`,
    ...p,
    po_ref:  `PO-${String(10000 + ((seed + i) % 9000)).padStart(5, '0')}`,
  }));
}

// ── Phase 84 — Planned maintenance schedule ──────────────────────
//
// Forward-looking complement to workorders. Operators schedule
// planned workshop windows per rig; the calendar feed (Phase 73)
// surfaces them; the per-hauler workshop-capacity strip on the
// /maintenance page shows the count of rigs in workshop today.
//
// Read open to all roles; write restricted to operator-side
// (axis_admin / axis_ops) plus hauler_admin for their own rigs.
function canScheduleForRig(req, rig_id) {
  const user = req.user;
  if (!user) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops') return true;
  if (user.role === 'hauler_admin' && user.hauler_id) {
    const rig = FLEET.find((t) => t.id === rig_id);
    return rig?.hauler_id === user.hauler_id;
  }
  return false;
}

router.get('/schedule', requireAuth, (req, res) => {
  let rows = maintenanceSchedule.upcoming();
  // Hauler-admin scope: own hauler only.
  if (req.user.role === 'hauler_admin' && req.user.hauler_id) {
    rows = rows.filter((r) => r.hauler_id === req.user.hauler_id);
  }
  res.json({
    schedule: rows,
    counts_by_hauler_today: maintenanceSchedule.countsInWindow(),
  });
});

router.post('/schedule', requireRole(...SCHEDULE_WRITE_ROLES), (req, res) => {
  const { rig_id, hauler_id, type, start_at, end_at, notes } = req.body ?? {};
  if (!canScheduleForRig(req, rig_id)) {
    return res.status(403).json({ error: 'Not permitted to schedule for this rig' });
  }
  try {
    const w = maintenanceSchedule.add({
      rig_id, hauler_id, type, start_at, end_at, notes,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'maintenance_schedule',
      entity_id:   String(w.id),
      action:      'create',
      summary:     `Scheduled ${w.type} for ${w.rig_id}: ${w.start_at.slice(0, 10)} → ${w.end_at.slice(0, 10)}`,
      payload:     { rig_id: w.rig_id, hauler_id: w.hauler_id, type: w.type },
    });
    res.json({ scheduled: w });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/schedule/:id', requireRole(...SCHEDULE_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = maintenanceSchedule.findById(id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });
  if (!canScheduleForRig(req, existing.rig_id)) return res.status(403).json({ error: 'Not permitted' });
  try {
    const w = maintenanceSchedule.update(id, req.body || {});
    writeAudit({
      req,
      entity_type: 'maintenance_schedule',
      entity_id:   String(id),
      action:      'update',
      summary:     `Updated maintenance window for ${w.rig_id}`,
    });
    res.json({ scheduled: w });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/schedule/:id/complete', requireRole(...SCHEDULE_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = maintenanceSchedule.findById(id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });
  if (!canScheduleForRig(req, existing.rig_id)) return res.status(403).json({ error: 'Not permitted' });
  const w = maintenanceSchedule.complete(id, req.user.display_name);
  writeAudit({
    req,
    entity_type: 'maintenance_schedule',
    entity_id:   String(id),
    action:      'complete',
    summary:     `Completed maintenance for ${w.rig_id}`,
  });
  res.json({ scheduled: w });
});

router.post('/schedule/:id/cancel', requireRole(...SCHEDULE_WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = maintenanceSchedule.findById(id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });
  if (!canScheduleForRig(req, existing.rig_id)) return res.status(403).json({ error: 'Not permitted' });
  const w = maintenanceSchedule.cancel(id);
  writeAudit({
    req,
    entity_type: 'maintenance_schedule',
    entity_id:   String(id),
    action:      'cancel',
    summary:     `Cancelled maintenance for ${w.rig_id}`,
  });
  res.json({ scheduled: w });
});

module.exports = router;
