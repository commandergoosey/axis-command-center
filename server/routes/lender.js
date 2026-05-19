'use strict';

/*
 * GET /api/lender/pack — composed lender briefing pack.
 *
 * Phase 70. The lender persona had read-deep visibility but no
 * archival output. This endpoint composes a single self-contained
 * payload — executive summary, DSCR, covenants, capital structure,
 * P&L, receivables, forecast trajectory, open alerts, hauler
 * ranking — that the client renders as a print-friendly document.
 *
 * All authenticated roles can read; the pack is a strategic
 * snapshot useful for axis_admin (ops review) as well as the
 * lender itself.
 */

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const lenderPack       = require('../services/lenderPack');
const { buildCovenants } = require('../services/covenants');
const dscrService      = require('../services/dscr');
const roster           = require('../state/roster');
const { writeAudit }   = require('../db/audit');

router.get('/pack', requireAuth, (req, res) => {
  const generatedBy = req.user ? {
    user_id:      req.user.id,
    display_name: req.user.display_name,
    organisation: req.user.organisation,
    role:         req.user.role,
  } : null;
  const pack = lenderPack.compose(new Date(), generatedBy);

  // Audit pack generation — useful for both compliance (who pulled
  // the credit committee snapshot when) and analytics (which roles
  // use the pack most).
  writeAudit({
    req,
    entity_type: 'lender_pack',
    entity_id:   pack.period.start.slice(0, 10),
    action:      'generate',
    summary:     `Lender pack generated · ${pack.period.month} · DSCR ${pack.dscr.current.toFixed(2)}× · ${pack.executive_summary.headline_status}`,
    payload:     {
      headline_status:  pack.executive_summary.headline_status,
      dscr_current:     pack.dscr.current,
      open_breaches:    pack.executive_summary.open_breaches,
      open_watches:     pack.executive_summary.open_watches,
    },
  });

  res.json(pack);
});

/* ── LP-44 — Lender covenant monitoring ─────────────────────────── */
//
// GET /api/lender/covenants
//
// Returns live covenant status and DSCR series so the lender can
// check compliance posture without generating a full pack. All
// authenticated roles can read (same as the pack endpoint).

router.get('/covenants', requireAuth, (req, res) => {
  const haulers   = roster.list();
  const now       = new Date();
  const covenants = buildCovenants(haulers, now);
  const dscr      = dscrService.compute(haulers, now);

  const breaches  = covenants.filter((c) => c.status === 'breach');
  const watches   = covenants.filter((c) => c.status === 'watch');

  writeAudit({
    req,
    entity_type: 'lender_covenants',
    entity_id:   new Date().toISOString().slice(0, 10),
    action:      'read',
    summary:     `Covenants read: ${breaches.length} breach, ${watches.length} watch`,
  });

  res.json({
    generated_at:   new Date().toISOString(),
    dscr:           dscr,
    covenants,
    summary: {
      total:         covenants.length,
      compliant:     covenants.filter((c) => c.status === 'compliant').length,
      watch:         watches.length,
      breach:        breaches.length,
    },
  });
});

module.exports = router;
