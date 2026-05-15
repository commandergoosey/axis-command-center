'use strict';

/*
 * /api/reports — the Reports page backend.
 *
 *   GET  /api/reports                       → library + recent instances
 *   GET  /api/reports/:id                   → one library entry (not persisted)
 *   GET  /api/reports/download/:typeId      → live-generated PDF stream
 *     query: period_from=YYYY-MM-DD&period_to=YYYY-MM-DD&label=...
 *   POST /api/reports/generate              { type_id, period_from, period_to, label, recipients[] }
 *     Returns a synthetic instance receipt and unshifts it into RECENT.
 *
 * v1 instances live in server memory — Phase 10 gives them durable storage.
 */

const express = require('express');
const router = express.Router();

const { LIBRARY, RECENT } = require('../mock/reports');
const { writeReport } = require('../services/reportBuilder');
const { writeLiveExport } = require('../services/liveExportBuilder');
const reportAI = require('../services/reportAI');
const { requireRole } = require('../middleware/auth');
const reportRuns = require('../state/reportRuns');
const reportSchedules = require('../state/reportSchedules');
const roster = require('../state/roster');
const { writeAudit } = require('../db/audit');

// Phase 87 — live in-browser exports. Distinct from the LIBRARY
// (which is PDF generation) — these are printable cockpit views
// composed live from current state. Each entry's `path` is the
// route that renders the artifact; the client opens it in a new
// tab so Cmd-P / Ctrl-P saves it as a PDF directly from the
// browser.
function buildLiveExports() {
  const haulerEntries = roster.list()
    .filter((h) => h.status === 'active')
    .map((h) => ({
      id:          `hauler_scorecard_${h.id}`,
      title:       `Hauler scorecard · ${h.display_name}`,
      audience:    'AXIS ops · per-hauler review',
      cadence:     'Weekly · on demand',
      description: `Per-hauler weekly scorecard — trips, tonnes, margin, on-time, daily tonnage chart, lifecycle activity, audit tail. Print-friendly.`,
      path:        `/haulers/${h.id}/scorecard`,
      surface:     'hauler',
    }));

  return [
    {
      id:          'lender_pack',
      title:       'Lender briefing pack',
      audience:    'GIBDLC lender desk · credit committee',
      cadence:     'Monthly · on demand',
      description: 'Composed-live lender briefing — exec summary, DSCR, covenants table, capital + P&L, receivables ageing, take-or-pay forecast, hauler ranking, risk register with mitigation steps + comments. Single-page printable.',
      path:        '/lender/pack',
      surface:     'lender',
    },
    {
      id:          'today_digest',
      title:       'Today digest',
      audience:    'AXIS ops · end-of-shift',
      cadence:     'Daily · end of shift',
      description: 'Snapshot of today\'s briefing as a static printable — masthead, KPIs, dominant story, observations, action items, operations log, auto-cleared roll-up.',
      path:        '/today/digest',
      surface:     'ops',
    },
    ...haulerEntries,
  ];
}

const OPS_ROLES = ['axis_admin', 'axis_ops'];

function filenameFor(typeId, label) {
  const slug = (label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${typeId}_${slug || 'pack'}.pdf`;
}

router.get('/', (_req, res) => {
  // Persisted runs take priority; fixture RECENT entries pad the list for
  // demo mode so a fresh database still shows realistic history.
  const persisted = reportRuns.list();
  const persistedIds = new Set(persisted.map((r) => r.id));
  const recent = [
    ...persisted,
    ...RECENT.filter((r) => !persistedIds.has(r.id)),
  ];
  res.json({
    generated_at: new Date().toISOString(),
    library: LIBRARY,
    live_exports: buildLiveExports(),
    recent,
  });
});

// Phase 104 — server-side PDF for live exports. MUST be before /download/:typeId
// so Express doesn't match 'live' as a typeId param.
router.get('/download/live/:exportId', (req, res, next) => {
  try {
    const { exportId } = req.params;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${exportId}.pdf"`);
    writeLiveExport(exportId, res);
  } catch (err) {
    next(err);
  }
});

router.get('/download/:typeId', (req, res, next) => {
  try {
    const typeId = req.params.typeId;
    const entry = LIBRARY.find((l) => l.id === typeId);
    if (!entry) return res.status(404).json({ error: 'Unknown report type' });

    const label = req.query.label || `${entry.title} preview`;
    const periodFrom = req.query.period_from || null;
    const periodTo   = req.query.period_to   || null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filenameFor(typeId, label)}"`);

    writeReport(typeId, {
      period_label: label,
      period_from:  periodFrom,
      period_to:    periodTo,
    }, res);
  } catch (err) {
    next(err);
  }
});

