'use strict';

/*
 * Schedule runner — Phase 105.
 *
 * Runs every minute via node-cron. For each active schedule whose
 * next_run_at is in the past, it:
 *   1. Generates the report PDF into a Buffer (no disk write, no HTTP stream).
 *   2. Emails the PDF to the schedule's recipient list via mailer.js.
 *   3. Updates last_run_at and advances next_run_at.
 *   4. Writes an audit-log entry.
 *
 * Concurrency: a simple in-memory set prevents two ticks from running the
 * same schedule simultaneously (e.g. if the generator is slow).
 *
 * Demo-mode mailer: when SMTP_HOST is not set the email is logged to the
 * console rather than sent — the runner still generates the PDF and advances
 * the schedule, so the whole flow can be verified without a mail server.
 */

const cron         = require('node-cron');
const { Writable } = require('stream');
const schedules    = require('../state/reportSchedules');
const { writeReport } = require('./reportBuilder');
const { sendReport, DEMO: mailerDemo } = require('./mailer');
const db = require('../db');

// Audit log insert — mirrors the pattern used in other Phase 25 routes.
let auditInsert;
try {
  auditInsert = db.prepare(`
    INSERT INTO audit_log (id, ts, actor_id, actor_display, action, entity_type, entity_id, summary)
    VALUES (lower(hex(randomblob(8))), @ts, @actor_id, @actor_display, @action, @entity_type, @entity_id, @summary)
  `);
} catch {
  auditInsert = null; // table not yet created — skip silently
}

function writeAudit({ entityId, summary, ok }) {
  if (!auditInsert) return;
  try {
    auditInsert.run({
      ts:            new Date().toISOString(),
      actor_id:      'system',
      actor_display: 'Schedule runner',
      action:        ok ? 'report_schedule_ran' : 'report_schedule_failed',
      entity_type:   'report_schedule',
      entity_id:     entityId,
      summary,
    });
  } catch { /* non-fatal */ }
}

// ── Period helpers ───────────────────────────────────────────────────────────

function periodMeta(schedule) {
  const now    = new Date();
  const isoNow = now.toISOString().slice(0, 10);

  if (schedule.frequency === 'daily') {
    return {
      period_from:  isoNow,
      period_to:    isoNow,
      period_label: `Daily · ${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    };
  }

  if (schedule.frequency === 'weekly') {
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay() + 1); // Monday
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return {
      period_from:  weekStart.toISOString().slice(0, 10),
      period_to:    weekEnd.toISOString().slice(0, 10),
      period_label: `Week · ${fmt(weekStart)}–${fmt(weekEnd)} ${weekEnd.getUTCFullYear()}`,
    };
  }

  if (schedule.frequency === 'monthly') {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth(); // 0-indexed
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd   = new Date(Date.UTC(y, m + 1, 0));
    const monthName  = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return {
      period_from:  monthStart.toISOString().slice(0, 10),
      period_to:    monthEnd.toISOString().slice(0, 10),
      period_label: `Month · ${monthName}`,
    };
  }

  // quarterly
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3);
  const qStart = new Date(Date.UTC(y, q * 3, 1));
  const qEnd   = new Date(Date.UTC(y, q * 3 + 3, 0));
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return {
    period_from:  qStart.toISOString().slice(0, 10),
    period_to:    qEnd.toISOString().slice(0, 10),
    period_label: `Q${q + 1} ${y} · ${fmt(qStart)}–${fmt(qEnd)}`,
  };
}

// ── PDF → Buffer ─────────────────────────────────────────────────────────────

function generatePdfBuffer(typeId, meta) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink   = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error',  reject);
    try {
      writeReport(typeId, meta, sink);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Core execute (single schedule) ───────────────────────────────────────────

const running = new Set(); // guard against overlapping executions

/**
 * runOne(schedule) — generate + email one schedule, then advance it.
 * Called by the cron tick and by the POST /schedules/:id/run route.
 * Throws on error so callers can handle it.
 */
async function runOne(s) {
  const now  = new Date();
  const meta = periodMeta(s);

  const pdfBuf   = await generatePdfBuffer(s.type_id, meta);
  const filename = `${s.type_id}_${meta.period_from}.pdf`;
  const subject  = `[AXIS] ${s.title} · ${meta.period_label}`;
  const text     = [
    `AXIS Command Center — automated report delivery`,
    ``,
    `Report : ${s.title}`,
    `Period : ${meta.period_label}`,
    ``,
    `Please find the ${s.title} PDF attached.`,
    `Generated from live corridor data on ${now.toUTCString()}.`,
    ``,
    `— AXIS Schedule Runner`,
    mailerDemo ? `(demo mode — SMTP not configured)` : '',
  ].join('\n');

  const recipients = s.recipients?.length ? s.recipients : ['axis-ops@axis-command.com'];
  await sendReport({ to: recipients, subject, text, pdfBuffer: pdfBuf, filename });

  const advanced = schedules.markRan(s.id);
  console.log(`[scheduler] ran "${s.title}" (${s.id}) → next ${advanced?.next_run_at ?? 'unknown'}`);
  writeAudit({ entityId: s.id, summary: `Ran "${s.title}" — sent to ${recipients.join(', ')} · next ${advanced?.next_run_at}`, ok: true });
  return advanced;
}

// ── Cron tick ─────────────────────────────────────────────────────────────────

async function tick() {
  const now = new Date();
  const due = schedules.list().filter(
    (s) => s.active && s.next_run_at && new Date(s.next_run_at) <= now,
  );

  for (const s of due) {
    if (running.has(s.id)) continue;
    running.add(s.id);
    runOne(s).catch((err) => {
      console.error(`[scheduler] FAILED "${s.title}" (${s.id}):`, err.message);
      writeAudit({ entityId: s.id, summary: `Failed: ${err.message}`, ok: false });
    }).finally(() => running.delete(s.id));
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function start() {
  // Run once immediately on boot to catch any schedules that fired while
  // the server was down, then tick every minute.
  tick().catch((err) => console.error('[scheduler] boot tick error:', err.message));
  cron.schedule('* * * * *', () => {
    tick().catch((err) => console.error('[scheduler] tick error:', err.message));
  });
  console.log(`[scheduler] started — checking every minute${mailerDemo ? ' (mailer: demo/log mode)' : ''}`);
}

module.exports = { start, tick, runOne };
