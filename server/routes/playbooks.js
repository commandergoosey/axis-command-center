'use strict';

/*
 * Playbook endpoints — Phase 80.
 *
 * GET    /api/playbooks                   — list active templates + recent runs
 * POST   /api/playbooks                   — create template (axis_admin / axis_ops)
 * PATCH  /api/playbooks/:id               — update template (write roles)
 * POST   /api/playbooks/:id/archive       — archive (write roles)
 * POST   /api/playbooks/:id/unarchive     — restore (write roles)
 * DELETE /api/playbooks/:id               — hard delete (axis_admin)
 *
 * POST   /api/playbooks/:id/run           — execute the playbook, materialize a run
 * GET    /api/playbooks/:id/runs          — recent runs of one playbook
 * GET    /api/playbooks/runs/:runId       — single run + items
 * POST   /api/playbooks/runs/items/:itemId/complete — tick an item done
 * POST   /api/playbooks/runs/items/:itemId/reopen   — un-tick
 *
 * Read open to all roles (read-only governance), writes restricted
 * to axis_admin / axis_ops. All writes audited.
 */

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const playbooks    = require('../state/playbooks');
const playbookRuns = require('../state/playbookRuns');
const { writeAudit } = require('../db/audit');

const WRITE_ROLES = ['axis_admin', 'axis_ops'];

// ── Templates ─────────────────────────────────────────────────────

router.get('/', requireAuth, (_req, res) => {
  res.json({
    playbooks:   playbooks.listActive(),
    recent_runs: playbookRuns.recentRuns(10),
  });
});

router.post('/', requireRole(...WRITE_ROLES), (req, res) => {
  try {
    const pb = playbooks.add({
      name:           req.body?.name,
      description:    req.body?.description,
      schedule_label: req.body?.schedule_label,
      items:          req.body?.items,
      by_user_id:     req.user.id,
      by_display:     req.user.display_name,
      by_role:        req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'playbook',
      entity_id:   String(pb.id),
      action:      'create',
      summary:     `Created playbook "${pb.name}" (${pb.items.length} item${pb.items.length === 1 ? '' : 's'})`,
    });
    res.json({ playbook: pb });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const pb = playbooks.update(id, req.body || {});
    if (!pb) return res.status(404).json({ error: 'Playbook not found' });
    writeAudit({
      req,
      entity_type: 'playbook',
      entity_id:   String(id),
      action:      'update',
      summary:     `Updated playbook "${pb.name}"`,
    });
    res.json({ playbook: pb });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/archive', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = playbooks.findById(id);
  if (!existing) return res.status(404).json({ error: 'Playbook not found' });
  playbooks.archive(id);
  writeAudit({
    req,
    entity_type: 'playbook',
    entity_id:   String(id),
    action:      'archive',
    summary:     `Archived playbook "${existing.name}"`,
  });
  res.json({ archived: true });
});

router.post('/:id/unarchive', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = playbooks.findById(id);
  if (!existing) return res.status(404).json({ error: 'Playbook not found' });
  playbooks.unarchive(id);
  writeAudit({
    req,
    entity_type: 'playbook',
    entity_id:   String(id),
    action:      'unarchive',
    summary:     `Restored playbook "${existing.name}"`,
  });
  res.json({ unarchived: true });
});

router.delete('/:id', requireRole('axis_admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = playbooks.findById(id);
  if (!existing) return res.status(404).json({ error: 'Playbook not found' });
  playbooks.remove(id);
  writeAudit({
    req,
    entity_type: 'playbook',
    entity_id:   String(id),
    action:      'delete',
    summary:     `Deleted playbook "${existing.name}"`,
  });
  res.json({ deleted: true });
});

// ── Runs ──────────────────────────────────────────────────────────

router.post('/:id/run', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const playbook = playbooks.findById(id);
  if (!playbook) return res.status(404).json({ error: 'Playbook not found' });
  if (playbook.archived_at) return res.status(400).json({ error: 'Cannot run an archived playbook' });
  const result = playbookRuns.run(playbook, {
    by_user_id: req.user.id,
    by_display: req.user.display_name,
    by_role:    req.user.role,
  });
  writeAudit({
    req,
    entity_type: 'playbook_run',
    entity_id:   String(result.run.id),
    action:      'start',
    summary:     `Ran playbook "${playbook.name}" — ${result.items.length} item${result.items.length === 1 ? '' : 's'} materialized`,
    payload:     { playbook_id: playbook.id },
  });
  res.json(result);
});

router.get('/:id/runs', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const playbook = playbooks.findById(id);
  if (!playbook) return res.status(404).json({ error: 'Playbook not found' });
  res.json({
    playbook_id:   playbook.id,
    playbook_name: playbook.name,
    runs:          playbookRuns.runsForPlaybook(playbook.id, 20),
  });
});

router.get('/runs/:runId', requireAuth, (req, res) => {
  const runId = parseInt(req.params.runId, 10);
  const run = playbookRuns.findRun(runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({
    run,
    items: playbookRuns.itemsForRun(runId),
  });
});

router.post('/runs/items/:itemId/complete', requireRole(...WRITE_ROLES), (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const existing = playbookRuns.findItem(itemId);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const updated = playbookRuns.completeItem(itemId, req.user.display_name);
  writeAudit({
    req,
    entity_type: 'playbook_item',
    entity_id:   String(itemId),
    action:      'complete',
    summary:     `Completed playbook item "${updated.title}"`,
    payload:     { run_id: existing.run_id },
  });
  res.json({ item: updated });
});

router.post('/runs/items/:itemId/reopen', requireRole(...WRITE_ROLES), (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const existing = playbookRuns.findItem(itemId);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const updated = playbookRuns.reopenItem(itemId);
  writeAudit({
    req,
    entity_type: 'playbook_item',
    entity_id:   String(itemId),
    action:      'reopen',
    summary:     `Reopened playbook item "${updated.title}"`,
    payload:     { run_id: existing.run_id },
  });
  res.json({ item: updated });
});

module.exports = router;
