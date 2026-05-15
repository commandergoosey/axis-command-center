'use strict';

/*
 * Hauler settlement statements — Phase 89.
 *
 * GET    /api/settlements                — list (role-aware)
 * GET    /api/settlements/:id            — single statement
 * POST   /api/settlements/:id/mark-paid  — mark paid
 * POST   /api/settlements/:id/dispute    — open dispute
 * POST   /api/settlements/:id/resolve-dispute — resolve back to pending/paid
 * PATCH  /api/settlements/:id/notes      — set / update notes
 *
 * Role gate:
 *   - axis_admin / axis_ops: see + mutate everything.
 *   - hauler_admin: see + mutate own hauler only (markPaid blocked
 *     — they can dispute or add notes but not declare paid; that's
 *     an AXIS-side action).
 *   - lender: read-only on their own aggregate view.
 */

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const { SETTLEMENTS, PERIODS, HAULERS } = require('../mock/settlements');
const settlementOverlay = require('../state/settlementOverlay');
const { writeAudit } = require('../db/audit');
const roster = require('../state/roster');
const { aggregate } = require('../services/aggregator');
const { computeEffectiveRate } = require('../services/indexation');

const WRITE_ROLES = ['axis_admin', 'axis_ops'];
const ANY_WRITE_ROLES = ['axis_admin', 'axis_ops', 'hauler_admin'];

function canViewStatement(user, settlement) {
  if (!user) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops' || user.role === 'lender') return true;
  if (user.role === 'hauler_admin') return user.hauler_id === settlement.hauler_id;
  return false;
}

function findSettlement(id) {
  return SETTLEMENTS.find((s) => s.id === id) ?? null;
}

router.get('/', requireAuth, (req, res) => {
  // Merge mock statements with any generated fortnightly invoices.
  // Apply overlay to the mock ones (status mutations); generated ones
  // also get overlay applied so they can be marked-paid / disputed.
  const generated = settlementOverlay.listGenerated();
  const genApplied = generated.map((g) => {
    const ov = settlementOverlay.getOverride(g.id);
    if (!ov) return g;
    return {
      ...g,
      status:          ov.status         ?? g.status,
      paid_at:         ov.paid_at        ?? null,
      paid_amount_usd: ov.paid_amount_usd ?? null,
      payment_ref:     ov.payment_ref    ?? null,
      dispute: ov.dispute_opened_at ? {
        reason:    ov.dispute_reason,
        opened_at: ov.dispute_opened_at,
        opened_by: ov.dispute_opened_by,
      } : null,
    };
  });

  let rows = [...SETTLEMENTS.map(settlementOverlay.apply), ...genApplied];

  // Filter by role scope.
  if (req.user.role === 'hauler_admin') {
    rows = rows.filter((r) => r.hauler_id === req.user.hauler_id);
  }

  // Optional period filter.
  if (req.query.period) {
    rows = rows.filter((r) => r.period === req.query.period);
  }
  if (req.query.hauler_id && (req.user.role === 'axis_admin' || req.user.role === 'axis_ops' || req.user.role === 'lender')) {
    rows = rows.filter((r) => r.hauler_id === req.query.hauler_id);
  }

  // Sort: most recent period first, then hauler.
  rows.sort((a, b) => {
    if (a.period !== b.period) return b.period.localeCompare(a.period);
    return a.hauler_id.localeCompare(b.hauler_id);
  });

  // Aggregate counters for the page summary strip.
  const counts = rows.reduce((m, r) => {
    m.total++;
    m[r.status] = (m[r.status] || 0) + 1;
    if (r.status === 'pending') m.outstanding_usd += r.net_usd;
    if (r.status === 'disputed') m.disputed_usd += r.net_usd;
    return m;
  }, { total: 0, pending: 0, paid: 0, partial: 0, disputed: 0, outstanding_usd: 0, disputed_usd: 0 });

  // Phase 142 — per-hauler ageing strip. For every non-paid statement,
  // compute days outstanding from due_date → now and roll up per hauler
  // so the client can render an ageing urgency bar without a second fetch.
  const haulerIndex = Object.fromEntries(roster.list().map((h) => [h.id, h.display_name]));
  const agingMap = {};
  const now = new Date();
  rows.filter((r) => r.status !== 'paid').forEach((r) => {
    if (!r.due_date) return;
    const daysO = Math.floor((now - new Date(r.due_date)) / 86_400_000);
    if (!agingMap[r.hauler_id]) {
      agingMap[r.hauler_id] = {
        hauler_id:            r.hauler_id,
        hauler_display:       haulerIndex[r.hauler_id] ?? r.hauler_id,
        outstanding_usd:      0,
        statement_count:      0,
        oldest_days_outstanding: 0,
      };
    }
    const a = agingMap[r.hauler_id];
    a.outstanding_usd += r.net_usd;
    a.statement_count++;
    a.oldest_days_outstanding = Math.max(a.oldest_days_outstanding, daysO);
  });
  const hauler_aging = Object.values(agingMap)
    .sort((a, b) => b.oldest_days_outstanding - a.oldest_days_outstanding);

  res.json({
    generated_at: new Date().toISOString(),
    statements: rows,
    counts,
    periods: PERIODS,
    hauler_aging,
  });
});

