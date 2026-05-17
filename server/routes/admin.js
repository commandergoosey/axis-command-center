'use strict';

/*
 * LP-2 — Admin user-management endpoints. All routes require axis_admin.
 *
 * GET    /api/admin/users                  — full user list (inc. inactive)
 * POST   /api/admin/users                  — create new user
 * PATCH  /api/admin/users/:id              — edit display_name / role / org / hauler_id
 * POST   /api/admin/users/:id/set-password — admin force-sets any user's password
 * POST   /api/admin/users/:id/deactivate   — suspend account (blocks login)
 * POST   /api/admin/users/:id/reactivate   — restore account
 */

const express = require('express');
const router  = express.Router();

const users    = require('../state/users');
const sessions = require('../services/sessions');
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

module.exports = router;
