'use strict';

/*
 * Report library + recent report instances. The library is the catalogue
 * of report types the Command Center can produce; instances are the
 * historical record of what has been generated and sent to whom. In v1
 * instances are ephemeral (server memory). Phase 10 persists them.
 */

const LIBRARY = [
  {
    id: 'shift_handover',
    title: 'Shift handover brief',
    audience: 'AXIS ops · on-call',
    cadence: 'Daily · end of shift',
    sla_days: 0,
    description: 'End-of-shift artefact for the oncoming controller. Convoys completed today, alerts resolved in-shift, maintenance close-outs, and anything still open at handover — synthesised in one downloadable PDF.',
    recipients_default: ['ops@axishaul.com'],
    next_due_iso: '2026-04-21',
  },
  {
    id: 'gibdlc_monthly',
    title: 'GIBDLC monthly pack',
    audience: 'GIBDLC · contract ops',
    cadence: 'Monthly · 5th working day',
    sla_days: 5,
    description: 'Contract-facing report. Tonnage vs floor, SLA attainment across the three measures, axle-load record, and the invoice summary for the period.',
    recipients_default: ['operations@gibdlc.com', 'logistics@gibdlc.com'],
    next_due_iso: '2026-05-07',
  },
  {
    id: 'lender_quarterly',
    title: 'Lender quarterly pack',
    audience: 'Ecobank · project finance',
    cadence: 'Quarterly · within 20 days of quarter-end',
    sla_days: 20,
    description: 'Lender-side-letter report. DSCR trailing three-month, covenant test results, P&L (MTD + YTD), and the 90-day cashflow forecast with debt-service troughs flagged.',
    recipients_default: ['project.finance@ecobank.com'],
    next_due_iso: '2026-07-20',
  },
  {
    id: 'filings_pack',
    title: 'Regulatory filings pack',
    audience: 'GIADEC · DVLA · GHA · Minerals Commission',
    cadence: 'Rolling · filed as due',
    sla_days: 0,
    description: 'Regulatory filing bundle. Vehicle roadworthy certificates, axle-load annexes, HSE summary, and filing receipts for the four regulators. Attached to every GIADEC quarterly review.',
    recipients_default: ['compliance@giadec.gov.gh'],
    next_due_iso: '2026-04-30',
  },
];

// Recent instances — GIBDLC March is signed and delivered; a few others
// are in flight or failed. Sized to make the recent-reports list feel
// real without manufacturing data the operator has to keep straight.
const RECENT = [
  {
    id: 'rpt-014',
    type_id: 'gibdlc_monthly',
    title: 'GIBDLC monthly pack · March 2026',
    period_label: 'March 2026',
    period_from: '2026-03-01',
    period_to:   '2026-03-31',
    status: 'DELIVERED',
    generated_at: '2026-04-05T09:14:00Z',
    generated_by: 'Adwoa Mensah',
    recipients: ['operations@gibdlc.com', 'logistics@gibdlc.com'],
    size_kb: 412,
    pages: 8,
    filename: 'gibdlc_monthly_2026-03.pdf',
  },
  {
    id: 'rpt-013',
    type_id: 'filings_pack',
    title: 'Regulatory filings pack · Q1 2026',
    period_label: 'Q1 2026',
    period_from: '2026-01-01',
    period_to:   '2026-03-31',
    status: 'DELIVERED',
    generated_at: '2026-04-02T16:44:00Z',
    generated_by: 'Kojo Appiah',
    recipients: ['compliance@giadec.gov.gh'],
    size_kb: 288,
    pages: 5,
    filename: 'filings_pack_2026-q1.pdf',
  },
  {
    id: 'rpt-012',
    type_id: 'lender_quarterly',
    title: 'Lender quarterly pack · Q1 2026',
    period_label: 'Q1 2026',
    period_from: '2026-01-01',
    period_to:   '2026-03-31',
    status: 'DELIVERED',
    generated_at: '2026-04-14T10:02:00Z',
    generated_by: 'Adwoa Mensah',
    recipients: ['project.finance@ecobank.com'],
    size_kb: 524,
    pages: 11,
    filename: 'lender_quarterly_2026-q1.pdf',
  },
  {
    id: 'rpt-011',
    type_id: 'gibdlc_monthly',
    title: 'GIBDLC monthly pack · February 2026',
    period_label: 'February 2026',
    period_from: '2026-02-01',
    period_to:   '2026-02-28',
    status: 'DELIVERED',
    generated_at: '2026-03-04T08:58:00Z',
    generated_by: 'Adwoa Mensah',
    recipients: ['operations@gibdlc.com', 'logistics@gibdlc.com'],
    size_kb: 398,
    pages: 8,
    filename: 'gibdlc_monthly_2026-02.pdf',
  },
];

module.exports = { LIBRARY, RECENT };
