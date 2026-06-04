'use strict';

/*
 * LP-2 — Admin user-management endpoints. All routes require axis_admin.
 * LP-3 — Fleet and driver CRUD endpoints added below.
 *
 * GET    /api/admin/users                     — full user list (inc. inactive)
 * POST   /api/admin/users                     — create new user
 * PATCH  /api/admin/users/:id                 — edit display_name / role / org / hauler_id
 * POST   /api/admin/users/:id/set-password    — admin force-sets any user's password
 * POST   /api/admin/users/:id/deactivate      — suspend account (blocks login)
 * POST   /api/admin/users/:id/reactivate      — restore account
 *
 * GET    /api/admin/haulers                    — list all haulers (inc. deactivated)
 * POST   /api/admin/haulers                    — create / onboard hauler
 * PATCH  /api/admin/haulers/:id               — edit any field on any hauler
 * POST   /api/admin/haulers/:id/deactivate    — suspend hauler (blocks from normal reads)
 * POST   /api/admin/haulers/:id/reactivate    — restore hauler
 *
 * GET    /api/admin/fleet                     — list all non-archived trucks
 * POST   /api/admin/fleet                     — create truck
 * PATCH  /api/admin/fleet/:id                 — update truck fields
 * POST   /api/admin/fleet/:id/archive         — soft-delete truck
 * POST   /api/admin/fleet/:id/unarchive       — restore truck
 *
 * GET    /api/admin/drivers                   — list all non-archived drivers
 * POST   /api/admin/drivers                   — create driver
 * PATCH  /api/admin/drivers/:id               — update driver fields
 * POST   /api/admin/drivers/:id/archive       — soft-delete driver
 * POST   /api/admin/drivers/:id/unarchive     — restore driver
 */

const express = require('express');
const router  = express.Router();

const crypto            = require('crypto');
const users             = require('../state/users');
const sessions          = require('../services/sessions');
const mailer            = require('../services/mailer');
const fleetStore        = require('../state/fleetStore');
const driverStore       = require('../state/driverStore');
const haulerStore       = require('../state/haulerStore');
const alertRulesStore   = require('../state/alertRulesStore');
const db                = require('../db');
const { requireRole }   = require('../middleware/auth');
const { writeAudit }    = require('../db/audit');

const VALID_ROLES = new Set(['axis_admin', 'axis_ops', 'hauler_admin', 'lender']);

/* All routes in this file are axis_admin only. */
router.use(requireRole('axis_admin'));

/* ── List all users ──────────────────────────────────────────────────── */
router.get('/users', (_req, res) => {
  res.json({ users: users.list() });
});

/* ── Create user ─────────────────────────────────────────────────────── */
router.post('/users', (req, res) => {
  const { email, password, display_name, role, organisation, hauler_id } = req.body || {};

  if (!email || !password || !display_name || !role) {
    return res.status(400).json({ error: 'email, password, display_name, and role are required' });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${[...VALID_ROLES].join(', ')}` });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (role === 'hauler_admin' && !hauler_id) {
    return res.status(400).json({ error: 'hauler_id is required for hauler_admin role' });
  }

  try {
    const created = users.create({ email, password, display_name, role, organisation, hauler_id });
    writeAudit({
      req,
      entity_type: 'user',
      entity_id:   created.id,
      action:      'create',
      summary:     `${req.user.display_name} created user ${email} (${role})`,
      payload:     { email, role, organisation, hauler_id },
    });

    // Send invite email (fire-and-forget — don't block the 201 response).
    const inviteToken = users.createResetToken(created.id);
    mailer.sendInvite(created, inviteToken).catch((err) => {
      console.error('[admin] Failed to send invite email:', err.message);
    });

    res.status(201).json({ user: created });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    throw err;
  }
});

/* ── Edit user ───────────────────────────────────────────────────────── */
router.patch('/users/:id', (req, res) => {
  const { id } = req.params;
  const { display_name, role, organisation, hauler_id } = req.body || {};

  if (role !== undefined && !VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${[...VALID_ROLES].join(', ')}` });
  }
  if (role === 'hauler_admin' && hauler_id === null) {
    return res.status(400).json({ error: 'hauler_id is required for hauler_admin role' });
  }

  const existing = users.findById(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const updated = users.update(id, { display_name, role, organisation, hauler_id });
  writeAudit({
    req,
    entity_type: 'user',
    entity_id:   id,
    action:      'update',
    summary:     `${req.user.display_name} updated user ${existing.email}`,
    payload:     { display_name, role, organisation, hauler_id },
  });
  res.json({ user: updated });
});

