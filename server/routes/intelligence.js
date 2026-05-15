'use strict';

/*
 * /api/intelligence — AXIS Intelligence surface.
 *
 *   GET  /api/intelligence/observe?page=<page>  → proactive observations + chips
 *   POST /api/intelligence/chat   { question, page?, context? } → one-shot reply
 *
 * Context for observe is built server-side from the aggregator + page-specific
 * fixtures so the prompt has a current corridor snapshot to ground against.
 * The chat endpoint accepts caller-supplied context for unscoped questions.
 */

const express = require('express');
const router = express.Router();

const intelligence = require('../services/intelligence');
const roster = require('../state/roster');
const { aggregate, CONTRACT } = require('../services/aggregator');

// Build a compact context payload for a given page. Keeps tokens low and the
// model grounded in the same numbers the UI is rendering.
function buildContext(page) {
  const agg = aggregate(roster.list());
  const base = {
    today_iso: new Date().toISOString().slice(0, 10),
    corridor: { name: 'Nyinahin–Takoradi', km: 300, counterparty: 'GIBDLC' },
    fleet: agg.fleet,
    tonnes: agg.tonnes,
    sla_pct: agg.sla_attainment_pct,
    haulers: agg.haulers.map((h) => ({
      name:           h.display_name,
      status:         h.status,
      active_trucks:  h.fleet.active_trucks,
      contracted:     h.fleet.contracted_trucks,
      mtd_delivered:  h.tonnes_delivered_mtd,
      mtd_contracted: h.tonnes_contracted_mtd,
      sla:            h.performance.sla_attainment_pct,
    })),
    take_or_pay_floor_pct: CONTRACT.take_or_pay_floor_pct * 100,
    base_tariff_usd_per_tonne: CONTRACT.base_tariff_usd_per_tonne,
  };
  return base;
}

router.get('/observe', async (req, res, next) => {
  try {
    const page = String(req.query.page || 'today').toLowerCase();
    const ctx = buildContext(page);
    const result = await intelligence.observe(page, ctx);
    res.json({
      generated_at: new Date().toISOString(),
      page,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chat', async (req, res, next) => {
  try {
    const { question, page = 'today', context: callerContext } = req.body ?? {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question (string) is required' });
    }
    const ctx = callerContext ?? buildContext(page);
    const result = await intelligence.chat(question, ctx, page);
    res.json({
      generated_at: new Date().toISOString(),
      page,
      question,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/status', (_req, res) => {
  res.json({
    mode: intelligence._hasKey() ? 'live' : 'demonstration',
    obs_model:  'claude-opus-4-7',
    chat_model: 'claude-sonnet-4-6',
  });
});

module.exports = router;
