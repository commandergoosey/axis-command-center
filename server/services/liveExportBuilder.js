'use strict';

/*
 * Live export PDF builder — Phase 104.
 *
 * Generates server-side PDFs for live-export views:
 *   today_digest        — daily ops snapshot
 *   lender_pack         — DSCR / covenants / P&L for lender desk
 *   hauler_scorecard_*  — per-hauler weekly scorecard
 *
 * Same visual language as reportBuilder.js: Charcoal + Bone, Helvetica,
 * thin rules, small-caps section headers, tabular numbers.
 * Streams to the HTTP response — no disk writes.
 */

const PDFDocument = require('pdfkit');

const roster        = require('../state/roster');
const alertState    = require('../state/alertState');
const { aggregate, CONTRACT } = require('./aggregator');
const financials    = require('../mock/financials');
const { ALERTS }    = require('../mock/alerts');
const { TRIPS }     = require('../mock/trips');
const { FLEET }     = require('../mock/fleet');
const { ACTIVE_CONVOYS } = require('../mock/corridor');
const { DRIVERS }   = require('../mock/drivers');

const CHARCOAL = '#1F1F1F';
const IRON     = '#6B6763';
const RUST     = '#A23E23';
const HAIR     = '#CFC8BF';
const PAGE_OPTS = { size: 'A4', margin: 54 };

// ── Primitive helpers (mirrors reportBuilder) ────────────────────────