/* ── Admin force-set a user's password ──────────────────────────────── */
router.post('/users/:id/set-password', (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body || {};

  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'new_password must be at least 8 characters' });
  }

  const existing = users.findById(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  users.setPassword(id, new_password);
  // Force that user's sessions to expire so they must log in with new password.
  sessions.revokeAll(id);

  writeAudit({
    req,
    entity_type: 'user',
    entity_id:   id,
    action:      'admin_set_password',
    summary:     `${req.user.display_name} reset the password for ${existing.email}`,
  });
  res.json({ ok: true });
});

/* ── Deactivate ──────────────────────────────────────────────────────── */
router.post('/users/:id/deactivate', (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }

  const existing = users.findById(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (!existing.active) return res.status(400).json({ error: 'User is already inactive' });

  users.deactivate(id);
  sessions.revokeAll(id); // immediately force them out
  writeAudit({
    req,
    entity_type: 'user',
    entity_id:   id,
    action:      'deactivate',
    summary:     `${req.user.display_name} deactivated ${existing.email}`,
  });
  res.json({ ok: true });
});

/* ── Reactivate ──────────────────────────────────────────────────────── */
router.post('/users/:id/reactivate', (req, res) => {
  const { id } = req.params;

  const existing = users.findById(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.active) return res.status(400).json({ error: 'User is already active' });

  users.reactivate(id);
  writeAudit({
    req,
    entity_type: 'user',
    entity_id:   id,
    action:      'reactivate',
    summary:     `${req.user.display_name} reactivated ${existing.email}`,
  });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LP-4 — Hauler CRUD
 * ═══════════════════════════════════════════════════════════════════════════ */

const INTEGRATION_TYPES = new Set(['loconav', 'custom', 'manual', 'mqtt']);

/* ── List haulers ─────────────────────────────────────────────────────────── */
router.get('/haulers', (_req, res) => {
  res.json({ haulers: haulerStore.list({ include_deactivated: true }) });
});

/* ── Create / onboard hauler ─────────────────────────────────────────────── */
router.post('/haulers', (req, res) => {
  const { display_name, contracted_trucks, integration_type,
          contact_name, contact_email, contract_share_pct, planned_start_date } = req.body || {};

  if (!display_name?.trim()) {
    return res.status(400).json({ error: 'display_name is required' });
  }
  const trucks = Number(contracted_trucks);
  if (!Number.isInteger(trucks) || trucks < 0) {
    return res.status(400).json({ error: 'contracted_trucks must be a non-negative integer' });
  }
  const intType = integration_type ?? 'manual';
  if (!INTEGRATION_TYPES.has(intType)) {
    return res.status(400).json({ error: 'integration_type must be loconav, custom, manual, or mqtt' });
  }
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return res.status(400).json({ error: 'contact_email must be a valid email address' });
  }

  const id = haulerStore.nextId();
  const hauler = haulerStore.create({
    id,
    display_name:       display_name.trim(),
    onboarded_date:     new Date().toISOString().slice(0, 10),
    status:             'pending',
    integration:        { type: intType, adapter: null, last_sync: null, error_count_24h: intType === 'manual' ? null : 0 },
    fleet:              { contracted_trucks: trucks, active_trucks: 0 },
    performance:        { on_time_pct: 0, sla_attainment_pct: 0, safety_score: 0 },
    run_rate:           0,
    contact_name:       contact_name?.trim()  || null,
    contact_email:      contact_email?.trim() || null,
    contract_share_pct: contract_share_pct != null ? Number(contract_share_pct) : null,
    planned_start_date: planned_start_date || null,
  });

  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   id,
    action:      'create',
    summary:     `${req.user.display_name} created hauler ${hauler.display_name}`,
    payload:     req.body,
  });
  res.status(201).json({ hauler });
});

/* ── Update hauler ───────────────────────────────────────────────────────── */
router.patch('/haulers/:id', (req, res) => {
  const { id } = req.params;
  const existing = haulerStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Hauler not found' });

  const { display_name, contracted_trucks, integration_type,
          contact_name, contact_email, contract_share_pct, planned_start_date,
          status } = req.body || {};

  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return res.status(400).json({ error: 'contact_email must be a valid email address' });
  }
  if (integration_type && !INTEGRATION_TYPES.has(integration_type)) {
    return res.status(400).json({ error: 'integration_type must be loconav, custom, manual, or mqtt' });
  }

  const fields = {};
  if (display_name      != null) fields.display_name      = display_name.trim();
  if (contracted_trucks != null) fields.contracted_trucks = Number(contracted_trucks);
  if (integration_type  != null) fields.integration_type  = integration_type;
  if (status            != null) fields.status            = status;
  if ('contact_name'       in (req.body || {})) fields.contact_name       = contact_name?.trim()  ?? null;
  if ('contact_email'      in (req.body || {})) fields.contact_email      = contact_email?.trim() ?? null;
  if ('contract_share_pct' in (req.body || {})) fields.contract_share_pct = contract_share_pct != null ? Number(contract_share_pct) : null;
  if ('planned_start_date' in (req.body || {})) fields.planned_start_date = planned_start_date ?? null;

  const hauler = haulerStore.update(id, fields);
  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   id,
    action:      'update',
    summary:     `${req.user.display_name} updated hauler ${existing.display_name}`,
    payload:     fields,
  });
  res.json({ hauler });
});

