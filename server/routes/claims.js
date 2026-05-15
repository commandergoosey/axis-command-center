'use strict';

/*
 * Insurance claims register — Phase 90.
 *
 * GET    /api/claims                 — list (role-aware)
 * GET    /api/claims/:id             — single claim with audit
 * POST   /api/claims/:id/transition  — status transition + optional payload
 *
 * Status flow: filed → under_review → (approved | denied) → paid
 *
 * Role gate:
 *   - axis_admin / axis_ops: full read + write.
 *   - hauler_admin: read own hauler's claims only; can add notes
 *     but not change status.
 *   - lender: read all (claims affect DSCR via insurance recovery).
 */

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const { CLAIMS } = require('../mock/claims');
const claimsState = require('../state/claimsState');
const { writeAudit, listAudit } = require('../db/audit');

const WRITE_ROLES = ['axis_admin', 'axis_ops'];

function findClaim(id) {
  return CLAIMS.find((c) => c.id === id) ?? null;
}

function visibleTo(user, claim) {
  if (!user) return false;
  if (user.role === 'axis_admin' || user.role === 'axis_ops' || user.role === 'lender') return true;
  if (user.role === 'hauler_admin') return user.hauler_id === claim.hauler_id;
  return false;
}

router.get('/', requireAuth, (req, res) => {
  let rows = CLAIMS.map(claimsState.apply);

  // Hauler-admin scope.
  if (req.user.role === 'hauler_admin') {
    rows = rows.filter((c) => c.hauler_id === req.user.hauler_id);
  }

  // Optional filters.
  if (req.query.hauler_id && req.user.role !== 'hauler_admin') {
    rows = rows.filter((c) => c.hauler_id === req.query.hauler_id);
  }
  if (req.query.status) {
    rows = rows.filter((c) => c.status === req.query.status);
  }

  // Sort: filed_at desc.
  rows.sort((a, b) => b.filed_at.localeCompare(a.filed_at));

  // Counters.
  const counts = rows.reduce((m, c) => {
    m.total++;
    m[c.status] = (m[c.status] || 0) + 1;
    if (c.status === 'paid') {
      m.paid_amount_usd += c.approved_amount_usd ?? 0;
    } else if (c.status === 'approved') {
      m.approved_pending_payout_usd += c.approved_amount_usd ?? 0;
    } else {
      m.in_flight_amount_usd += c.claim_amount_usd ?? 0;
    }
    return m;
  }, {
    total: 0, filed: 0, under_review: 0, approved: 0, denied: 0, paid: 0,
    in_flight_amount_usd: 0, approved_pending_payout_usd: 0, paid_amount_usd: 0,
  });

  // Phase 146 — exposure by claim type: open claims (filed + under_review)
  // aggregated per type so the client can render an exposure breakdown chart.
  const OPEN_STATUSES = new Set(['filed', 'under_review', 'approved']);
  const TYPE_KEYS = ['third_party_liability', 'rig_damage', 'cargo_loss', 'medical'];
  const exposure_by_type = TYPE_KEYS.map((type) => {
    const openForType = rows.filter((c) => c.type === type && OPEN_STATUSES.has(c.status));
    return {
      type,
      count:        openForType.length,
      exposure_usd: openForType.reduce((s, c) => s + (c.claim_amount_usd ?? 0), 0),
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    claims: rows,
    counts,
    exposure_by_type,
  });
});

router.get('/:id', requireAuth, (req, res) => {
  const base = findClaim(req.params.id);
  if (!base) return res.status(404).json({ error: 'Claim not found' });
  if (!visibleTo(req.user, base)) return res.status(403).json({ error: 'Forbidden' });
  // Pull audit trail for the claim.
  const { rows: auditRows } = listAudit({ entity_type: 'claim', entity_id: base.id, limit: 50 });
  res.json({
    claim:  claimsState.apply(base),
    audit:  auditRows,
  });
});

router.post('/:id/transition', requireRole(...WRITE_ROLES), (req, res) => {
  const base = findClaim(req.params.id);
  if (!base) return res.status(404).json({ error: 'Claim not found' });
  const { status, approved_amount_usd, payment_ref, paid_at, notes } = req.body ?? {};
  if (!status) return res.status(400).json({ error: 'status required' });

  try {
    claimsState.transition(base.id, {
      status,
      approved_amount_usd,
      paid_at,
      payment_ref,
      notes,
      by_user_id: req.user.id,
      by_display: req.user.display_name,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const summary = status === 'paid'
    ? `Paid claim ${base.id} · ${base.hauler_id} · ${base.insurer}${approved_amount_usd ? ' · $' + approved_amount_usd.toLocaleString() : ''}${payment_ref ? ' · ref ' + payment_ref : ''}`
    : status === 'approved'
      ? `Approved claim ${base.id} · ${base.hauler_id} · $${(approved_amount_usd ?? base.claim_amount_usd).toLocaleString()}`
      : status === 'denied'
        ? `Denied claim ${base.id} · ${base.hauler_id}${notes ? ' · ' + notes.slice(0, 60) : ''}`
        : `Claim ${base.id} → ${status}`;

  writeAudit({
    req,
    entity_type: 'claim',
    entity_id:   base.id,
    action:      `transition_${status}`,
    summary,
    payload: {
      hauler_id: base.hauler_id,
      to_status: status,
      approved_amount_usd: approved_amount_usd ?? null,
      payment_ref: payment_ref ?? null,
    },
  });

  res.json({ claim: claimsState.apply(base) });
});

module.exports = router;
