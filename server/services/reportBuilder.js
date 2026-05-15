'use strict';

/*
 * Report builder — generates the three Phase 8 report PDFs as streams using
 * pdfkit. Institutional chrome: Helvetica, Charcoal type on Bone, thin
 * rules, small-caps section headers, tabular right-aligned numbers. Every
 * modelled figure is followed by "(modelled)" to match the UI's MODELLED
 * tag convention (BRIEF §12.4).
 *
 * Streams straight to the HTTP response — no disk writes, no caching.
 */

const PDFDocument = require('pdfkit');

const roster                = require('../state/roster');
const alertState            = require('../state/alertState');
const { aggregate, CONTRACT } = require('./aggregator');

const financials = require('../mock/financials');
const contract   = require('../mock/contract');
const compliance = require('../mock/compliance');
const { ALERTS } = require('../mock/alerts');
const { ACTIVE_CONVOYS } = require('../mock/corridor');
const { TRIPS }  = require('../mock/trips');
const { FLEET }  = require('../mock/fleet');

const CHARCOAL = '#1F1F1F';
const IRON     = '#6B6763';
const RUST     = '#A23E23';
const HAIR     = '#CFC8BF';

const PAGE_OPTS = { size: 'A4', margin: 54 }; // 54pt ≈ 19mm

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

// ── Primitives ───────────────────────────────────────────────────────
function hrule(doc, y = doc.y, color = HAIR) {
  doc.save();
  doc.strokeColor(color).lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.restore();
  doc.y = y + 8;
}

function header(doc, { title, period }) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(CHARCOAL).text('AXIS', left, 36, { continued: true });
  doc.font('Helvetica').fontSize(9).fillColor(IRON)
    .text('   COMMAND CENTER · NYINAHIN–TAKORADI · 300 KM', { continued: false });
  doc.font('Helvetica').fontSize(9).fillColor(IRON)
    .text(`Generated ${fmtDate(new Date())} · Demonstration mode`, left, 52, { width: right - left, align: 'right' });
  hrule(doc, 72, CHARCOAL);
  doc.moveDown(0.5);
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
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y;
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
  const totalFlex = columns.reduce((s, c) => s + (c.flex || 1), 0);
  const colWidths = columns.map((c) => (width * (c.flex || 1)) / totalFlex);
  // Header row
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
  // Body rows
  rows.forEach((row) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
    }
    let xx = left;
    const rowY = doc.y;
    let maxHeight = 0;
    columns.forEach((c, i) => {
      const val = row[c.key];
      const text = val == null ? '' : String(val);
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .fillColor(c.tone === 'warn' ? RUST : CHARCOAL);
      const h = doc.heightOfString(text, { width: colWidths[i] - 4, align: c.align || 'left' });
      doc.text(text, xx + 2, rowY, { width: colWidths[i] - 4, align: c.align || 'left' });
      maxHeight = Math.max(maxHeight, h);
      xx += colWidths[i];
    });
    doc.y = rowY + maxHeight + 4;
    doc.x = left; // reset after each row
  });
  hrule(doc, doc.y);
}