/* ── Deactivate hauler ───────────────────────────────────────────────────── */
router.post('/haulers/:id/deactivate', (req, res) => {
  const { id } = req.params;
  const existing = haulerStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Hauler not found' });
  if (existing.deactivated) return res.status(400).json({ error: 'Hauler is already deactivated' });

  haulerStore.deactivate(id);
  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   id,
    action:      'deactivate',
    summary:     `${req.user.display_name} deactivated hauler ${existing.display_name}`,
  });
  res.json({ ok: true });
});

/* ── Reactivate hauler ───────────────────────────────────────────────────── */
router.post('/haulers/:id/reactivate', (req, res) => {
  const { id } = req.params;
  const existing = haulerStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Hauler not found' });
  if (!existing.deactivated) return res.status(400).json({ error: 'Hauler is not deactivated' });

  haulerStore.reactivate(id);
  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   id,
    action:      'reactivate',
    summary:     `${req.user.display_name} reactivated hauler ${existing.display_name}`,
  });
  res.json({ ok: true });
});

/* ── Webhook secret rotation — LP-7 ──────────────────────────────────────── */
router.post('/haulers/:id/webhook-secret', (req, res) => {
  const { id } = req.params;
  const existing = haulerStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Hauler not found' });

  const secret = crypto.randomBytes(32).toString('hex');
  haulerStore.update(id, { webhook_secret: secret });
  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   id,
    action:      'rotate_webhook_secret',
    summary:     `${req.user.display_name} rotated webhook secret for ${existing.display_name}`,
  });
  res.json({ ok: true, secret });
});

/* ── Hauler API token rotation — LP-51 ───────────────────────────────────── */
/*
 * POST /api/admin/haulers/:id/api-token
 *
 * Generates a new 64-character hex API token and stores it in haulers.api_token.
 * The plaintext token is returned exactly once — it cannot be recovered later.
 * Hauler integrations send this token as X-Hauler-Token on webhook requests
 * (verified by middleware/haulerTokenAuth.js, added in LP-36).
 *
 * Returns the current token if no_rotate=true is passed in the body (so admins
 * can check whether a token exists without triggering a rotation).
 */
router.post('/haulers/:id/api-token', (req, res) => {
  const { id } = req.params;
  const existing = haulerStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Hauler not found' });

  if (req.body?.no_rotate) {
    return res.json({ ok: true, has_token: Boolean(existing.api_token), rotated: false });
  }

  const token = crypto.randomBytes(32).toString('hex');
  haulerStore.update(id, { api_token: token });
  writeAudit({
    req,
    entity_type: 'hauler',
    entity_id:   id,
    action:      'rotate_api_token',
    summary:     `${req.user.display_name} rotated API token for ${existing.display_name}`,
  });
  res.json({ ok: true, token, rotated: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LP-3 — Fleet CRUD
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── List trucks ─────────────────────────────────────────────────────────── */
router.get('/fleet', (req, res) => {
  const hauler_id = req.query.hauler_id || null;
  const trucks = fleetStore.list({ hauler_id });
  res.json({ trucks });
});

/* ── Create truck ────────────────────────────────────────────────────────── */
router.post('/fleet', (req, res) => {
  const { plate, hauler_id } = req.body || {};
  if (!plate || !hauler_id) {
    return res.status(400).json({ error: 'plate and hauler_id are required' });
  }
  try {
    const truck = fleetStore.create(req.body);
    writeAudit({
      req,
      entity_type: 'fleet_truck',
      entity_id:   truck.id,
      action:      'create',
      summary:     `${req.user.display_name} created truck ${truck.plate} (${hauler_id})`,
      payload:     req.body,
    });
    res.status(201).json({ truck });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: `Plate ${plate.toUpperCase()} is already registered` });
    }
    throw err;
  }
});

/* ── Update truck ────────────────────────────────────────────────────────── */
router.patch('/fleet/:id', (req, res) => {
  const { id } = req.params;
  const existing = fleetStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Truck not found' });

  try {
    const truck = fleetStore.update(id, req.body);
    writeAudit({
      req,
      entity_type: 'fleet_truck',
      entity_id:   id,
      action:      'update',
      summary:     `${req.user.display_name} updated truck ${existing.plate}`,
      payload:     req.body,
    });
    res.json({ truck });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'That plate is already in use by another truck' });
    }
    throw err;
  }
});

