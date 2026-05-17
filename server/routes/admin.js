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

const users       = require('../state/users');
const sessions    = require('../services/sessions');
const fleetStore  = require('../state/fleetStore');
const driverStore = require('../state/driverStore');
const { requireRole } = require('../middleware/auth');
const { writeAudit }  = require('../db/audit');

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

module.exports = router;