function fmtUsd(n, { k = false } = {}) {
  if (n == null) return '—';
  if (k) return `$${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `$${n.toLocaleString('en-US')}`;
}
function fmtTonnes(n) {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('en-US')} t`;
}
function fmtPct(n, digits = 1) {
  if (n == null) return '—';
  return `${n.toFixed(digits)}%`;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hrule(doc, y = doc.y, color = HAIR) {
  doc.save();
  doc.strokeColor(color).lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.restore();
  doc.y = y + 8;
}

function header(doc, { title, period, eyebrow = 'LIVE EXPORT' }) {
  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(CHARCOAL).text('AXIS', left, 36, { continued: true });
  doc.font('Helvetica').fontSize(9).fillColor(IRON)
    .text('   COMMAND CENTER · NYINAHIN–TAKORADI · 300 KM', { continued: false });
  doc.font('Helvetica').fontSize(9).fillColor(IRON)
    .text(`Generated ${fmtDate(new Date())} · Demonstration mode`, left, 52, { width: right - left, align: 'right' });
  hrule(doc, 72, CHARCOAL);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(RUST)
    .text(eyebrow.toUpperCase(), left, doc.y, { width: right - left, characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(CHARCOAL).text(title, left, doc.y, { width: right - left });
  doc.font('Helvetica').fontSize(10).fillColor(IRON).text(period, left, doc.y, { width: right - left });
  doc.moveDown(0.8);
}

function sectionHeader(doc, label) {
  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(RUST)
    .text(label.toUpperCase(), left, doc.y, { width: right - left, characterSpacing: 1.2 });
  hrule(doc, doc.y + 2);
  doc.moveDown(0.2);
}

function kv(doc, label, value, { bold = false } = {}) {
  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y     = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(IRON).text(label, left, y, { width: 260 });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(CHARCOAL)
    .text(value, left + 260, y, { width: right - left - 260, align: 'right' });
  doc.x = left; // reset — second text() leaves doc.x at left+260, drifting all subsequent primitives
  doc.moveDown(0.35);
}

function paragraph(doc, text, opts = {}) {
  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.font('Helvetica').fontSize(10).fillColor(CHARCOAL)
    .text(text, left, doc.y, { width: right - left, lineGap: 2, ...opts });
  doc.moveDown(0.3);
}

function table(doc, { columns, rows }) {
  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const totalFlex  = columns.reduce((s, c) => s + (c.flex || 1), 0);
  const colWidths  = columns.map((c) => (width * (c.flex || 1)) / totalFlex);
  let x = left;
  const headY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(IRON);
  columns.forEach((c, i) => {
    doc.text(c.label.toUpperCase(), x + 2, headY, { width: colWidths[i] - 4, align: c.align || 'left', characterSpacing: 0.8 });
    x += colWidths[i];
  });
  doc.x = left; // reset after header row — last column leaves doc.x at its offset
  doc.moveDown(0.3);
  hrule(doc, doc.y);
  rows.forEach((row) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    let xx = left;
    const rowY = doc.y;
    let maxH = 0;
    columns.forEach((c, i) => {
      const text = row[c.key] == null ? '' : String(row[c.key]);
      doc.font('Helvetica').fontSize(9).fillColor(row.tone === 'warn' ? RUST : CHARCOAL);
      const h = doc.heightOfString(text, { width: colWidths[i] - 4 });
      doc.text(text, xx + 2, rowY, { width: colWidths[i] - 4, align: c.align || 'left' });
      maxH = Math.max(maxH, h);
      xx += colWidths[i];
    });
    doc.y = rowY + maxH + 4;
    doc.x = left; // reset after each row
  });
  hrule(doc, doc.y);
}

function pruneBlanks(doc) {
  const BLANK = 40;
  const pages = doc._root.data.Pages.data;
  while (doc._pageBuffer.length > 1) {
    const last = doc._pageBuffer[doc._pageBuffer.length - 1];
    if ((last.content?.uncompressedLength ?? Infinity) > BLANK) break;
    doc._pageBuffer.pop();
    pages.Kids.pop();
    pages.Count -= 1;
  }
}

function footer(doc) {
  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - savedBottom + 12;
    doc.font('Helvetica').fontSize(8).fillColor(IRON)
      .text('AXIS Command Center · Live Export', left, y, { width: 250, lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(IRON)
      .text(`Page ${i + 1} of ${range.count}`, left, y, { width: right - left, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

// ── Today Digest ─────────────────────────────────────────────────────
function renderTodayDigest(doc) {
  const now = new Date();
  const agg = aggregate(roster.list());

  header(doc, {
    title:   'Today digest',
    period:  `${fmtDate(now)} · Daily ops snapshot · Nyinahin–Takoradi 300 km`,
    eyebrow: 'OPS · DAILY',
  });

  sectionHeader(doc, 'Corridor snapshot');
  kv(doc, 'Run-rate attainment',     fmtPct(agg.run_rate_pct) + ' (modelled)', { bold: true });
  kv(doc, 'Active convoys',          String(ACTIVE_CONVOYS.filter((c) => c.phase !== 'complete').length));
  kv(doc, 'Tonnes delivered · MTD',  fmtTonnes(agg.tonnes.delivered_mtd) + ' (modelled)');
  kv(doc, 'Revenue · MTD',           fmtUsd(agg.revenue_mtd_usd, { k: true }) + ' (modelled)');
  kv(doc, 'SLA attainment',          fmtPct(agg.sla_attainment_pct) + ' (modelled)');
  kv(doc, 'Active haulers',          String(roster.list().filter((h) => h.status === 'active').length) + ' of ' + roster.list().length);

  sectionHeader(doc, 'Active convoys');
  const active = ACTIVE_CONVOYS.filter((c) => c.phase !== 'complete').slice(0, 12);
  if (active.length === 0) {
    paragraph(doc, 'No active convoys on the corridor.');
  } else {
    table(doc, {
      columns: [
        { key: 'id',     label: 'Convoy', flex: 1.2 },
        { key: 'hauler', label: 'Hauler', flex: 1.8 },
        { key: 'phase',  label: 'Phase',  flex: 1 },
        { key: 'trucks', label: 'Trucks', flex: 0.7, align: 'right' },
        { key: 'km',     label: 'KM',     flex: 0.7, align: 'right' },
        { key: 'sched',  label: 'On time',flex: 0.9, align: 'right' },
      ],
      rows: active.map((c) => ({
        id:     c.id,
        hauler: roster.find(c.hauler_id)?.display_name || c.hauler_id,
        phase:  c.phase,
        trucks: String(c.trucks),
        km:     String(c.km),
        sched:  c.on_schedule ? '✓' : 'Delayed',
        tone:   c.on_schedule ? 'info' : 'warn',
      })),
    });
  }

  sectionHeader(doc, 'Open alerts · requiring action');
  const openAlerts = ALERTS
    .map((a) => ({ alert: a, state: alertState.getState(a.id) }))
    .filter(({ alert, state }) => (state.status_override ?? alert.status) === 'NEEDS_ACTION')
    .slice(0, 8);
  if (openAlerts.length === 0) {
    paragraph(doc, 'No alerts requiring action. Board is clear.');
  } else {
    table(doc, {
      columns: [
        { key: 'sev',    label: 'Severity', flex: 0.9 },
        { key: 'type',   label: 'Type',     flex: 1.1 },
        { key: 'title',  label: 'Title',    flex: 2.8 },
        { key: 'owner',  label: 'Assignee', flex: 1.2 },
      ],
      rows: openAlerts.map(({ alert, state }) => ({
        sev:   alert.severity,
        type:  alert.type,
        title: alert.title,
        owner: state.assignee_display || 'Unassigned',
        tone:  alert.severity === 'CRITICAL' ? 'warn' : 'info',
      })),
    });
  }

  sectionHeader(doc, 'Hauler performance · current week');
  table(doc, {
    columns: [
      { key: 'name',     label: 'Hauler',       flex: 2 },
      { key: 'status',   label: 'Status',       flex: 0.9 },
      { key: 'trucks',   label: 'Active trucks', flex: 1.2, align: 'right' },
      { key: 'tonnes',   label: 'Tonnes MTD',    flex: 1.3, align: 'right' },
      { key: 'sla',      label: 'SLA',           flex: 0.9, align: 'right' },
    ],
    rows: agg.haulers.map((h) => ({
      name:   h.display_name,
      status: h.status === 'active' ? 'Active' : 'Pending',
      trucks: `${h.fleet.active_trucks} / ${h.fleet.contracted_trucks}`,
      tonnes: fmtTonnes(h.tonnes_delivered_mtd),
      sla:    fmtPct(h.performance.sla_attainment_pct),
    })),
  });
}

// ── Lender Pack ───────────────────────────────────────────────────────
function renderLenderPack(doc) {
  const now = new Date();
  const agg = aggregate(roster.list());
  const covenants = financials.COVENANTS || [];

  header(doc, {
    title:   'Lender briefing pack',
    period:  `${fmtDate(now)} · Facility: $63M × 7y @ 9.25% · Counterparty: Ecobank Ghana`,
    eyebrow: 'GIBDLC LENDER · CREDIT COMMITTEE',
  });

  paragraph(doc,
    'Composed-live briefing prepared for the GIBDLC lender desk. All figures reflect the ' +
    'business-plan model (BRIEF §12.4). Reconciliation to audited accounts lands with the ' +
    'year-end pack. All figures marked (modelled).',
  );

  sectionHeader(doc, 'Debt service coverage');
  kv(doc, 'DSCR · current',            `${financials.DSCR.current.toFixed(2)}× (modelled)`, { bold: true });
  kv(doc, 'Covenant floor',            `${financials.DSCR.target_min.toFixed(2)}×`);
  kv(doc, 'Headroom',                  fmtPct(financials.DSCR.headroom_pct));
  kv(doc, 'Trailing 6-month average',  `${financials.DSCR.trailing_6m_avg.toFixed(2)}× (modelled)`);
  kv(doc, 'Steady-state target',       `${financials.DSCR.steady_state.toFixed(2)}× · Year 5`);

  if (covenants.length > 0) {
    sectionHeader(doc, 'Covenant compliance');
    table(doc, {
      columns: [
        { key: 'name',   label: 'Covenant',  flex: 2.5 },
        { key: 'metric', label: 'Metric',    flex: 1,   align: 'right' },
        { key: 'status', label: 'Status',    flex: 0.8, align: 'right' },
      ],
      rows: covenants.map((c) => ({
        name:   c.name,
        metric: c.metric,
        status: c.status,
        tone:   c.status === 'BREACH' ? 'warn' : 'info',
      })),
    });
  }

  sectionHeader(doc, 'P&L summary · month-to-date');
  kv(doc, 'Revenue',              fmtUsd(financials.PNL_MTD.revenue_usd) + ' (modelled)', { bold: true });
  kv(doc, 'Operating costs',     fmtUsd(financials.PNL_MTD.opex_usd));
  kv(doc, 'EBITDA',              fmtUsd(financials.PNL_MTD.ebitda_usd));
  kv(doc, 'Debt service',        fmtUsd(financials.PNL_MTD.debt_service_usd));
  kv(doc, 'Net cash (post DS)',  fmtUsd(financials.PNL_MTD.net_usd), { bold: true });

  sectionHeader(doc, 'Corridor run-rate');
  kv(doc, 'Tonnes delivered · MTD',   fmtTonnes(agg.tonnes.delivered_mtd) + ' (modelled)');
  kv(doc, 'Run-rate attainment',       fmtPct(agg.run_rate_pct) + ' (modelled)', { bold: true });
  kv(doc, 'SLA attainment',            fmtPct(agg.sla_attainment_pct) + ' (modelled)');
  kv(doc, 'Take-or-pay floor',         fmtPct(CONTRACT.take_or_pay_floor_pct * 100));
  kv(doc, 'Effective tariff',          '$24.36 / t (modelled)');

  sectionHeader(doc, 'Hauler ranking');
  table(doc, {
    columns: [
      { key: 'rank',    label: '#',          flex: 0.4, align: 'right' },
      { key: 'name',    label: 'Hauler',     flex: 2.2 },
      { key: 'tonnes',  label: 'Tonnes MTD', flex: 1.3, align: 'right' },
      { key: 'sla',     label: 'SLA',        flex: 0.9, align: 'right' },
      { key: 'dscr',    label: 'DSCR contr', flex: 1, align: 'right' },
    ],
    rows: agg.haulers
      .sort((a, b) => b.tonnes_delivered_mtd - a.tonnes_delivered_mtd)
      .map((h, i) => ({
        rank:   String(i + 1),
        name:   h.display_name,
        tonnes: fmtTonnes(h.tonnes_delivered_mtd),
        sla:    fmtPct(h.performance.sla_attainment_pct),
        dscr:   `${((h.tonnes_delivered_mtd / agg.tonnes.delivered_mtd) * financials.DSCR.current).toFixed(2)}×`,
      })),
  });

  paragraph(doc,
    'Receivables: standby letter of credit held at Ecobank Ghana for $4.8M (2.4 months run-rate). ' +
    'Outstanding > 30 days: $284,000 across two GIBDLC invoices — within SLC coverage.',
    { lineGap: 4 },
  );
}

// ── Hauler Scorecard ──────────────────────────────────────────────────
function renderHaulerScorecard(doc, haulerId) {
  const hauler = roster.find(haulerId);
  if (!hauler) throw new Error(`Hauler not found: ${haulerId}`);

  const now = new Date();
  const agg = aggregate([hauler]);
  const h   = agg.haulers.find((x) => x.id === haulerId) || agg.haulers[0];
  const haulerFleet   = FLEET.filter((t) => t.hauler_id === haulerId);
  const haulerDrivers = DRIVERS.filter((d) => d.hauler_id === haulerId);
  const haulerTrips   = TRIPS.filter((t) => t.hauler_id === haulerId).slice(0, 10);

  header(doc, {
    title:   `${hauler.display_name} · Weekly scorecard`,
    period:  `${fmtDate(now)} · Corridor · Nyinahin–Takoradi 300 km`,
    eyebrow: 'HAULER SCORECARD · WEEKLY',
  });

  sectionHeader(doc, 'Fleet summary');
  kv(doc, 'Contracted trucks',   String(haulerFleet.length));
  kv(doc, 'Active today',        String(haulerFleet.filter((t) => t.status === 'active' || t.status === 'in_transit').length), { bold: true });
  kv(doc, 'In garage',           String(haulerFleet.filter((t) => t.status === 'garage').length));
  kv(doc, 'Maintenance flagged', String(haulerFleet.filter((t) => t.maintenance_flag).length));
  kv(doc, 'Avg efficiency',      `${Math.round(haulerFleet.reduce((s, t) => s + t.efficiency_l_per_100km, 0) / (haulerFleet.length || 1) * 10) / 10} L/100km`);

  sectionHeader(doc, 'Drivers');
  kv(doc, 'Total drivers',     String(haulerDrivers.length));
  kv(doc, 'Rest breach',       String(haulerDrivers.filter((d) => d.rest_status === 'breach').length), { bold: haulerDrivers.filter((d) => d.rest_status === 'breach').length > 0 });
  kv(doc, 'Flagged',           String(haulerDrivers.filter((d) => d.flag).length));
  kv(doc, 'Avg safety score',  `${Math.round(haulerDrivers.reduce((s, d) => s + d.safety_score, 0) / (haulerDrivers.length || 1) * 10) / 10} / 100`);

  sectionHeader(doc, 'Performance · this week');
  if (h) {
    kv(doc, 'Tonnes delivered · MTD',  fmtTonnes(h.tonnes_delivered_mtd) + ' (modelled)', { bold: true });
    kv(doc, 'Contracted · MTD',        fmtTonnes(h.tonnes_contracted_mtd) + ' (modelled)');
    kv(doc, 'SLA attainment',          fmtPct(h.performance.sla_attainment_pct) + ' (modelled)', { bold: true });
    kv(doc, 'Active trucks',           `${h.fleet.active_trucks} / ${h.fleet.contracted_trucks}`);
  }

  if (haulerTrips.length > 0) {
    sectionHeader(doc, 'Recent trips');
    table(doc, {
      columns: [
        { key: 'id',      label: 'Trip',      flex: 1 },
        { key: 'route',   label: 'Route',     flex: 0.8 },
        { key: 'dir',     label: 'Dir',       flex: 0.5 },
        { key: 'tonnes',  label: 'Tonnes',    flex: 0.9, align: 'right' },
        { key: 'cycle',   label: 'Cycle h',   flex: 0.8, align: 'right' },
        { key: 'status',  label: 'Status',    flex: 0.9 },
      ],
      rows: haulerTrips.map((t) => ({
        id:     t.id,
        route:  t.route_id,
        dir:    t.direction === 'southbound' ? '↓' : '↑',
        tonnes: t.tonnage_t > 0 ? String(t.tonnage_t) : '—',
        cycle:  t.cycle_h.toFixed(1),
        status: t.status,
        tone:   t.status === 'delayed' ? 'warn' : 'info',
      })),
    });
  }

  paragraph(doc,
    `Scorecard generated ${fmtDate(now)} from live aggregator data. All modelled figures ` +
    'reconcile to the GIBDLC haulage contract (Nyinahin–Takoradi, 300 km). ' +
    'For operational queries contact AXIS Command Center.',
    { lineGap: 4 },
  );
}

// ── Entrypoint ────────────────────────────────────────────────────────
const LIVE_RENDERERS = {
  today_digest: (doc) => renderTodayDigest(doc),
  lender_pack:  (doc) => renderLenderPack(doc),
};

function writeLiveExport(exportId, stream) {
  let render;
  if (exportId === 'today_digest') {
    render = (doc) => renderTodayDigest(doc);
  } else if (exportId === 'lender_pack') {
    render = (doc) => renderLenderPack(doc);
  } else if (exportId.startsWith('hauler_scorecard_')) {
    const haulerId = exportId.replace('hauler_scorecard_', '');
    render = (doc) => renderHaulerScorecard(doc, haulerId);
  } else {
    throw new Error(`Unknown live export: ${exportId}`);
  }

  const doc = new PDFDocument({ ...PAGE_OPTS, bufferPages: true });
  doc.pipe(stream);
  render(doc);
  pruneBlanks(doc);
  footer(doc);
  doc.end();
}

module.exports = { writeLiveExport };
