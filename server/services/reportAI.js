'use strict';

/*
 * AI report builder — Phase 104.
 *
 * Accepts a free-text user prompt describing what report they want.
 * Calls Claude to produce a structured JSON "report spec" then renders
 * that spec as a PDF using pdfkit and the shared AXIS design primitives.
 *
 * Spec shape (output schema Claude must return):
 * {
 *   title:    string,
 *   subtitle: string,          // date / period / context line
 *   sections: Section[]
 * }
 *
 * Section types:
 *   { type: 'kv',        heading: string, items: {key,value}[] }
 *   { type: 'table',     heading: string, cols: string[], rows: string[][] }
 *   { type: 'paragraph', heading: string, text: string }
 *   { type: 'rule' }
 *
 * Falls back to a stub report when ANTHROPIC_API_KEY is absent.
 */

const PDFDocument = require('pdfkit');

let Anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
} catch (_err) {
  Anthropic = null;
}

const roster        = require('../state/roster');
const alertState    = require('../state/alertState');
const { aggregate, CONTRACT } = require('./aggregator');
const financials    = require('../mock/financials');
const { TRIPS }     = require('../mock/trips');
const { FLEET }     = require('../mock/fleet');
const { DRIVERS }   = require('../mock/drivers');

// ── PDF design tokens (matches liveExportBuilder) ────────────────────────────
const CHARCOAL = '#1F1F1F';
const IRON     = '#6B6763';
const RUST     = '#A23E23';
const BONE     = '#FAF8F5';

const MARGIN = 48;
const PAGE_OPTS = {
  size:    'A4',
  margins: { top: 56, bottom: 56, left: MARGIN, right: MARGIN },
};

// ── in-memory job store ───────────────────────────────────────────────────────
// Keyed by jobId → Buffer. Cleaned up after 10 minutes.
const JOB_TTL_MS = 10 * 60 * 1000;
const jobs = new Map();

function storeJob(id, buffer) {
  jobs.set(id, { buffer, expires: Date.now() + JOB_TTL_MS });
  // cleanup stale jobs
  for (const [k, v] of jobs) {
    if (v.expires < Date.now()) jobs.delete(k);
  }
}

function getJob(id) {
  const entry = jobs.get(id);
  if (!entry) return null;
  if (entry.expires < Date.now()) { jobs.delete(id); return null; }
  return entry.buffer;
}

// ── data snapshot for context ─────────────────────────────────────────────────
function buildDataContext() {
  const agg   = aggregate(roster.list());
  const now   = new Date();
  const alerts = alertState.listWithTriage
    ? alertState.listWithTriage()
    : [];

  return {
    today_iso:  now.toISOString().slice(0, 10),
    corridor:   { name: 'Nyinahin–Takoradi', km: 300, counterparty: 'GIBDLC' },
    fleet:      agg.fleet,
    tonnes:     agg.tonnes,
    sla_pct:    agg.sla_attainment_pct,
    dscr:       financials.DSCR?.current ?? 1.31,
    haulers:    agg.haulers.map((h) => ({
      id:              h.id,
      name:            h.display_name,
      status:          h.status,
      active_trucks:   h.fleet.active_trucks,
      contracted:      h.fleet.contracted_trucks,
      mtd_delivered:   h.tonnes_delivered_mtd,
      mtd_contracted:  h.tonnes_contracted_mtd,
      sla:             h.performance.sla_attainment_pct,
      on_time_pct:     h.performance.on_time_pct,
    })),
    contract: {
      base_tariff_usd_per_tonne: CONTRACT.base_tariff_usd_per_tonne,
      take_or_pay_floor_pct:     (CONTRACT.take_or_pay_floor_pct ?? 0.8) * 100,
    },
    recent_trips: (TRIPS ?? []).slice(0, 10).map((t) => ({
      id:       t.id,
      hauler:   t.hauler_id,
      status:   t.status,
      tonnes:   t.tonnes_gross ?? t.payload_tonnes,
      date:     t.departed_at ?? t.created_at,
    })),
    fleet_summary: (FLEET ?? []).slice(0, 8).map((f) => ({
      rig:     f.rig_id,
      hauler:  f.hauler_id,
      status:  f.status,
      km:      f.odometer_km,
    })),
    active_alerts: (alerts ?? []).filter((a) => a.status_override !== 'RESOLVED').slice(0, 5).map((a) => ({
      id:       a.id,
      severity: a.severity,
      title:    a.title,
    })),
  };
}

