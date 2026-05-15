'use strict';

/*
 * Corridor announcements — Phase 85.
 *
 * GET    /api/broadcasts/active   — active for caller's role
 * GET    /api/broadcasts          — all (admin view, includes archived)
 * POST   /api/broadcasts          — create (axis_admin / axis_ops)
 * PATCH  /api/broadcasts/:id      — update (write roles)
 * POST   /api/broadcasts/:id/archive    — soft delete
 * POST   /api/broadcasts/:id/unarchive  — restore
 * DELETE /api/broadcasts/:id      — hard delete (axis_admin)
 */

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const broadcasts = require('../state/broadcasts');
const { writeAudit } = require('../db/audit');

const WRITE_ROLES = ['axis_admin', 'axis_ops'];

router.get('/active', requireAuth, (req, res) => {
  res.json({
    broadcasts: broadcasts.activeForRole(req.user.role),
  });
});

router.get('/', requireRole(...WRITE_ROLES), (_req, res) => {
  res.json({ broadcasts: broadcasts.listAll() });
});

router.post('/', requireRole(...WRITE_ROLES), (req, res) => {
  try {
    const b = broadcasts.add({
      title:      req.body?.title,
      body:       req.body?.body,
      severity:   req.body?.severity,
      audience:   req.body?.audience,
      expires_at: req.body?.expires_at,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'broadcast',
      entity_id:   String(b.id),
      action:      'create',
      summary:     `[${b.severity.toUpperCase()}] Broadcast posted: ${b.title}`,
      payload:     { audience: b.audience, severity: b.severity },
    });
    res.json({ broadcast: b });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const b = broadcasts.update(id, req.body || {});
    if (!b) return res.status(404).json({ error: 'Broadcast not found' });
    writeAudit({
      req,
      entity_type: 'broadcast',
      entity_id:   String(id),
      action:      'update',
      summary:     `Updated broadcast "${b.title}"`,
    });
    res.json({ broadcast: b });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/archive', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = broadcasts.findById(id);
  if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
  broadcasts.archive(id);
  writeAudit({
    req,
    entity_type: 'broadcast',
    entity_id:   String(id),
    action:      'archive',
    summary:     `Archived broadcast "${existing.title}"`,
  });
  res.json({ archived: true });
});

router.post('/:id/unarchive', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = broadcasts.findById(id);
  if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
  broadcasts.unarchive(id);
  writeAudit({
    req,
    entity_type: 'broadcast',
    entity_id:   String(id),
    action:      'unarchive',
    summary:     `Restored broadcast "${existing.title}"`,
  });
  res.json({ unarchived: true });
});

router.delete('/:id', requireRole('axis_admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = broadcasts.findById(id);
  if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
  broadcasts.remove(id);
  writeAudit({
    req,
    entity_type: 'broadcast',
    entity_id:   String(id),
    action:      'delete',
    summary:     `Deleted broadcast "${existing.title}"`,
  });
  res.json({ deleted: true });
});

module.exports = router;