/* ── Archive truck ───────────────────────────────────────────────────────── */
router.post('/fleet/:id/archive', (req, res) => {
  const { id } = req.params;
  const existing = fleetStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Truck not found' });

  fleetStore.archive(id);
  writeAudit({
    req,
    entity_type: 'fleet_truck',
    entity_id:   id,
    action:      'archive',
    summary:     `${req.user.display_name} archived truck ${existing.plate}`,
  });
  res.json({ ok: true });
});

/* ── Unarchive truck ─────────────────────────────────────────────────────── */
router.post('/fleet/:id/unarchive', (req, res) => {
  const { id } = req.params;
  // findById only finds non-archived; query by id directly via a raw check
  const db = require('../db');
  const row = db.prepare('SELECT id, plate FROM fleet_trucks WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Truck not found' });

  fleetStore.unarchive(id);
  writeAudit({
    req,
    entity_type: 'fleet_truck',
    entity_id:   id,
    action:      'unarchive',
    summary:     `${req.user.display_name} unarchived truck ${row.plate}`,
  });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LP-3 — Driver CRUD
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── List drivers ────────────────────────────────────────────────────────── */
router.get('/drivers', (req, res) => {
  const hauler_id = req.query.hauler_id || null;
  const drivers = driverStore.list({ hauler_id });
  res.json({ drivers });
});

/* ── Create driver ───────────────────────────────────────────────────────── */
router.post('/drivers', (req, res) => {
  const { hauler_id, full_name } = req.body || {};
  if (!hauler_id || !full_name) {
    return res.status(400).json({ error: 'hauler_id and full_name are required' });
  }
  const driver = driverStore.create(req.body);
  writeAudit({
    req,
    entity_type: 'driver',
    entity_id:   driver.id,
    action:      'create',
    summary:     `${req.user.display_name} created driver ${full_name} (${hauler_id})`,
    payload:     req.body,
  });
  res.status(201).json({ driver });
});

/* ── Update driver ───────────────────────────────────────────────────────── */
router.patch('/drivers/:id', (req, res) => {
  const { id } = req.params;
  const existing = driverStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Driver not found' });

  const driver = driverStore.update(id, req.body);
  writeAudit({
    req,
    entity_type: 'driver',
    entity_id:   id,
    action:      'update',
    summary:     `${req.user.display_name} updated driver ${existing.full_name}`,
    payload:     req.body,
  });
  res.json({ driver });
});

/* ── Archive driver ──────────────────────────────────────────────────────── */
router.post('/drivers/:id/archive', (req, res) => {
  const { id } = req.params;
  const existing = driverStore.findById(id);
  if (!existing) return res.status(404).json({ error: 'Driver not found' });

  driverStore.archive(id);
  writeAudit({
    req,
    entity_type: 'driver',
    entity_id:   id,
    action:      'archive',
    summary:     `${req.user.display_name} archived driver ${existing.full_name}`,
  });
  res.json({ ok: true });
});

/* ── Unarchive driver ────────────────────────────────────────────────────── */
router.post('/drivers/:id/unarchive', (req, res) => {
  const { id } = req.params;
  const db = require('../db');
  const row = db.prepare('SELECT id, full_name FROM fleet_drivers WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Driver not found' });

  driverStore.unarchive(id);
  writeAudit({
    req,
    entity_type: 'driver',
    entity_id:   id,
    action:      'unarchive',
    summary:     `${req.user.display_name} unarchived driver ${row.full_name}`,
  });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LP-13 — Alert rules CRUD
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
 * LP-23 — Webhook event inspector.
 *
 * GET    /api/admin/webhooks            → paginated event log
 * POST   /api/admin/webhooks/:id/retry  → re-queue a failed event
 * ═══════════════════════════════════════════════════════════════════ */

const eventProcessor = require('../services/eventProcessor');

const whStmts = {
  list: db.prepare(`
    SELECT id, hauler_id, source, event_type, processed, received_at,
           SUBSTR(raw_json, 1, 200) AS raw_preview
    FROM webhook_events
    WHERE (:hauler_id  IS NULL OR hauler_id  = :hauler_id)
      AND (:source     IS NULL OR source     = :source)
      AND (:processed  IS NULL OR processed  = :processed)
    ORDER BY received_at DESC
    LIMIT :limit OFFSET :offset
  `),
  count: db.prepare(`
    SELECT COUNT(*) AS n FROM webhook_events
    WHERE (:hauler_id IS NULL OR hauler_id = :hauler_id)
      AND (:source    IS NULL OR source    = :source)
      AND (:processed IS NULL OR processed = :processed)
  `),
  resetOne: db.prepare('UPDATE webhook_events SET processed = 0 WHERE id = ?'),
  getOne:   db.prepare('SELECT id FROM webhook_events WHERE id = ?'),
};

router.get('/webhooks', (req, res) => {
  const hauler_id  = req.query.hauler_id  || null;
  const source     = req.query.source     || null;
  const processedQ = req.query.processed;
  const processed  = processedQ != null ? Number(processedQ) : null;
  const limit      = Math.min(200, parseInt(req.query.limit, 10)  || 50);
  const offset     = Math.max(0,   parseInt(req.query.offset, 10) || 0);

  const params = { hauler_id, source, processed, limit, offset };
  const events = whStmts.list.all(params);
  const total  = whStmts.count.get(params).n;

  res.json({ total, limit, offset, events });
});

router.post('/webhooks/:id/retry', requireRole('axis_admin'), (req, res) => {
  const row = whStmts.getOne.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });

  // Reset to unprocessed so the processor can pick it up.
  whStmts.resetOne.run(req.params.id);
  try {
    eventProcessor.processIds([req.params.id]);
  } catch (err) {
    return res.status(500).json({ error: `Retry failed: ${err.message}` });
  }

  writeAudit({
    req,
    entity_type: 'webhook_event',
    entity_id:   req.params.id,
    action:      'retry',
    summary:     `Webhook event ${req.params.id} manually retried`,
  });
  res.json({ ok: true });
});

