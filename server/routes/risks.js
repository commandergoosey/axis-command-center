'use strict';

/*
 * Risk register endpoints — Phase 72.
 *
 * GET    /api/risks         — list active + counts (all roles)
 * POST   /api/risks         — create (axis_admin / axis_ops)
 * PATCH  /api/risks/:id     — update (write roles)
 * POST   /api/risks/:id/review   — bump last_reviewed_at (write roles)
 * POST   /api/risks/:id/archive  — soft-delete (write roles)
 * POST   /api/risks/:id/unarchive — restore (write roles)
 * DELETE /api/risks/:id     — hard delete (axis_admin only)
 *
 * All writes audited as `entity_type='risk'`.
 */

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const riskRegister = require('../state/riskRegister');
const riskSteps    = require('../state/riskSteps');
const riskComments = require('../state/riskComments');
const { writeAudit } = require('../db/audit');

const WRITE_ROLES = ['axis_admin', 'axis_ops'];

router.get('/', requireAuth, (_req, res) => {
  // Phase 74 — join step counts; Phase 77 — join comment counts
  // so the page renders progress + activity signals in one fetch.
  const stepCounts = riskSteps.countsByRisk();
  const commentCounts = riskComments.countsByRisk();
  const risks = riskRegister.listActive().map((r) => ({
    ...r,
    steps_summary:    stepCounts[r.id]    || { done_count: 0, total_count: 0, open_count: 0 },
    comments_summary: { count: commentCounts[r.id] || 0 },
  }));

  // Phase 139 — likelihood × severity heat matrix. Each cell counts open
  // (non-closed) risks so the matrix reflects live exposure, not history.
  const LIKELIHOOD_ORDER = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'];
  const SEVERITY_ORDER   = ['low', 'medium', 'high', 'critical'];
  const openRisks = risks.filter((r) => r.status !== 'closed');
  const matrix = LIKELIHOOD_ORDER.map((l) => ({
    likelihood: l,
    cells: SEVERITY_ORDER.map((s) => ({
      severity: s,
      count: openRisks.filter((r) => r.likelihood === l && r.severity === s).length,
    })),
  }));

  // Phase 170 — 8-week risk exposure score trend. Each week's score is a
  // weighted sum of severity × likelihood for all open risks at that point in
  // time. The current week uses the live register; prior 7 weeks are seeded
  // deterministically so the trend is stable across requests. MODELLED.
  function seededRisk(n) {
    const raw = Math.sin(n * 6143 + 53) * 107_159;
    return raw - Math.floor(raw);
  }
  const SEV_W  = { low: 1, medium: 2, high: 4, critical: 8 };
  const LIKE_W = { rare: 1, unlikely: 2, possible: 3, likely: 4, almost_certain: 5 };
  const currentExposure = openRisks.reduce(
    (s, r) => s + (SEV_W[r.severity] ?? 1) * (LIKE_W[r.likelihood] ?? 1),
    0,
  );
  // Scale to 0-100 using a soft ceiling of 80 raw score points.
  const scaleScore = (raw) => Math.min(100, Math.round((raw / 80) * 100));
  const nowMs = Date.now();
  const exposure_trend = [];
  for (let w = 7; w >= 0; w--) {
    const weekMs   = nowMs - w * 7 * 86_400_000;
    const monday   = new Date(weekMs);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const label    = monday.toISOString().slice(0, 10);
    const wk       = Math.round(weekMs / (7 * 86_400_000)); // stable int seed
    const rawScore = w === 0
      ? currentExposure
      : Math.round(currentExposure * (0.60 + seededRisk(wk) * 0.80));
    const score    = scaleScore(rawScore);
    exposure_trend.push({
      week:     label,
      score,
      is_current: w === 0,
      modelled:   w > 0,
    });
  }

  res.json({
    risks,
    counts: riskRegister.counts(),
    matrix,
    exposure_trend,
  });
});

router.get('/options', requireAuth, (_req, res) => {
  res.json({
    categories:  riskRegister.CATEGORIES,
    severities:  riskRegister.SEVERITIES,
    likelihoods: riskRegister.LIKELIHOODS,
    statuses:    riskRegister.STATUSES,
  });
});