// ── Phase 107: Receivables ageing — MUST be before /:id ──────────────────────

router.get('/ageing', requireAuth, (req, res) => {
  const generated = settlementOverlay.listGenerated().map((g) => {
    const ov = settlementOverlay.getOverride(g.id);
    return ov?.status ? { ...g, status: ov.status } : g;
  });
  const allRows = [...SETTLEMENTS.map(settlementOverlay.apply), ...generated];

  const outstanding = allRows.filter((r) => r.status !== 'paid');
  if (req.user.role === 'hauler_admin') {
    outstanding.splice(0, outstanding.length, ...outstanding.filter((r) => r.hauler_id === req.user.hauler_id));
  }

  const now = new Date();
  const bands = { current: 0, days30: 0, days60: 0, days90plus: 0 };
  const details = { current: [], days30: [], days60: [], days90plus: [] };

  for (const r of outstanding) {
    if (!r.due_date) continue;
    const due  = new Date(r.due_date);
    const daysOverdue = Math.floor((now - due) / (1000 * 60 * 60 * 24));
    const amt  = r.net_usd;
    const entry = { id: r.id, hauler_id: r.hauler_id, period: r.period_label ?? r.period, amount_usd: amt, due_date: r.due_date, status: r.status };

    if (daysOverdue <= 0)       { bands.current   += amt; details.current.push(entry); }
    else if (daysOverdue <= 30) { bands.days30     += amt; details.days30.push(entry); }
    else if (daysOverdue <= 60) { bands.days60     += amt; details.days60.push(entry); }
    else                        { bands.days90plus += amt; details.days90plus.push(entry); }
  }

  res.json({ bands, details, total_outstanding_usd: Object.values(bands).reduce((a, b) => a + b, 0) });
});

router.get('/:id', requireAuth, (req, res) => {
  const base = findSettlement(req.params.id);
  if (!base) return res.status(404).json({ error: 'Settlement not found' });
  if (!canViewStatement(req.user, base)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ statement: settlementOverlay.apply(base) });
});

router.post('/:id/mark-paid', requireRole(...WRITE_ROLES), (req, res) => {
  const base = findSettlement(req.params.id);
  if (!base) return res.status(404).json({ error: 'Settlement not found' });
  const { paid_amount_usd, payment_ref, paid_at } = req.body ?? {};
  settlementOverlay.markPaid(base.id, {
    paid_at,
    paid_amount_usd: paid_amount_usd ?? base.net_usd,
    payment_ref:     payment_ref     ?? null,
    by_user_id: req.user.id,
    by_display: req.user.display_name,
  });
  writeAudit({
    req,
    entity_type: 'settlement',
    entity_id:   base.id,
    action:      'mark_paid',
    summary:     `Settled ${base.hauler_id} ${base.period} · $${(paid_amount_usd ?? base.net_usd).toLocaleString()}${payment_ref ? ` · ${payment_ref}` : ''}`,
    payload:     { hauler_id: base.hauler_id, period: base.period, payment_ref: payment_ref || null },
  });
  res.json({ statement: settlementOverlay.apply(base) });
});

router.post('/:id/dispute', requireRole(...ANY_WRITE_ROLES), (req, res) => {
  const base = findSettlement(req.params.id);
  if (!base) return res.status(404).json({ error: 'Settlement not found' });
  if (req.user.role === 'hauler_admin' && req.user.hauler_id !== base.hauler_id) {
    return res.status(403).json({ error: 'Cannot dispute another hauler\'s statement' });
  }
  const { dispute_reason } = req.body ?? {};
  if (!dispute_reason || !dispute_reason.trim()) {
    return res.status(400).json({ error: 'dispute_reason required' });
  }
  settlementOverlay.openDispute(base.id, {
    dispute_reason: dispute_reason.trim().slice(0, 1000),
    by_user_id: req.user.id,
    by_display: req.user.display_name,
  });
  writeAudit({
    req,
    entity_type: 'settlement',
    entity_id:   base.id,
    action:      'dispute_opened',
    summary:     `Dispute opened on ${base.hauler_id} ${base.period}: ${dispute_reason.slice(0, 80)}${dispute_reason.length > 80 ? '…' : ''}`,
    payload:     { hauler_id: base.hauler_id, period: base.period },
  });
  res.json({ statement: settlementOverlay.apply(base) });
});

