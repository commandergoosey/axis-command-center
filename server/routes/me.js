'use strict';

/*
 * GET    /api/me/pins         — list current user's pins, hydrated
 * POST   /api/me/pins         — pin an entity
 * DELETE /api/me/pins/:id     — unpin by row id
 * DELETE /api/me/pins/by-ref  — unpin by entity_type+entity_id (idempotent)
 *
 * Phase 78. Personal pinboard. Pins are refs, not snapshots — the
 * GET endpoint hydrates each pin against its source primitive
 * (haulers / risks / alerts / contacts / filings) so the pinboard
 * always reflects today's reality.
 *
 * Hauler-admin scope: pinning another hauler's data isn't
 * forbidden at the schema layer (the user could craft a request),
 * but the hydration layer returns nothing for entities they can't
 * read elsewhere — same gate applied during search (Phase 76).
 * Practically harmless; just keeps the pinboard honest.
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const userPins = require('../state/userPins');
const personalDigest = require('../services/personalDigest');
const roster   = require('../state/roster');
const myHauler = require('../services/myHauler');
const riskRegister = require('../state/riskRegister');
const riskSteps    = require('../state/riskSteps');
const alertState   = require('../state/alertState');
const filingState  = require('../state/filingState');
const haulerContacts = require('../state/haulerContacts');
const { allAlerts } = require('../services/alertSynth');
const { FILINGS } = require('../mock/compliance');

// ── Hydration helpers ────────────────────────────────────────────

function hydrateHauler(id, user) {
  if (user?.role === 'hauler_admin' && user.hauler_id !== id) return null;
  const h = roster.find(id);
  if (!h) return null;
  const integrationLabel = h.integration?.type ?? 'manual';
  return {
    type: 'hauler',
    id:   h.id,
    title: h.display_name,
    subtitle: `${h.fleet?.contracted_trucks ?? '?'} trucks · ${integrationLabel}`,
    severity: 'info',
    link: { path: '/haulers', label: 'Open haulers' },
  };
}

function hydrateRisk(id, _user) {
  const numId = parseInt(id, 10);
  const r = riskRegister.findById(numId);
  if (!r || r.archived_at) return null;
  const steps = riskSteps.countsByRisk()[numId] || { done_count: 0, total_count: 0 };
  const sevToSeverity = { critical: 'warn', high: 'warn', medium: 'info', low: 'info' };
  return {
    type: 'risk',
    id:   String(r.id),
    title: r.title,
    subtitle: `${r.severity} · ${r.status}${steps.total_count > 0 ? ` · ${steps.done_count}/${steps.total_count} steps` : ''}`,
    severity: sevToSeverity[r.severity] || 'info',
    link: { path: '/risks', label: 'Open risk register' },
  };
}

function mergedAlertStatus(a) {
  const st = alertState.getState(a.id);
  let status = st.status_override ?? a.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) status = a.status;
  }
  return { ...a, status };
}

function hydrateAlert(id, user) {
  const a = allAlerts().map(mergedAlertStatus).find((x) => x.id === id);
  if (!a) return null;
  if (user?.role === 'hauler_admin' && a.hauler_id && a.hauler_id !== user.hauler_id) return null;
  return {
    type: 'alert',
    id:   a.id,
    title: a.title,
    subtitle: `${a.severity} · ${a.status}${a.hauler_id ? ' · ' + a.hauler_id : ''}`,
    severity: ['CRITICAL', 'WARNING'].includes(a.severity)
      ? (a.status === 'RESOLVED' ? 'info' : 'warn')
      : 'info',
    link: { path: '/alerts', label: 'Open alerts' },
  };
}

function hydrateContact(id, user) {
  const c = haulerContacts.findById(parseInt(id, 10));
  if (!c) return null;
  if (user?.role === 'hauler_admin' && c.hauler_id !== user.hauler_id) return null;
  return {
    type: 'contact',
    id:   String(c.id),
    title: c.counterparty_name || `${c.hauler_id} contact`,
    subtitle: `${c.hauler_id} · ${c.channel} · ${c.outcome}${c.follow_up_at && !c.follow_up_resolved ? ' · follow-up pending' : ''}`,
    severity: c.follow_up_at && !c.follow_up_resolved
      ? (new Date(c.follow_up_at).getTime() < Date.now() ? 'warn' : 'info')
      : 'info',
    link: { path: '/haulers', label: 'Open haulers' },
  };
}

function hydrateFiling(id, _user) {
  const f = FILINGS.find((x) => x.id === id);
  if (!f) return null;
  const live = filingState.getState(f.id);
  const status = live?.status ?? f.status;
  const dueMs = new Date(f.due).getTime();
  const days = Math.ceil((dueMs - Date.now()) / (24 * 60 * 60 * 1000));
  return {
    type: 'filing',
    id:   f.id,
    title: `${f.agency} — ${f.detail.split('·')[0].trim()}`,
    subtitle: `${status} · due ${f.due}${status !== 'FILED' ? ` (${days < 0 ? `${-days}d overdue` : `in ${days}d`})` : ''}`,
    severity: status !== 'FILED' && days <= 7 ? 'warn' : 'info',
    link: { path: '/compliance', label: 'Open compliance' },
  };
}

const HYDRATORS = {
  hauler:  hydrateHauler,
  risk:    hydrateRisk,
  alert:   hydrateAlert,
  contact: hydrateContact,
  filing:  hydrateFiling,
};

function hydrate(pin, user) {
  const fn = HYDRATORS[pin.entity_type];
  if (!fn) return null;
  const hydrated = fn(pin.entity_id, user);
  if (!hydrated) {
    // Source entity gone (archived, resolved, deleted) — render a
    // tombstone so the operator can unpin it.
    return {
      type: pin.entity_type,
      id:   pin.entity_id,
      title: pin.label || `${pin.entity_type} ${pin.entity_id}`,
      subtitle: 'No longer available — unpin to clear.',
      severity: 'tertiary',
      link: null,
      tombstone: true,
    };
  }
  return hydrated;
}

// ── Routes ────────────────────────────────────────────────────────

router.get('/pins', requireAuth, (req, res) => {
  const pins = userPins.forUser(req.user.id);
  const items = pins.map((p) => ({
    pin_id:      p.id,
    pinned_at:   p.pinned_at,
    entity_type: p.entity_type,
    entity_id:   p.entity_id,
    label:       p.label,
    hydrated:    hydrate(p, req.user),
  }));
  res.json({ pins: items });
});

router.post('/pins', requireAuth, (req, res) => {
  const { entity_type, entity_id, label } = req.body || {};
  try {
    userPins.add({
      user_id: req.user.id,
      entity_type,
      entity_id,
      label,
    });
    res.json({ pinned: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/pins/by-ref', requireAuth, (req, res) => {
  const { entity_type, entity_id } = req.body || {};
  if (!entity_type || !entity_id) {
    return res.status(400).json({ error: 'entity_type and entity_id required' });
  }
  userPins.removeByRef(req.user.id, entity_type, entity_id);
  res.json({ unpinned: true });
});

router.delete('/pins/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  userPins.removeById(id, req.user.id);
  res.json({ unpinned: true });
});

// ── Phase 79 — "My hauler" dashboard ──────────────────────────────
//
// Hauler-scoped landing for the hauler_admin persona. Composed
// server-side from existing primitives. AXIS roles can pass
// `?hauler_id=` to view another hauler's dashboard (read-only,
// useful for "view as the hauler sees it" debug + lender
// transparency).
router.get('/hauler', requireAuth, (req, res) => {
  // Resolve which hauler to compose for.
  let haulerId = req.query.hauler_id || null;
  if (req.user.role === 'hauler_admin') {
    // Hauler admin always sees their own; ignore any query override.
    haulerId = req.user.hauler_id;
  } else if (!haulerId) {
    // AXIS roles must specify which hauler to view.
    return res.status(400).json({
      error: 'hauler_id query parameter required for AXIS roles',
    });
  } else if (req.user.role === 'lender') {
    // Lender doesn't have a per-hauler view — they read the corridor
    // pack instead.
    return res.status(403).json({
      error: 'Lender persona uses /api/lender/pack for hauler detail',
    });
  }
  const composed = myHauler.compose(haulerId);
  if (!composed) return res.status(404).json({ error: 'Hauler not found' });
  res.json(composed);
});

// ── Phase 91 — Personal activity digest ──────────────────────────
//
// First-person view of the calling user's contribution over the
// last N days, composed from the audit log filtered on
// actor_user_id. Returns counts (total, by category, action item
// flow), daily-series for a sparkline, and the 25 most-recent
// events for an inline timeline.
router.get('/activity', requireAuth, (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 7));
  res.json(personalDigest.compose({
    actor_user_id: req.user.id,
    days,
  }));
});

module.exports = router;