// Strip trailing blank pages before the footer loop runs.
// A blank page has ≤ 40 bytes of uncompressed content (just PDF page-init
// operators, no text or graphics). pdfkit adds them when text() calls trigger
// an auto-page-break at the very end of the last content section.
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
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Temporarily zero the bottom margin so pdfkit doesn't auto-page-break
    // when we render footer text in the margin zone (below maxY).
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - savedBottom + 12;
    doc.font('Helvetica').fontSize(8).fillColor(IRON)
      .text('AXIS Command Center', left, y, { width: 200, lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(IRON)
      .text(`Page ${i + 1} of ${range.count}`, left, y, { width: right - left, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

// ── GIBDLC monthly pack ──────────────────────────────────────────────
function renderGibdlcMonthly(doc, { period_from, period_to, period_label }) {
  const agg = aggregate(roster.list());
  const contractedMonthly = Math.round(CONTRACT.target_mtpa * 1_000_000 / 12);
  const floorMonthly = Math.round(contractedMonthly * CONTRACT.take_or_pay_floor_pct);
  const deliveredMtd = agg.tonnes.delivered_mtd;
  const attainmentPct = (deliveredMtd / contractedMonthly) * 100;
  const floorDeficit = floorMonthly - deliveredMtd;

  header(doc, {
    title: 'GIBDLC monthly pack',
    period: `Period · ${period_label}  ·  Contract · Nyinahin–Takoradi 300 km  ·  Counterparty · GIBDLC`,
  });

  paragraph(doc,
    'This pack reports performance under the ten-year haulage contract with GIBDLC under GIADEC oversight. ' +
    'Take-or-pay floor sits at 80% of contracted monthly tonnage; tariff is indexed monthly to NPA diesel (40%) ' +
    'and Ghana CPI (30%), with 30% fixed in USD.',
  );

  sectionHeader(doc, 'Take-or-pay posture');
  kv(doc, 'Contracted tonnage · month',       `${contractedMonthly.toLocaleString()} t (modelled)`);
  kv(doc, 'Take-or-pay floor (80%)',           `${floorMonthly.toLocaleString()} t (modelled)`);
  kv(doc, 'Delivered · MTD',                   fmtTonnes(deliveredMtd) + ' (modelled)', { bold: true });
  kv(doc, 'Attainment vs contracted',          fmtPct(attainmentPct) + ' (modelled)');
  kv(doc,
    floorDeficit > 0 ? 'Floor deficit' : 'Floor cushion',
    `${floorDeficit > 0 ? '−' : '+'}${Math.abs(floorDeficit).toLocaleString()} t (modelled)`,
    { bold: true },
  );

  sectionHeader(doc, 'SLA attainment');
  kv(doc, 'Loading on-time',       `${contract.SLA_BREAKDOWN.loading_on_time_pct}% (target 90%)`);
  kv(doc, 'Offloading on-time',    `${contract.SLA_BREAKDOWN.offloading_on_time_pct}% (target 90%)`);
  kv(doc, 'Cycle completion',      `${contract.SLA_BREAKDOWN.cycle_completion_pct}% (target 90%)`);
  kv(doc, 'Corridor-weighted SLA', fmtPct(agg.sla_attainment_pct) + ' (modelled)', { bold: true });

  sectionHeader(doc, 'Hauler contribution');
  table(doc, {
    columns: [
      { key: 'name',        label: 'Hauler',         flex: 2 },
      { key: 'status',      label: 'Status',         flex: 1 },
      { key: 'trucks',      label: 'Trucks',         flex: 1, align: 'right' },
      { key: 'delivered',   label: 'Delivered MTD',  flex: 1.5, align: 'right' },
      { key: 'contracted',  label: 'Contracted MTD', flex: 1.5, align: 'right' },
      { key: 'sla',         label: 'SLA',            flex: 1, align: 'right' },
    ],
    rows: agg.haulers.map((h) => ({
      name:        h.display_name,
      status:      h.status === 'active' ? 'Active' : 'Pending',
      trucks:      `${h.fleet.active_trucks} / ${h.fleet.contracted_trucks}`,
      delivered:   fmtTonnes(h.tonnes_delivered_mtd),
      contracted:  fmtTonnes(h.tonnes_contracted_mtd),
      sla:         fmtPct(h.performance.sla_attainment_pct),
    })),
  });

  sectionHeader(doc, 'Axle-load record · trailing 30 days');
  const holds = compliance.OVERLOAD_BY_HAULER.reduce((s, r) => s + r.holds, 0);
  const warnings = compliance.OVERLOAD_BY_HAULER.reduce((s, r) => s + r.warnings, 0);
  const costUsd = compliance.OVERLOAD_BY_HAULER.reduce((s, r) => s + r.cost_usd, 0);
  kv(doc, 'Weighbridge holds', String(holds));
  kv(doc, 'Warnings (within tolerance)', String(warnings));
  kv(doc, 'Opportunity cost · off-loads', fmtUsd(costUsd), { bold: true });
  doc.moveDown(0.2);
  table(doc, {
    columns: [
      { key: 'hauler',  label: 'Hauler',   flex: 2 },
      { key: 'holds',   label: 'Holds',    flex: 1, align: 'right' },
      { key: 'warn',    label: 'Warnings', flex: 1, align: 'right' },
      { key: 'delay',   label: 'Delay min',flex: 1.2, align: 'right' },
      { key: 'cost',    label: 'Cost',     flex: 1.2, align: 'right' },
    ],
    rows: compliance.OVERLOAD_BY_HAULER.map((r) => {
      const h = roster.find(r.hauler_id);
      return {
        hauler: h?.display_name || r.hauler_id,
        holds:  String(r.holds),
        warn:   String(r.warnings),
        delay:  String(r.delay_min_total),
        cost:   fmtUsd(r.cost_usd),
      };
    }),
  });

  sectionHeader(doc, 'Invoice summary');
  paragraph(doc,
    'Invoices raised on a fortnightly cycle per the master services agreement. ' +
    'Payment terms T+30; standby letter of credit held at Ecobank Ghana for $4.8M, ' +
    'covering 2.4 months of tariff at run-rate. Receivables ageing is reported in the lender pack.',
  );
  kv(doc, 'Tariff · effective (April reindex)', '$24.36 / t (modelled)');
  kv(doc, 'Revenue · MTD',                       fmtUsd(financials.PNL_MTD.revenue_usd) + ' (modelled)', { bold: true });
  kv(doc, 'Outstanding · > 30 days',             '$284,000 across two GIBDLC invoices');
}

// ── Lender quarterly pack ────────────────────────────────────────────
function renderLenderQuarterly(doc, { period_from, period_to, period_label }) {
  header(doc, {
    title: 'Lender quarterly pack',
    period: `Period · ${period_label}  ·  Facility · $63M × 7y @ 9.25%  ·  Counterparty · Ecobank Ghana`,
  });

  paragraph(doc,
    'Prepared under the side letter to the senior secured facility. All four covenants below must hold ' +
    'month-on-month for continued drawdown eligibility. Figures reflect the business-plan model (BRIEF §12.4); ' +
    'reconciliation to audited accounts lands with the year-end pack.',
  );

  sectionHeader(doc, 'Debt service coverage');
  kv(doc, 'DSCR · current',             `${financials.DSCR.current.toFixed(2)}× (modelled)`, { bold: true });
  kv(doc, 'Covenant floor',             `${financials.DSCR.target_min.toFixed(2)}×`);
  kv(doc, 'Headroom',                   fmtPct(financials.DSCR.headroom_pct));
  kv(doc, 'Trailing 6-month average',   `${financials.DSCR.trailing_6m_avg.toFixed(2)}× (modelled)`);
  kv(doc, 'Steady-state target',        `${financials.DSCR.steady_state.toFixed(2)}× · Year 5`);

  sectionHeader(doc, 'Covenant compliance');
  table(doc, {
    columns: [
      { key: 'name',   label: 'Covenant',  flex: 2.4 },
      { key: 'metric', label: 'Metric',    flex: 1,   align: 'right' },
      { key: 'status', label: 'Status',    flex: 0.8, align: 'right' },
    ],
    rows: financials.COVENANTS.map((c) => ({
      name:   c.name,
      metric: c.metric,
      status: c.status,
    })),
  });

  sectionHeader(doc, 'Profit & loss · MTD and YTD');
  const pnlLines = [
    ['Revenue',         financials.PNL_MTD.revenue_usd,         financials.PNL_YTD.revenue_usd],
    ['Operating costs', -financials.PNL_MTD.operating_costs_usd,-financials.PNL_YTD.operating_costs_usd],
    ['EBITDA',          financials.PNL_MTD.ebitda_usd,           financials.PNL_YTD.ebitda_usd],
    ['Depreciation',   -financials.PNL_MTD.depreciation_usd,    -financials.PNL_YTD.depreciation_usd],
    ['Interest',       -financials.PNL_MTD.interest_usd,        -financials.PNL_YTD.interest_usd],
    ['EBIT',            financials.PNL_MTD.ebit_usd,             financials.PNL_YTD.ebit_usd],
    ['Net income',      financials.PNL_MTD.net_income_usd,       financials.PNL_YTD.net_income_usd],
  ];
  table(doc, {
    columns: [
      { key: 'line', label: 'Line',                 flex: 2 },
      { key: 'mtd',  label: financials.PNL_MTD.period, flex: 1.3, align: 'right' },
      { key: 'ytd',  label: financials.PNL_YTD.period, flex: 1.3, align: 'right' },
    ],
    rows: pnlLines.map(([line, mtd, ytd]) => ({
      line,
      mtd: mtd < 0 ? `(${fmtUsd(Math.abs(mtd), { k: true }).slice(1)})` : fmtUsd(mtd, { k: true }),
      ytd: ytd < 0 ? `(${fmtUsd(Math.abs(ytd), { k: true }).slice(1)})` : fmtUsd(ytd, { k: true }),
    })),
  });

  sectionHeader(doc, 'Cashflow forecast · 13 weeks');
  const weeks = financials.CASHFLOW_FORECAST.slice(0, 13);
  const closingCash = weeks[weeks.length - 1]?.closing_cash_usd;
  const openingCash = weeks[0]?.closing_cash_usd - weeks[0]?.net_usd;
  kv(doc, 'Opening cash',           fmtUsd(openingCash, { k: true }) + ' (modelled)');
  kv(doc, 'Closing cash · week 13', fmtUsd(closingCash, { k: true }) + ' (modelled)', { bold: true });
  kv(doc, 'Debt service cadence',   'Every four weeks · flagged in week column');
  doc.moveDown(0.2);
  table(doc, {
    columns: [
      { key: 'wk',       label: 'Week',      flex: 1 },
      { key: 'inflow',   label: 'Inflow',    flex: 1, align: 'right' },
      { key: 'outflow',  label: 'Outflow',   flex: 1, align: 'right' },
      { key: 'net',      label: 'Net',       flex: 1, align: 'right' },
      { key: 'close',    label: 'Cash close',flex: 1.2, align: 'right' },
    ],
    rows: weeks.map((w) => ({
      wk:      w.week.replace(/^\d+-/, '') + (w.note ? ' · ' + w.note : ''),
      inflow:  fmtUsd(w.inflow_usd, { k: true }),
      outflow: `(${fmtUsd(w.outflow_usd, { k: true }).slice(1)})`,
      net:     (w.net_usd < 0 ? '(' : '') + fmtUsd(Math.abs(w.net_usd), { k: true }) + (w.net_usd < 0 ? ')' : ''),
      close:   fmtUsd(w.closing_cash_usd, { k: true }),
    })),
  });
}

// ── Regulatory filings pack ──────────────────────────────────────────
function renderFilingsPack(doc, { period_from, period_to, period_label }) {
  header(doc, {
    title: 'Regulatory filings pack',
    period: `Period · ${period_label}  ·  Agencies · GIADEC · DVLA · GHA · Minerals Commission · EPA`,
  });

  paragraph(doc,
    'Bundle of regulatory filings and supporting evidence for the period. Attached to every GIADEC ' +
    'quarterly review and held on file for the lender. All filings referenced here carry their ' +
    'agency submission receipt.',
  );

  sectionHeader(doc, 'Filing status');
  table(doc, {
    columns: [
      { key: 'agency', label: 'Agency',  flex: 1.3 },
      { key: 'detail', label: 'Filing',  flex: 3.2 },
      { key: 'due',    label: 'Due',     flex: 1 },
      { key: 'status', label: 'Status',  flex: 0.8, align: 'right' },
    ],
    rows: compliance.FILINGS.map((f) => ({
      agency: f.agency,
      detail: f.detail,
      due:    fmtDate(f.due),
      status: f.status,
    })),
  });

  sectionHeader(doc, 'HSE summary · trailing 90 days');
  kv(doc, 'HSE events per MTK · current', `${compliance.HSE.current_per_mtk} (target ≤ ${compliance.HSE.target_per_mtk})`, { bold: true });
  kv(doc, 'Trailing 90-day events', String(compliance.HSE.trailing_events_90d));
  doc.moveDown(0.2);
  table(doc, {
    columns: [
      { key: 'date',     label: 'Date',      flex: 1 },
      { key: 'hauler',   label: 'Hauler',    flex: 1.2 },
      { key: 'cat',      label: 'Cat',       flex: 0.6 },
      { key: 'type',     label: 'Type',      flex: 2 },
      { key: 'km',       label: 'KM',        flex: 0.6, align: 'right' },
      { key: 'note',     label: 'Note',      flex: 3 },
    ],
    rows: compliance.HSE.events.map((e) => {
      const h = roster.find(e.hauler_id);
      return {
        date:   fmtDate(e.date),
        hauler: h?.display_name || e.hauler_id,
        cat:    e.category,
        type:   e.type,
        km:     String(e.km_marker),
        note:   e.note || '',
      };
    }),
  });

  sectionHeader(doc, 'Axle-load record · LI 2180');
  const holds = compliance.OVERLOAD_BY_HAULER.reduce((s, r) => s + r.holds, 0);
  const warnings = compliance.OVERLOAD_BY_HAULER.reduce((s, r) => s + r.warnings, 0);
  kv(doc, 'Weighbridge holds · trailing 30d', String(holds));
  kv(doc, 'Warnings (within tolerance)',       String(warnings));
  kv(doc, 'Statutory GVW limit',               '60.0 t (LI 2180; ~40 t payload)');

  sectionHeader(doc, 'Driver licence pipeline · 90 days');
  table(doc, {
    columns: [
      { key: 'driver',  label: 'Driver',   flex: 1.2 },
      { key: 'hauler',  label: 'Hauler',   flex: 1.2 },
      { key: 'doc',     label: 'Document', flex: 2 },
      { key: 'expiry',  label: 'Expiry',   flex: 1 },
      { key: 'days',    label: 'Days',     flex: 0.7, align: 'right' },
    ],
    rows: compliance.LICENCE_EXPIRY.map((l) => {
      const h = roster.find(l.hauler_id);
      return {
        driver: l.driver,
        hauler: h?.display_name || l.hauler_id,
        doc:    l.document,
        expiry: fmtDate(l.expiry),
        days:   String(l.days_remaining),
        tone:   l.days_remaining < 30 ? 'warn' : 'info',
      };
    }),
  });
}

// ── Shift handover brief ─────────────────────────────────────────────
function fmtClock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + 'Z';
}

function isSameUtcDay(iso, ymd) {
  if (!iso) return false;
  return iso.slice(0, 10) === ymd;
}

function renderShiftHandover(doc, { period_label }) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const shiftLabel = period_label || `Shift ending ${fmtDate(new Date())}`;

  header(doc, {
    title: 'Shift handover brief',
    period: `${shiftLabel}  ·  Controller on-call  ·  Corridor · Nyinahin–Takoradi 300 km`,
  });

  paragraph(doc,
    'End-of-shift handover for the oncoming controller. Convoys moved today, alerts triaged in-shift, ' +
    'maintenance close-outs, and anything still open. Pair this with the live board; use for the ' +
    'oral brief and file with the daily log.',
  );

  // ── Summary tile ─────────────────────────────────────
  const convoysToday = ACTIVE_CONVOYS.filter((c) => isSameUtcDay(c.last_ping_iso, todayYmd));
  const convoysOnTime = convoysToday.filter((c) => c.on_schedule).length;
  const convoysDelayed = convoysToday.filter((c) => !c.on_schedule).length;

  const tripsToday = TRIPS.filter((t) => isSameUtcDay(t.arrived_at, todayYmd));
  const laden = tripsToday.filter((t) => t.direction === 'southbound');
  const tonnesToday = laden.reduce((s, t) => s + t.tonnage_t, 0);
  const revenueToday = laden.reduce((s, t) => s + t.revenue_usd, 0);

  const resolvedToday = ALERTS
    .map((a) => ({ alert: a, state: alertState.getState(a.id) }))
    .filter(({ state }) => state.status_override === 'RESOLVED'
                        && isSameUtcDay(state.resolved_at_iso, todayYmd));
  const openAtHandover = ALERTS
    .map((a) => ({ alert: a, state: alertState.getState(a.id) }))
    .filter(({ alert, state }) => {
      const status = state.status_override ?? alert.status;
      return status === 'NEEDS_ACTION';
    });

  const closeouts = FLEET.filter((t) => t.maintenance_flag === null && t.status === 'active')
    .slice(0, 4);                                    // "back on the road today"
  const stillInGarage = FLEET.filter((t) => t.status === 'garage');

  sectionHeader(doc, 'Shift in one glance');
  kv(doc, 'Convoys moved today',        `${convoysToday.length} (${convoysOnTime} on time · ${convoysDelayed} delayed)`);
  kv(doc, 'Laden trips arrived',        `${laden.length}  ·  ${fmtTonnes(tonnesToday)} to port`);
  kv(doc, 'Revenue booked · today',     fmtUsd(revenueToday, { k: true }) + ' (modelled)');
  kv(doc, 'Alerts resolved in-shift',   String(resolvedToday.length), { bold: true });
  kv(doc, 'Open at handover',           String(openAtHandover.length) + ' needing action', { bold: openAtHandover.length > 0 });
  kv(doc, 'Rigs in garage',             String(stillInGarage.length));

  // ── Convoys completed today ──────────────────────────
  sectionHeader(doc, 'Convoys · today');
  if (convoysToday.length === 0) {
    paragraph(doc, 'No convoy pings recorded today.');
  } else {
    table(doc, {
      columns: [
        { key: 'id',       label: 'Convoy',    flex: 1.1 },
        { key: 'hauler',   label: 'Hauler',    flex: 1.6 },
        { key: 'phase',    label: 'Phase',     flex: 0.9 },
        { key: 'trucks',   label: 'Trucks',    flex: 0.7, align: 'right' },
        { key: 'km',       label: 'KM',        flex: 0.7, align: 'right' },
        { key: 'cycle',    label: 'Cycle h',   flex: 0.9, align: 'right' },
        { key: 'sched',    label: 'Schedule',  flex: 1 },
      ],
      rows: convoysToday.map((c) => ({
        id:     c.id,
        hauler: roster.find(c.hauler_id)?.display_name || c.hauler_id,
        phase:  c.phase,
        trucks: String(c.trucks),
        km:     String(c.km),
        cycle:  c.cycle_h != null ? c.cycle_h.toFixed(1) : '—',
        sched:  c.on_schedule ? 'On time' : 'Delayed',
        tone:   c.on_schedule ? 'info' : 'warn',
      })),
    });
  }

  // ── Alerts resolved in shift ─────────────────────────
  sectionHeader(doc, 'Alerts resolved in-shift');
  if (resolvedToday.length === 0) {
    paragraph(doc, 'No alerts closed during this shift.');
  } else {
    table(doc, {
      columns: [
        { key: 'closed',  label: 'Closed',     flex: 0.9 },
        { key: 'sev',     label: 'Severity',   flex: 0.9 },
        { key: 'title',   label: 'Title',      flex: 2.6 },
        { key: 'by',      label: 'Resolved by',flex: 1.4 },
        { key: 'note',    label: 'Note',       flex: 2.2 },
      ],
      rows: resolvedToday.map(({ alert, state }) => ({
        closed: fmtClock(state.resolved_at_iso),
        sev:    alert.severity,
        title:  alert.title,
        by:     state.resolved_by_display || '—',
        note:   state.resolution_note || '—',
      })),
    });
  }

  // ── Open at handover ─────────────────────────────────
  sectionHeader(doc, 'Open at handover');
  if (openAtHandover.length === 0) {
    paragraph(doc, 'Nothing flagged for the oncoming controller. Board is clean.');
  } else {
    table(doc, {
      columns: [
        { key: 'opened',  label: 'Opened',    flex: 1 },
        { key: 'sev',     label: 'Severity',  flex: 0.9 },
        { key: 'type',    label: 'Type',      flex: 1.3 },
        { key: 'title',   label: 'Title',     flex: 2.6 },
        { key: 'owner',   label: 'Assignee',  flex: 1.4 },
      ],
      rows: openAtHandover.map(({ alert, state }) => ({
        opened: fmtDate(alert.opened_at),
        sev:    alert.severity,
        type:   alert.type,
        title:  alert.title,
        owner:  state.assignee_display || 'Unassigned',
        tone:   alert.severity === 'CRITICAL' ? 'warn' : 'info',
      })),
    });
  }

  // ── Maintenance close-outs ───────────────────────────
  sectionHeader(doc, 'Maintenance · back on the road');
  if (closeouts.length === 0) {
    paragraph(doc, 'No rigs returned from garage today.');
  } else {
    table(doc, {
      columns: [
        { key: 'plate',   label: 'Plate',    flex: 1.1 },
        { key: 'hauler',  label: 'Hauler',   flex: 1.6 },
        { key: 'rig',     label: 'Rig',      flex: 1.6 },
        { key: 'km',      label: 'Total km', flex: 1, align: 'right' },
      ],
      rows: closeouts.map((t) => ({
        plate:  t.plate,
        hauler: t.hauler_display,
        rig:    `${t.make} ${t.model}`,
        km:     t.total_km.toLocaleString(),
      })),
    });
  }

  if (stillInGarage.length > 0) {
    sectionHeader(doc, 'Still in garage');
    table(doc, {
      columns: [
        { key: 'plate',   label: 'Plate',    flex: 1.1 },
        { key: 'hauler',  label: 'Hauler',   flex: 1.6 },
        { key: 'rig',     label: 'Rig',      flex: 1.8 },
        { key: 'flag',    label: 'Flag',     flex: 1.3 },
      ],
      rows: stillInGarage.slice(0, 10).map((t) => ({
        plate:  t.plate,
        hauler: t.hauler_display,
        rig:    `${t.make} ${t.model}`,
        flag:   t.maintenance_flag || '—',
        tone:   t.maintenance_flag === 'critical' ? 'warn' : 'info',
      })),
    });
  }

  sectionHeader(doc, 'Handover notes');
  paragraph(doc,
    'Controller signature: ___________________________      Time off:  ______________',
    { lineGap: 4 },
  );
  paragraph(doc,
    'Oncoming controller: ___________________________      Time on:  ______________',
    { lineGap: 4 },
  );
}

// ── Entrypoint ───────────────────────────────────────────────────────
const RENDERERS = {
  shift_handover:   renderShiftHandover,
  gibdlc_monthly:   renderGibdlcMonthly,
  lender_quarterly: renderLenderQuarterly,
  filings_pack:     renderFilingsPack,
};

function writeReport(typeId, meta, stream) {
  const render = RENDERERS[typeId];
  if (!render) throw new Error(`Unknown report type: ${typeId}`);
  const doc = new PDFDocument({ ...PAGE_OPTS, bufferPages: true });
  doc.pipe(stream);
  render(doc, meta);
  pruneBlanks(doc);
  footer(doc);
  doc.end();
}

module.exports = { writeReport, RENDERERS };