router.post('/:id/resolve-dispute', requireRole(...WRITE_ROLES), (req, res) => {
  const base = findSettlement(req.params.id);
  if (!base) return res.status(404).json({ error: 'Settlement not found' });
  const { resolution_status } = req.body ?? {};
  try {
    settlementOverlay.resolveDispute(base.id, {
      resolution_status: resolution_status || 'pending',
      by_user_id: req.user.id,
      by_display: req.user.display_name,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  writeAudit({
    req,
    entity_type: 'settlement',
    entity_id:   base.id,
    action:      'dispute_resolved',
    summary:     `Dispute resolved on ${base.hauler_id} ${base.period} → ${resolution_status || 'pending'}`,
    payload:     { hauler_id: base.hauler_id, period: base.period, resolution_status: resolution_status || 'pending' },
  });
  res.json({ statement: settlementOverlay.apply(base) });
});

router.patch('/:id/notes', requireRole(...ANY_WRITE_ROLES), (req, res) => {
  const base = findSettlement(req.params.id);
  if (!base) return res.status(404).json({ error: 'Settlement not found' });
  if (req.user.role === 'hauler_admin' && req.user.hauler_id !== base.hauler_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { notes } = req.body ?? {};
  settlementOverlay.setNotes(base.id, {
    notes: notes ? String(notes).slice(0, 2000) : null,
    by_user_id: req.user.id,
    by_display: req.user.display_name,
  });
  res.json({ statement: settlementOverlay.apply(base) });
});

// ── Phase 107: Generate fortnightly invoices ─────────────────────────────────

function currentFortnight() {
  const now   = new Date();
  const y     = now.getUTCFullYear();
  const m     = now.getUTCMonth();       // 0-indexed
  const d     = now.getUTCDate();
  const half  = d <= 15 ? 1 : 2;
  const pad   = (n) => String(n).padStart(2, '0');
  const period = `${y}-${pad(m + 1)}-W${half}`;
  const from  = new Date(Date.UTC(y, m, half === 1 ? 1 : 16));
  const to    = half === 1
    ? new Date(Date.UTC(y, m, 15))
    : new Date(Date.UTC(y, m + 1, 0)); // last day of month
  const label = `${from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · Fortnightly W${half}`;
  return { period, label, from, to };
}

router.post('/generate-fortnightly', requireRole(...WRITE_ROLES), (req, res) => {
  const fn         = currentFortnight();
  const tariff     = computeEffectiveRate();
  const effectiveRate = tariff.effective_usd_per_tonne;
  const allHaulers = roster.list().filter((h) => h.status === 'active');
  const agg        = aggregate(allHaulers);
  const now        = new Date();
  const dueDate    = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fuelAdv    = { 'haul-01': 6000, 'haul-02': 4750, 'haul-03': 5250, 'haul-04': 3400, 'haul-05': 4000 };

  const created = [];
  for (const h of allHaulers) {
    if (settlementOverlay.hasPeriod(fn.period, h.id)) continue; // idempotent
    const haulerAgg = agg.haulers.find((a) => a.id === h.id);
    const mtdTonnes = haulerAgg?.tonnes_delivered_mtd ?? 0;
    // Pro-rate MTD for fortnight (assume ~half-monthly)
    const fnTonnes  = Math.round(mtdTonnes * 0.5);
    const grossUsd  = Math.round(fnTonnes * effectiveRate);
    const deductUsd = fuelAdv[h.id] ?? 5000;
    const netUsd    = Math.max(0, grossUsd - deductUsd);

    const lineItems = [
      {
        id: `li-${fn.period}-${h.id}-haul`,
        type: 'haulage',
        description: `Haulage credit · ${fn.label} · ${fnTonnes.toLocaleString()} t @ $${effectiveRate.toFixed(2)}/t`,
        amount_usd: grossUsd,
        sign: 'credit',
        rate_usd: effectiveRate,
        tonnes: fnTonnes,
      },
      {
        id: `li-${fn.period}-${h.id}-fuel`,
        type: 'fuel_advance',
        description: 'Fortnightly diesel advance recoupment',
        amount_usd: deductUsd,
        sign: 'debit',
      },
    ];

    const row = {
      id:             `stl-gen-${fn.period}-${h.id}`,
      hauler_id:      h.id,
      period:         fn.period,
      period_label:   fn.label,
      issued_at:      now.toISOString(),
      due_date:       dueDate.toISOString().slice(0, 10),
      gross_usd:      grossUsd,
      deductions_usd: deductUsd,
      net_usd:        netUsd,
      line_items_json: JSON.stringify(lineItems),
      generated_at:   now.toISOString(),
      generated_by:   req.user.display_name,
    };
    created.push(row);
  }

  settlementOverlay.createGenerated(created);

  writeAudit({
    req,
    entity_type: 'settlement',
    entity_id:   fn.period,
    action:      'generate_fortnightly',
    summary:     `Generated ${created.length} fortnightly invoice(s) for ${fn.label} @ $${effectiveRate.toFixed(2)}/t`,
    payload:     { period: fn.period, count: created.length, effective_rate: effectiveRate },
  });

  res.json({
    period:        fn.period,
    label:         fn.label,
    effective_rate: effectiveRate,
    created:       created.length,
    skipped:       allHaulers.length - created.length,
    statements:    settlementOverlay.listGenerated().filter((g) => g.period === fn.period),
  });
});

module.exports = router;