// ── prompt ────────────────────────────────────────────────────────────────────
const MODEL = 'claude-haiku-4-5';

function buildSystemPrompt(ctx) {
  return `You are the AXIS Report Builder for the Nyinahin–Takoradi bauxite haulage project in Ghana (GIBDLC contract).

Your task: given a user request, produce a JSON report specification that will be rendered as a professional PDF report.

OUTPUT FORMAT — respond ONLY with valid JSON, no markdown fences, no prose:
{
  "title": "...",
  "subtitle": "...",
  "sections": [
    { "type": "kv", "heading": "...", "items": [{"key":"...", "value":"..."}] },
    { "type": "table", "heading": "...", "cols": ["col1","col2"], "rows": [["v1","v2"]] },
    { "type": "paragraph", "heading": "...", "text": "..." },
    { "type": "rule" }
  ]
}

RULES:
- Use only section types: kv, table, paragraph, rule
- Maximum 4 sections. Keep it concise.
- Values must be strings. Numbers should include units (e.g. "28.4 t", "96.2%", "$24.36/t").
- Derive data from the context below. Do not invent numbers.
- paragraph text: max 80 words, port-authority notice tone — specific, terse, named entities, named figures.
- Banned words: solutions, innovative, leverage, synergy, ecosystem, excited, empower.
- title: max 8 words. subtitle: current date + brief scope.

LIVE DATA CONTEXT:
${JSON.stringify(ctx, null, 2)}`;
}