router.post('/', requireRole(...WRITE_ROLES), (req, res) => {
  try {
    const r = riskRegister.add({
      title:           req.body?.title,
      description:     req.body?.description,
      category:        req.body?.category,
      severity:        req.body?.severity,
      likelihood:      req.body?.likelihood,
      status:          req.body?.status || 'open',
      owner_user_id:   req.body?.owner_user_id,
      owner_display:   req.body?.owner_display,
      mitigation_plan: req.body?.mitigation_plan,
      by_user_id:      req.user.id,
      by_display:      req.user.display_name,
      by_role:         req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'risk',
      entity_id:   String(r.id),
      action:      'create',
      summary:     `[${r.severity.toUpperCase()}] ${r.category} risk added: ${r.title}`,
      payload:     { severity: r.severity, category: r.category, status: r.status },
    });
    res.json({ risk: r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const updated = riskRegister.update(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Risk not found' });
    writeAudit({
      req,
      entity_type: 'risk',
      entity_id:   String(id),
      action:      'update',
      summary:     `Updated risk "${updated.title}" — status ${updated.status}, severity ${updated.severity}`,
      payload:     { fields: Object.keys(req.body || {}) },
    });
    res.json({ risk: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/review', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const existing = riskRegister.findById(id);
  if (!existing) return res.status(404).json({ error: 'Risk not found' });
  const updated = riskRegister.review(id, req.user.display_name);
  writeAudit({
    req,
    entity_type: 'risk',
    entity_id:   String(id),
    action:      'review',
    summary:     `Reviewed risk "${updated.title}" — assessment confirmed current`,
  });
  res.json({ risk: updated });
});

router.post('/:id/archive', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = riskRegister.findById(id);
  if (!existing) return res.status(404).json({ error: 'Risk not found' });
  riskRegister.archive(id);
  writeAudit({
    req,
    entity_type: 'risk',
    entity_id:   String(id),
    action:      'archive',
    summary:     `Archived risk "${existing.title}"`,
  });
  res.json({ archived: true });
});

router.post('/:id/unarchive', requireRole(...WRITE_ROLES), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = riskRegister.findById(id);
  if (!existing) return res.status(404).json({ error: 'Risk not found' });
  riskRegister.unarchive(id);
  writeAudit({
    req,
    entity_type: 'risk',
    entity_id:   String(id),
    action:      'unarchive',
    summary:     `Restored risk "${existing.title}"`,
  });
  res.json({ unarchived: true });
});

router.delete('/:id', requireRole('axis_admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = riskRegister.findById(id);
  if (!existing) return res.status(404).json({ error: 'Risk not found' });
  riskRegister.remove(id);
  writeAudit({
    req,
    entity_type: 'risk',
    entity_id:   String(id),
    action:      'delete',
    summary:     `Deleted risk "${existing.title}"`,
  });
  res.json({ deleted: true });
});

// ── Phase 74 — Risk mitigation steps ──────────────────────────────
//
// Structured checklist attached to each risk. Steps are discrete
// units of work with title, owner, due date, and an open/done
// status. Read open to all roles; write restricted to
// axis_admin / axis_ops (matching parent risk).
//
// Helper to look up the parent risk + 404 if missing.
function findRiskOr404(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid risk id' });
    return null;
  }
  const r = riskRegister.findById(id);
  if (!r) {
    res.status(404).json({ error: 'Risk not found' });
    return null;
  }
  return r;
}

router.get('/:id/steps', requireAuth, (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  res.json({
    risk_id: risk.id,
    risk_title: risk.title,
    steps: riskSteps.forRisk(risk.id),
  });
});

router.post('/:id/steps', requireRole(...WRITE_ROLES), (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  try {
    const step = riskSteps.add({
      risk_id:       risk.id,
      title:         req.body?.title,
      owner_user_id: req.body?.owner_user_id,
      owner_display: req.body?.owner_display,
      due_date:      req.body?.due_date,
      by_user_id:    req.user.id,
      by_display:    req.user.display_name,
      by_role:       req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'risk_step',
      entity_id:   String(step.id),
      action:      'create',
      summary:     `Added step "${step.title}" to risk "${risk.title}"`,
      payload:     { risk_id: risk.id },
    });
    res.json({ step });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/steps/:stepId', requireRole(...WRITE_ROLES), (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  const stepId = parseInt(req.params.stepId, 10);
  const existing = riskSteps.findById(stepId);
  if (!existing || existing.risk_id !== risk.id) {
    return res.status(404).json({ error: 'Step not found for this risk' });
  }
  try {
    const updated = riskSteps.update(stepId, req.body || {});
    writeAudit({
      req,
      entity_type: 'risk_step',
      entity_id:   String(stepId),
      action:      'update',
      summary:     `Updated step "${updated.title}" on risk "${risk.title}"`,
      payload:     { risk_id: risk.id, fields: Object.keys(req.body || {}) },
    });
    res.json({ step: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/steps/:stepId/complete', requireRole(...WRITE_ROLES), (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  const stepId = parseInt(req.params.stepId, 10);
  const existing = riskSteps.findById(stepId);
  if (!existing || existing.risk_id !== risk.id) {
    return res.status(404).json({ error: 'Step not found for this risk' });
  }
  const updated = riskSteps.complete(stepId, req.user.display_name);
  writeAudit({
    req,
    entity_type: 'risk_step',
    entity_id:   String(stepId),
    action:      'complete',
    summary:     `Completed step "${updated.title}" on risk "${risk.title}"`,
    payload:     { risk_id: risk.id },
  });
  res.json({ step: updated });
});

router.post('/:id/steps/:stepId/reopen', requireRole(...WRITE_ROLES), (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  const stepId = parseInt(req.params.stepId, 10);
  const existing = riskSteps.findById(stepId);
  if (!existing || existing.risk_id !== risk.id) {
    return res.status(404).json({ error: 'Step not found for this risk' });
  }
  const updated = riskSteps.reopen(stepId);
  writeAudit({
    req,
    entity_type: 'risk_step',
    entity_id:   String(stepId),
    action:      'reopen',
    summary:     `Reopened step "${updated.title}" on risk "${risk.title}"`,
    payload:     { risk_id: risk.id },
  });
  res.json({ step: updated });
});

router.delete('/:id/steps/:stepId', requireRole(...WRITE_ROLES), (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  const stepId = parseInt(req.params.stepId, 10);
  const existing = riskSteps.findById(stepId);
  if (!existing || existing.risk_id !== risk.id) {
    return res.status(404).json({ error: 'Step not found for this risk' });
  }
  riskSteps.remove(stepId);
  writeAudit({
    req,
    entity_type: 'risk_step',
    entity_id:   String(stepId),
    action:      'delete',
    summary:     `Deleted step "${existing.title}" from risk "${risk.title}"`,
    payload:     { risk_id: risk.id },
  });
  res.json({ deleted: true });
});

// ── Phase 77 — Risk comments ──────────────────────────────────────
//
// Append-only narrative thread per risk. Comments capture the
// risk's evolution over days/weeks alongside the structured
// fields. Read open to all roles. Write restricted to
// axis_admin / axis_ops (matches parent risk + steps gate).
// Delete restricted to comment author + axis_admin.

router.get('/:id/comments', requireAuth, (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  res.json({
    risk_id:    risk.id,
    risk_title: risk.title,
    comments:   riskComments.forRisk(risk.id),
  });
});

router.post('/:id/comments', requireRole(...WRITE_ROLES), (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  try {
    const c = riskComments.add({
      risk_id:    risk.id,
      body:       req.body?.body,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
      by_role:    req.user.role,
    });
    writeAudit({
      req,
      entity_type: 'risk_comment',
      entity_id:   String(c.id),
      action:      'create',
      summary:     `Comment on risk "${risk.title}": ${c.body.slice(0, 80)}${c.body.length > 80 ? '…' : ''}`,
      payload:     { risk_id: risk.id },
    });
    res.json({ comment: c });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/comments/:commentId', requireAuth, (req, res) => {
  const risk = findRiskOr404(req, res);
  if (!risk) return;
  const commentId = parseInt(req.params.commentId, 10);
  const existing = riskComments.findById(commentId);
  if (!existing || existing.risk_id !== risk.id) {
    return res.status(404).json({ error: 'Comment not found for this risk' });
  }
  // Author OR axis_admin can delete; otherwise 403.
  const isAuthor = existing.author?.user_id === req.user.id;
  const isAdmin  = req.user.role === 'axis_admin';
  if (!isAuthor && !isAdmin) {
    return res.status(403).json({ error: 'Only the comment author or an admin can delete' });
  }
  riskComments.remove(commentId);
  writeAudit({
    req,
    entity_type: 'risk_comment',
    entity_id:   String(commentId),
    action:      'delete',
    summary:     `Deleted comment on risk "${risk.title}"`,
    payload:     { risk_id: risk.id, by_admin: !isAuthor && isAdmin },
  });
  res.json({ deleted: true });
});

module.exports = router;