router.get('/alert-rules', (_req, res) => {
  res.json({ alert_rules: alertRulesStore.list() });
});

router.post('/alert-rules', (req, res) => {
  const { rule_type, threshold, severity, hauler_id, label, enabled } = req.body || {};
  if (!rule_type || threshold == null) {
    return res.status(400).json({ error: 'rule_type and threshold are required' });
  }
  const rule = alertRulesStore.create({ rule_type, threshold, severity, hauler_id, label, enabled });
  writeAudit({
    req,
    entity_type: 'alert_rule',
    entity_id:   rule.id,
    action:      'create',
    summary:     `${req.user.display_name} created alert rule: ${rule.label ?? rule_type} ≥ ${threshold}`,
  });
  res.status(201).json({ alert_rule: rule });
});

router.patch('/alert-rules/:id', (req, res) => {
  const { id } = req.params;
  if (!alertRulesStore.findById(id)) return res.status(404).json({ error: 'Rule not found' });
  const rule = alertRulesStore.update(id, req.body || {});
  writeAudit({ req, entity_type: 'alert_rule', entity_id: id, action: 'update', summary: `Updated alert rule ${id}` });
  res.json({ alert_rule: rule });
});

router.delete('/alert-rules/:id', (req, res) => {
  const { id } = req.params;
  if (!alertRulesStore.findById(id)) return res.status(404).json({ error: 'Rule not found' });
  alertRulesStore.remove(id);
  writeAudit({ req, entity_type: 'alert_rule', entity_id: id, action: 'delete', summary: `Deleted alert rule ${id}` });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LP-14 — Notification preferences
 * ═══════════════════════════════════════════════════════════════════════════ */

const notifPrefsStmts = {
  forUser:  db.prepare('SELECT * FROM notification_preferences WHERE user_id = ? ORDER BY alert_type'),
  upsert:   db.prepare(`
    INSERT INTO notification_preferences (id, user_id, alert_type, via_email, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, alert_type) DO UPDATE SET via_email = excluded.via_email, updated_at = excluded.updated_at
  `),
  delete:   db.prepare('DELETE FROM notification_preferences WHERE user_id = ? AND alert_type = ?'),
};

router.get('/users/:id/notification-prefs', (req, res) => {
  const u = users.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ prefs: notifPrefsStmts.forUser.all(req.params.id) });
});

router.put('/users/:id/notification-prefs', (req, res) => {
  const u = users.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  const prefs = Array.isArray(req.body?.prefs) ? req.body.prefs : [];
  const ts    = new Date().toISOString();
  const upsertAll = db.transaction((rows) => {
    for (const p of rows) {
      notifPrefsStmts.upsert.run(
        crypto.randomBytes(4).toString('hex'),
        req.params.id,
        p.alert_type ?? '*',
        p.via_email !== false ? 1 : 0,
        ts,
      );
    }
  });
  upsertAll(prefs);
  res.json({ ok: true, prefs: notifPrefsStmts.forUser.all(req.params.id) });
});

/* ═══════════════════════════════════════════════════════════════════
 * LP-19 — Admin session management.
 *
 * GET    /api/admin/sessions          → all active sessions (axis_admin)
 * DELETE /api/admin/sessions/:prefix  → revoke any session (axis_admin)
 * ═══════════════════════════════════════════════════════════════════ */

router.get('/sessions', requireRole('axis_admin'), (_req, res) => {
  const all = sessions.listAll();
  // Enrich with display_name so the admin UI can show who owns each session.
  const userMap = Object.fromEntries(
    users.list().map((u) => [u.id, u.display_name]),
  );
  const enriched = all.map((s) => ({
    ...s,
    display_name: userMap[s.user_id] ?? s.user_id,
  }));
  res.json({ sessions: enriched });
});