// ── Claude spec generation ────────────────────────────────────────────────────
async function generateSpec(prompt, ctx) {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) {
    return buildFallbackSpec(prompt, ctx);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const msg = await client.messages.create({
      model:      MODEL,
      max_tokens: 1024,
      system:     buildSystemPrompt(ctx),
      messages:   [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0]?.text ?? '';
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[reportAI] Claude call failed:', err.message);
    return buildFallbackSpec(prompt, ctx);
  }
}

function buildFallbackSpec(prompt, ctx) {
  const h = ctx.haulers?.[0] ?? {};
  return {
    title:    'Corridor Status Report',
    subtitle: `${ctx.today_iso} · AI report · demonstration mode`,
    sections: [
      {
        type:    'paragraph',
        heading: 'Note',
        text:    'ANTHROPIC_API_KEY is not configured. This is a demonstration report with live data but AI composition is unavailable.',
      },
      {
        type:    'kv',
        heading: 'Corridor snapshot',
        items:   [
          { key: 'Active trucks',     value: String(ctx.fleet?.active_trucks ?? '—') },
          { key: 'MTD delivered',     value: `${ctx.tonnes?.delivered_mtd ?? '—'} t` },
          { key: 'SLA attainment',    value: `${ctx.sla_pct ?? '—'}%` },
          { key: 'Base tariff',       value: `$${ctx.contract?.base_tariff_usd_per_tonne ?? '—'}/t` },
        ],
      },
      {
        type:    'table',
        heading: 'Hauler performance',
        cols:    ['Hauler', 'Active trucks', 'MTD delivered', 'SLA %'],
        rows:    (ctx.haulers ?? []).map((h) => [
          h.name,
          String(h.active_trucks),
          `${h.mtd_delivered ?? 0} t`,
          `${h.sla ?? 0}%`,
        ]),
      },
    ],
  };
}

// ── PDF render from spec ──────────────────────────────────────────────────────
function specToPdf(spec, stream) {
  const doc = new PDFDocument({ ...PAGE_OPTS, bufferPages: true });
  doc.pipe(stream);

  const lm = PAGE_OPTS.margins.left;
  const pw = doc.page.width - PAGE_OPTS.margins.left - PAGE_OPTS.margins.right;

  // Header band
  doc.rect(0, 0, doc.page.width, 40).fill(CHARCOAL);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BONE)
    .text('AXIS COMMAND CENTER', lm, 13, { characterSpacing: 1.2, lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(RUST)
    .text('AI REPORT', doc.page.width - PAGE_OPTS.margins.right - 80, 13,
      { width: 80, align: 'right', lineBreak: false, characterSpacing: 0.8 });

  let y = PAGE_OPTS.margins.top + 16;

  // Title
  doc.font('Helvetica-Bold').fontSize(18).fillColor(CHARCOAL)
    .text(spec.title ?? 'Report', lm, y, { width: pw });
  y = doc.y + 4;

  // Subtitle
  doc.font('Helvetica').fontSize(10).fillColor(IRON)
    .text(spec.subtitle ?? '', lm, y, { width: pw });
  y = doc.y + 14;

  // Thin rule
  doc.moveTo(lm, y).lineTo(lm + pw, y).strokeColor(IRON).lineWidth(0.4).stroke();
  y += 16;

  // Sections
  for (const section of (spec.sections ?? [])) {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = PAGE_OPTS.margins.top;
    }

    if (section.type === 'rule') {
      doc.moveTo(lm, y).lineTo(lm + pw, y).strokeColor(IRON).lineWidth(0.2).stroke();
      y += 12;
      continue;
    }

    if (section.heading) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(IRON)
        .text(section.heading.toUpperCase(), lm, y, { characterSpacing: 0.8 });
      y = doc.y + 4;
    }

    if (section.type === 'kv') {
      const items = section.items ?? [];
      const colW = pw / 2;
      for (let i = 0; i < items.length; i += 2) {
        const left  = items[i];
        const right = items[i + 1];
        const rowY  = y;
        doc.font('Helvetica').fontSize(8.5).fillColor(IRON)
          .text(left?.key ?? '', lm, rowY, { width: colW * 0.45, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CHARCOAL)
          .text(left?.value ?? '', lm + colW * 0.46, rowY, { width: colW * 0.5, lineBreak: false });
        if (right) {
          doc.font('Helvetica').fontSize(8.5).fillColor(IRON)
            .text(right.key, lm + colW, rowY, { width: colW * 0.45, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CHARCOAL)
            .text(right.value, lm + colW + colW * 0.46, rowY, { width: colW * 0.5, lineBreak: false });
        }
        y = rowY + 14;
      }
    }

    if (section.type === 'table') {
      const cols = section.cols ?? [];
      const rows = section.rows ?? [];
      const colW = pw / Math.max(cols.length, 1);

      // Header row
      doc.rect(lm, y, pw, 16).fill('#EEEBE6');
      cols.forEach((col, ci) => {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(IRON)
          .text(col.toUpperCase(), lm + ci * colW + 4, y + 4,
            { width: colW - 8, lineBreak: false, characterSpacing: 0.4 });
      });
      y += 16;

      rows.forEach((row, ri) => {
        if (y > doc.page.height - 80) { doc.addPage(); y = PAGE_OPTS.margins.top; }
        if (ri % 2 === 0) doc.rect(lm, y, pw, 14).fill('#F7F4F0');
        row.forEach((cell, ci) => {
          doc.font('Helvetica').fontSize(8).fillColor(CHARCOAL)
            .text(String(cell ?? ''), lm + ci * colW + 4, y + 3,
              { width: colW - 8, lineBreak: false });
        });
        y += 14;
      });
    }

    if (section.type === 'paragraph') {
      doc.font('Helvetica').fontSize(9).fillColor(CHARCOAL)
        .text(section.text ?? '', lm, y, { width: pw, lineGap: 2 });
      y = doc.y;
    }

    y += 18;
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - savedBottom + 12;
    doc.font('Helvetica').fontSize(8).fillColor(IRON)
      .text('AXIS Command Center · AI Report', lm, fy, { width: 200, lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(IRON)
      .text(`Page ${i + 1} of ${range.count}`,
        lm, fy,
        { width: doc.page.width - PAGE_OPTS.margins.right - lm, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Generate an AI report from a prompt.
 * Returns { jobId, title } immediately after PDF is buffered.
 */
async function generate(prompt) {
  const ctx  = buildDataContext();
  const spec = await generateSpec(prompt, ctx);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const { Writable } = require('stream');
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    });
    sink.on('finish', () => {
      const buf   = Buffer.concat(chunks);
      const jobId = `ai-${Date.now().toString(36)}`;
      storeJob(jobId, buf);
      resolve({ jobId, title: spec.title ?? 'AI Report' });
    });
    sink.on('error', reject);
    specToPdf(spec, sink);
  });
}

/**
 * Stream a buffered job to an HTTP response.
 * Returns false if the job is not found or expired.
 */
function stream(jobId, res) {
  const buf = getJob(jobId);
  if (!buf) return false;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="axis-ai-report-${jobId}.pdf"`);
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
  return true;
}

module.exports = { generate, stream };