router.post('/generate', requireRole(...OPS_ROLES), (req, res, next) => {
  try {
    const {
      type_id,
      period_from,
      period_to,
      label,
      recipients = [],
    } = req.body ?? {};
    const entry = LIBRARY.find((l) => l.id === type_id);
    if (!entry) return res.status(400).json({ error: 'Unknown report type' });
    if (!label)  return res.status(400).json({ error: 'label (string) is required' });

    const seedMax = Math.max(0, ...RECENT.map((r) => parseInt(r.id.replace(/^rpt-/, ''), 10) || 0));
    const nextNum = reportRuns.nextSeq(seedMax);
    const instance = {
      id: `rpt-${String(nextNum).padStart(3, '0')}`,
      type_id,
      title: `${entry.title} · ${label}`,
      period_label: label,
      period_from,
      period_to,
      status: 'DELIVERED',
      generated_at: new Date().toISOString(),
      generated_by: req.user ? `${req.user.organisation} · ${req.user.display_name}` : 'AXIS Ops · you',
      recipients: recipients.length ? recipients : entry.recipients_default,
      size_kb: 420 + Math.floor(Math.random() * 120),
      pages: entry.id === 'lender_quarterly' ? 11
           : entry.id === 'filings_pack'     ? 5
           : entry.id === 'shift_handover'   ? 3
           : 8,
      filename: filenameFor(type_id, label),
    };
    reportRuns.record(instance);
    writeAudit({
      req,
      entity_type: 'report',
      entity_id:   instance.id,
      action:      'generate',
      summary:     `Generated ${entry.title} · ${label}`,
      payload:     { type_id, period_from, period_to, recipients: instance.recipients },
    });
    res.status(201).json({
      generated_at: new Date().toISOString(),
      instance,
      download_url: `/api/reports/download/${type_id}?label=${encodeURIComponent(label)}` +
        (period_from ? `&period_from=${period_from}` : '') +
        (period_to   ? `&period_to=${period_to}`     : ''),
    });
  } catch (err) {
    next(err);
  }
});

// ── Schedules CRUD ────────────────────────────────────────────────────────────

router.get('/schedules', requireRole(...OPS_ROLES), (_req, res) => {
  res.json({ schedules: reportSchedules.list() });
});

router.post('/schedules', requireRole(...OPS_ROLES), (req, res) => {
  const { type_id, label_template, frequency, day_of_week, day_of_month, hour, recipients } = req.body ?? {};
  if (!type_id)    return res.status(400).json({ error: 'type_id is required' });
  if (!frequency)  return res.status(400).json({ error: 'frequency is required' });

  // Derive title from library entry
  const entry = LIBRARY.find((l) => l.id === type_id);
  const title = entry ? entry.title : type_id;
  const created_by = req.user ? `${req.user.organisation} · ${req.user.display_name}` : null;

  const schedule = reportSchedules.create({
    type_id, title, label_template, frequency,
    day_of_week:  day_of_week  ?? null,
    day_of_month: day_of_month ?? null,
    hour:         hour ?? 8,
    recipients:   recipients ?? [],
    created_by,
  });

  writeAudit({
    req,
    entity_type: 'report_schedule',
    entity_id:   schedule.id,
    action:      'create',
    summary:     `Scheduled ${title} · ${frequency}`,
    payload:     { type_id, frequency, recipients },
  });

  res.status(201).json({ schedule });
});

router.patch('/schedules/:id', requireRole(...OPS_ROLES), (req, res) => {
  const schedule = reportSchedules.update(req.params.id, req.body ?? {});
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  writeAudit({
    req,
    entity_type: 'report_schedule',
    entity_id:   schedule.id,
    action:      'update',
    summary:     `Updated schedule ${schedule.id}`,
    payload:     req.body,
  });
  res.json({ schedule });
});

router.delete('/schedules/:id', requireRole(...OPS_ROLES), (req, res) => {
  const ok = reportSchedules.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Schedule not found' });
  writeAudit({
    req,
    entity_type: 'report_schedule',
    entity_id:   req.params.id,
    action:      'delete',
    summary:     `Deleted schedule ${req.params.id}`,
    payload:     {},
  });
  res.status(204).end();
});

// POST /api/reports/schedules/:id/run — trigger a schedule immediately
router.post('/schedules/:id/run', requireRole(...OPS_ROLES), async (req, res, next) => {
  try {
    const schedule = reportSchedules.get(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    // Delegate to the runner's tick logic by calling it directly.
    const { runOne } = require('../services/scheduleRunner');
    await runOne(schedule);
    writeAudit({
      req,
      entity_type: 'report_schedule',
      entity_id:   schedule.id,
      action:      'run_now',
      summary:     `Manual run of schedule "${schedule.title}"`,
      payload:     {},
    });
    const updated = reportSchedules.get(schedule.id);
    res.json({ schedule: updated, message: 'Run triggered' });
  } catch (err) {
    next(err);
  }
});

// ── AI report generation ──────────────────────────────────────────────────────

router.post('/ai/generate', requireRole(...OPS_ROLES), async (req, res, next) => {
  try {
    const { prompt } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'prompt (string, ≥3 chars) is required' });
    }
    const { jobId, title } = await reportAI.generate(prompt.trim());
    res.status(202).json({
      jobId,
      title,
      download_url: `/api/reports/ai/download/${jobId}`,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/ai/download/:jobId', (req, res, next) => {
  try {
    const ok = reportAI.stream(req.params.jobId, res);
    if (!ok) return res.status(404).json({ error: 'Report not found or expired' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