router.delete('/sessions/:prefix', requireRole('axis_admin'), (req, res) => {
  const prefix = req.params.prefix;
  if (!prefix || prefix.length < 8) return res.status(400).json({ error: 'Invalid token prefix' });

  const { ok, user_id } = sessions.revokeByPrefix(prefix);
  if (!ok) return res.status(404).json({ error: 'Session not found' });

  writeAudit({
    req,
    entity_type: 'session',
    entity_id:   prefix,
    action:      'revoke',
    summary:     `Admin revoked session ${prefix}… for user ${user_id}`,
  });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════
 * LP-18 — CSV import / export for fleet trucks and drivers.
 *
 * Import accepts text/csv (or text/plain, application/octet-stream).
 * Uses express.text() middleware on these specific routes so the JSON
 * body parser doesn't reject the non-JSON body.
 *
 * CSV parser: handles quoted fields with embedded commas/newlines and
 * doubled-quote escaping (""). No external dependencies.
 * ═══════════════════════════════════════════════════════════════════ */

/* ── CSV helpers (from shared lib/csv.js) ──────────────────────── */

const { parseCSV, toCSV } = require('../lib/csv');

const csvBodyParser = express.text({
  type: ['text/csv', 'text/plain', 'application/octet-stream'],
  limit: '4mb',
});

/* ── Fleet export ────────────────────────────────────────────────── */

const FLEET_CSV_HEADERS = [
  'id', 'plate', 'hauler_id', 'hauler_display', 'make', 'model', 'axle_config',
  'year_of_manufacture', 'empty_weight_t', 'gross_weight_t', 'payload_capacity_t',
  'status', 'total_km', 'efficiency_l_per_100km',
];

router.get(
  '/fleet/export',
  (_req, res) => {
    const trucks = fleetStore.list();
    const csv = toCSV(FLEET_CSV_HEADERS, trucks);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fleet.csv"');
    res.send(csv);
  },
);

/* ── Fleet import ────────────────────────────────────────────────── */

router.post(
  '/fleet/import',
  requireRole('axis_admin'),
  csvBodyParser,
  (req, res) => {
    const body = typeof req.body === 'string' ? req.body : '';
    if (!body.trim()) return res.status(400).json({ error: 'Empty CSV body' });

    let rows;
    try { rows = parseCSV(body); }
    catch (e) { return res.status(400).json({ error: `CSV parse error: ${e.message}` }); }

    const created = [];
    const errors  = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.plate || !row.hauler_id) {
        errors.push({ row: i + 2, error: 'plate and hauler_id are required' });
        continue;
      }
      try {
        const truck = fleetStore.create({
          plate:               row.plate,
          hauler_id:           row.hauler_id,
          hauler_display:      row.hauler_display || null,
          make:                row.make           || null,
          model:               row.model          || null,
          axle_config:         row.axle_config    || '6x4',
          year_of_manufacture: row.year_of_manufacture ? Number(row.year_of_manufacture) : null,
          empty_weight_t:      row.empty_weight_t ? Number(row.empty_weight_t) : null,
          gross_weight_t:      row.gross_weight_t ? Number(row.gross_weight_t) : 40,
          payload_capacity_t:  row.payload_capacity_t ? Number(row.payload_capacity_t) : null,
        });
        created.push(truck.id);
      } catch (e) {
        errors.push({ row: i + 2, error: e.message });
      }
    }

    writeAudit({
      req,
      entity_type: 'fleet_import',
      entity_id:   'batch',
      action:      'import',
      summary:     `Fleet CSV import: ${created.length} created, ${errors.length} errors`,
    });

    res.status(errors.length && !created.length ? 400 : 207).json({
      created: created.length,
      errors,
    });
  },
);

/* ── Driver export ───────────────────────────────────────────────── */

const DRIVER_CSV_HEADERS = [
  'id', 'hauler_id', 'hauler_display', 'full_name', 'licence_number',
  'licence_class', 'licence_expiry_iso', 'phone', 'years_experience',
  'shift', 'safety_score', 'assigned_plate',
];

router.get(
  '/drivers/export',
  (_req, res) => {
    const drivers = driverStore.list();
    const csv = toCSV(DRIVER_CSV_HEADERS, drivers);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="drivers.csv"');
    res.send(csv);
  },
);

/* ── Driver import ───────────────────────────────────────────────── */

