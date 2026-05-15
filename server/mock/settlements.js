'use strict';

/*
 * Hauler settlement statements — Phase 89.
 *
 * Per-hauler monthly invoices AXIS issues to each hauler for
 * their share of corridor revenue. Distinct from the receivables
 * stream in mock/contract.js (which tracks GIBDLC → AXIS at the
 * corridor level) — this is AXIS → hauler at the per-month
 * granularity.
 *
 * Each statement has line items: haulage credits (tonnes ×
 * effective tariff) and deductions (axle-load fines, fuel
 * advance recoupment, late-delivery clauses). Net is the cash
 * settlement amount.
 *
 * Status enum: pending (default — issued, not yet paid), paid
 * (full payment received), partial (some paid), disputed (hauler
 * raised an issue with one or more line items).
 *
 * Demo seed: last 6 months for each of 5 active haulers = 30
 * statements. Older months mostly paid; recent ones in various
 * states.
 */

// Map hauler_id → effective monthly tonnes share (from
// performance + contracted_trucks). Approximate; consistent with
// roster mock.
const HAULER_TONNES = {
  'haul-01': 19500,
  'haul-02': 14700,
  'haul-03': 15400,
  'haul-04': 8200,
  'haul-05': 6100,
};

const TARIFF_BY_MONTH = {
  '2025-12': 23.90,
  '2026-01': 24.00,
  '2026-02': 24.12,
  '2026-03': 24.25,
  '2026-04': 24.36,
  '2026-05': 25.84,   // post-5-May reading per Phase 85 broadcast
};

// Per-hauler deductions personality:
// - haul-01: clean operator, minimal deductions
// - haul-02: occasional axle-load issues
// - haul-03: clean
// - haul-04: late-delivery clauses biting
// - haul-05: heavy fuel advance recoupment
const DEDUCTION_PROFILES = {
  'haul-01': () => [
    { type: 'fuel_advance', description: 'Monthly diesel advance recoupment', amount_usd: 12000 },
  ],
  'haul-02': (seq) => [
    { type: 'fuel_advance', description: 'Monthly diesel advance recoupment', amount_usd: 9500 },
    ...(seq % 3 === 0 ? [{ type: 'fine', description: 'Axle-load overload fines (3 events)', amount_usd: 4500 }] : []),
  ],
  'haul-03': () => [
    { type: 'fuel_advance', description: 'Monthly diesel advance recoupment', amount_usd: 10500 },
  ],
  'haul-04': (seq) => [
    { type: 'fuel_advance', description: 'Monthly diesel advance recoupment', amount_usd: 6800 },
    ...(seq % 2 === 0 ? [{ type: 'late_delivery', description: 'SLA penalty — convoys outside 4h window', amount_usd: 2200 }] : []),
  ],
  'haul-05': () => [
    { type: 'fuel_advance', description: 'Monthly diesel advance recoupment (extended)', amount_usd: 8000 },
    { type: 'late_delivery', description: 'SLA penalty — sustained off-pace dispatch', amount_usd: 3100 },
  ],
};

// 6 months ending April 2026 (the corridor's contract started Jan 2026; pre-2026 months are pre-contract for the demo).
const PERIODS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

const HAULERS = ['haul-01', 'haul-02', 'haul-03', 'haul-04', 'haul-05'];

function buildStatements() {
  const out = [];
  let counter = 1;
  for (const period of PERIODS) {
    const tariff = TARIFF_BY_MONTH[period];
    for (const haulerId of HAULERS) {
      const tonnes = HAULER_TONNES[haulerId];
      // Slight variance per month based on the period sequence so
      // the data isn't suspiciously identical month-on-month.
      const monthSeq = PERIODS.indexOf(period);
      const tonnesAdj = Math.round(tonnes * (0.92 + (monthSeq * 0.018)));

      const grossUsd = Math.round(tonnesAdj * tariff);
      const deductions = DEDUCTION_PROFILES[haulerId](monthSeq);
      const totalDeductions = deductions.reduce((s, d) => s + d.amount_usd, 0);
      const netUsd = grossUsd - totalDeductions;

      const lineItems = [
        {
          id: `li-${counter}-1`,
          type: 'haulage',
          description: `Tonnes delivered ${period} · ${tonnesAdj.toLocaleString()} t @ $${tariff.toFixed(2)}/t`,
          tonnes: tonnesAdj,
          rate_usd: tariff,
          amount_usd: grossUsd,
          sign: 'credit',
        },
        ...deductions.map((d, i) => ({
          id: `li-${counter}-${2 + i}`,
          ...d,
          sign: 'debit',
        })),
      ];

      // Issued the 1st of next month, due 30 days later.
      const [yr, mo] = period.split('-').map(Number);
      const issuedAt = new Date(Date.UTC(yr, mo, 1, 8, 0, 0)).toISOString();
      const dueDate  = new Date(Date.UTC(yr, mo + 1, 0, 23, 59, 59)).toISOString();

      // Default status: older months mostly paid, current months pending.
      let status = 'pending';
      let paidAt = null;
      let paidAmount = null;
      let paymentRef = null;
      if (period < '2026-04') {
        status = 'paid';
        paidAt = new Date(Date.UTC(yr, mo + 1, 5 + monthSeq, 14, 30, 0)).toISOString();
        paidAmount = netUsd;
        paymentRef = `WIRE-${period.replace('-', '')}-${haulerId.slice(-2)}`;
      } else if (period === '2026-04') {
        // April: hauler-01/03 paid early, others pending.
        if (haulerId === 'haul-01' || haulerId === 'haul-03') {
          status = 'paid';
          paidAt = new Date(Date.UTC(2026, 4, 1, 11, 15, 0)).toISOString();
          paidAmount = netUsd;
          paymentRef = `WIRE-202604-${haulerId.slice(-2)}`;
        }
      }

      out.push({
        id:         `stmt-${haulerId}-${period}`,
        hauler_id:  haulerId,
        period,
        issued_at:  issuedAt,
        due_date:   dueDate,
        line_items: lineItems,
        gross_usd:  grossUsd,
        deductions_usd: totalDeductions,
        net_usd:    netUsd,
        status,
        paid_at:    paidAt,
        paid_amount_usd: paidAmount,
        payment_ref: paymentRef,
      });
      counter++;
    }
  }
  return out;
}

const SETTLEMENTS = buildStatements();

module.exports = { SETTLEMENTS, PERIODS, HAULERS };