router.post(
  '/drivers/import',
  requireRole('axis_admin'),
  csvBodyParser,
  (req, res) => {
    const body = typeof req.body === 'string' ? req.body : '';
    if (!body.trim()) return res.status(400).json({ error: 'Empty CSV body' });

    let rows;
    try { rows = parseCSV(body); }
    catch (e) { return res.status(400).json({ error: `CSV parse error: ${e.message}` }); }

    const created = [];
    const errors  = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.hauler_id || !row.full_name) {
        errors.push({ row: i + 2, error: 'hauler_id and full_name are required' });
        continue;
      }
      try {
        const driver = driverStore.create({
          hauler_id:          row.hauler_id,
          hauler_display:     row.hauler_display      || null,
          full_name:          row.full_name,
          licence_number:     row.licence_number      || null,
          licence_class:      row.licence_class       || 'E',
          licence_expiry_iso: row.licence_expiry_iso  || null,
          phone:              row.phone               || null,
          years_experience:   row.years_experience ? Number(row.years_experience) : 0,
          shift:              row.shift               || 'day',
          safety_score:       row.safety_score ? Number(row.safety_score) : 80,
        });
        created.push(driver.id);
      } catch (e) {
        errors.push({ row: i + 2, error: e.message });
      }
    }

    writeAudit({
      req,
      entity_type: 'driver_import',
      entity_id:   'batch',
      action:      'import',
      summary:     `Driver CSV import: ${created.length} created, ${errors.length} errors`,
    });

    res.status(errors.length && !created.length ? 400 : 207).json({
      created: created.length,
      errors,
    });
  },
);

/* ═══════════════════════════════════════════════════════════════════
 * LP-30 — Admin data exports (CSV per table).
 *
 * GET /api/admin/export/trips    — all trips
 * GET /api/admin/export/metrics  — hauler_daily_metrics
 * GET /api/admin/export/health   — corridor_health scores
 * GET /api/admin/export/positions — latest vehicle positions
 *
 * Intended for disaster recovery, offline analysis, and handover.
 * Requires axis_admin.
 * ═══════════════════════════════════════════════════════════════════ */

const positionStore    = require('../state/positionStore');

const TRIPS_EXPORT_HEADERS = [
  'id', 'hauler_id', 'vehicle_id', 'driver_id', 'status', 'direction',
  'origin', 'destination', 'route_id', 'departed_at', 'arrived_at',
  'duration_min', 'distance_km', 'tonnage_t', 'source', 'created_at', 'updated_at',
];

const METRICS_EXPORT_HEADERS = [
  'hauler_id', 'date', 'trip_count', 'total_tonnes', 'on_time_count',
  'avg_duration_min', 'computed_at',
];

const HEALTH_EXPORT_HEADERS = [
  'date', 'score', 'on_time_rate', 'alert_load', 'pos_freshness', 'computed_at',
];

const POSITIONS_EXPORT_HEADERS = [
  'vehicle_id', 'hauler_id', 'latitude', 'longitude', 'speed_kmh', 'heading_deg', 'position_at',
];

function csvExport(res, filename, headers, rows) {
  const csv = toCSV(headers, rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get('/export/trips', requireRole('axis_admin'), (_req, res) => {
  const rows = db.prepare(`SELECT * FROM trips ORDER BY departed_at DESC`).all();
  csvExport(res, 'trips.csv', TRIPS_EXPORT_HEADERS, rows);
});

router.get('/export/metrics', requireRole('axis_admin'), (_req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM hauler_daily_metrics ORDER BY date DESC, hauler_id`).all();
    csvExport(res, 'hauler_daily_metrics.csv', METRICS_EXPORT_HEADERS, rows);
  } catch (_) {
    res.status(500).json({ error: 'Metrics table not yet created — run migrations' });
  }
});

router.get('/export/health', requireRole('axis_admin'), (_req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM corridor_health ORDER BY date DESC`).all();
    csvExport(res, 'corridor_health.csv', HEALTH_EXPORT_HEADERS, rows);
  } catch (_) {
    res.status(500).json({ error: 'Health table not yet created — run migrations' });
  }
});

router.get('/export/positions', requireRole('axis_admin'), (_req, res) => {
  const rows = positionStore.all();
  csvExport(res, 'vehicle_positions.csv', POSITIONS_EXPORT_HEADERS, rows);
});

/* ═══════════════════════════════════════════════════════════════════
 * LP-40 — Self-check / readiness endpoint.
 *
 * GET /api/admin/readiness
 *
 * Returns a structured health check across all critical subsystems:
 * DB connectivity, required tables, event processor queue depth,
 * fleet + driver counts, and migration currency.
 * ═══════════════════════════════════════════════════════════════════ */

router.get('/readiness', (_req, res) => {
  const checks = [];
  let allOk = true;

  function check(name, fn) {
    try {
      const { ok, detail } = fn();
      if (!ok) allOk = false;
      checks.push({ name, ok, detail: detail ?? null });
    } catch (err) {
      allOk = false;
      checks.push({ name, ok: false, detail: err.message });
    }
  }

  check('database', () => {
    db.prepare('SELECT 1').get();
    return { ok: true, detail: 'SQLite reachable' };
  });

  check('required_tables', () => {
    const TABLES = [
      'sessions', 'users', 'fleet_trucks', 'fleet_drivers', 'trips',
      'vehicle_positions', 'webhook_events', 'alert_state', 'alert_rules',
      'corridor_health', 'corridor_benchmarks', 'kv_settings',
    ];
    const existing = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
    );
    const missing = TABLES.filter((t) => !existing.has(t));
    return { ok: missing.length === 0, detail: missing.length ? `Missing: ${missing.join(', ')}` : `${TABLES.length} tables present` };
  });

  check('event_queue_depth', () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM webhook_events WHERE processed = 0').get();
    const ok = n < 500;
    return { ok, detail: `${n} unprocessed events` };
  });

  check('fleet_count', () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM fleet_trucks WHERE archived = 0').get();
    return { ok: n > 0, detail: `${n} active trucks` };
  });

  check('driver_count', () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM fleet_drivers WHERE archived = 0').get();
    return { ok: n > 0, detail: `${n} active drivers` };
  });

  check('migration_currency', () => {
    try {
      const { version } = db.prepare(
        'SELECT MAX(version) AS version FROM schema_migrations',
      ).get() ?? {};
      return { ok: true, detail: `Latest migration version: ${version ?? 'unknown'}` };
    } catch (_) {
      return { ok: false, detail: 'schema_migrations table not found' };
    }
  });

  res.status(allOk ? 200 : 503).json({
    ready:       allOk,
    checked_at:  new Date().toISOString(),
    uptime_s:    Math.floor(process.uptime()),
    checks,
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * LP-47 — Alert rule dry-run.
 *
 * POST /api/admin/alert-rules/test
 * Body: { rule_type, value, hauler_id?, vehicle_id? }
 *
 * Simulates evaluating all enabled rules matching the given rule_type
 * against the supplied value. Returns which rules would fire without
 * writing any alerts or notifications.
 * ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
 * LP-55 — Per-hauler integration status.
 *
 * GET /api/admin/haulers/:id/integration
 *
 * Returns a focused integration health view for one hauler: adapter
 * type, credentials present, last sync, error count, API token status,
 * webhook secret status, and a sample of recent webhook events.
 * Used during hauler onboarding and integration troubleshooting.
 * ═══════════════════════════════════════════════════════════════════ */

const integrationStore = require('../state/integrationStore');

router.get('/haulers/:id/integration', (req, res) => {
  const { id } = req.params;
  const hauler = haulerStore.findById(id);
  if (!hauler) return res.status(404).json({ error: 'Hauler not found' });

  let summary = {};
  try { summary = integrationStore.summary(id) ?? {}; } catch (_) {}

  // Last 10 webhook events for this hauler.
  let recent_events = [];
  try {
    recent_events = db.prepare(`
      SELECT id, source, event_type, processed, received_at
      FROM webhook_events
      WHERE hauler_id = ?
      ORDER BY received_at DESC
      LIMIT 10
    `).all(id);
  } catch (_) {}

  const errorRate24h = hauler.integration.error_count_24h;

  res.json({
    hauler_id:        id,
    display_name:     hauler.display_name,
    integration: {
      type:             hauler.integration.type,
      adapter:          hauler.integration.adapter,
      last_sync:        hauler.integration.last_sync,
      error_count_24h:  errorRate24h,
      has_credentials:  Boolean(summary.has_credentials),
      live:             Boolean(summary.live),
    },
    tokens: {
      has_api_token:       Boolean(hauler.api_token),
      has_webhook_secret:  Boolean(hauler.webhook_secret),
    },
    recent_events,
    checked_at: new Date().toISOString(),
  });
});

router.post('/alert-rules/test', (req, res) => {
  const { rule_type, value, hauler_id, vehicle_id } = req.body ?? {};
  if (!rule_type || value == null) {
    return res.status(400).json({ error: 'rule_type and value are required' });
  }

  const rules = alertRulesStore.forEvent(rule_type, hauler_id ?? null);
  const wouldFire = [];
  const wouldSkip = [];

  for (const rule of rules) {
    if (!rule.enabled) { wouldSkip.push({ ...rule, reason: 'disabled' }); continue; }
    const fires = Number(value) > Number(rule.threshold);
    if (fires) {
      wouldFire.push({
        rule_id:   rule.id,
        label:     rule.label,
        rule_type: rule.rule_type,
        threshold: rule.threshold,
        severity:  rule.severity,
        hauler_id: rule.hauler_id,
      });
    } else {
      wouldSkip.push({
        rule_id:   rule.id,
        label:     rule.label,
        reason:    `value ${value} ≤ threshold ${rule.threshold}`,
      });
    }
  }

  res.json({
    rule_type,
    value:       Number(value),
    hauler_id:   hauler_id ?? null,
    vehicle_id:  vehicle_id ?? null,
    would_fire:  wouldFire,
    would_skip:  wouldSkip,
    evaluated:   rules.length,
    dry_run:     true,
  });
});

module.exports = router;
