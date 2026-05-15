'use strict';

/*
 * Global search — Phase 76.
 *
 * Aggregated query across the corridor's primary entity types.
 * Pure read-side composition: no index, no token store. The
 * dataset's small enough (5 haulers, ~80 drivers, a handful of
 * risks/alerts/contacts/filings) that scanning everything per
 * query is fine and the latency is sub-millisecond.
 *
 * Role-aware: results are filtered to surfaces the user can
 * navigate to. A lender doesn't see drivers (they don't have
 * the page). A hauler admin only sees their own hauler's
 * contacts. Same gating already enforced at the route layer is
 * mirrored here so the dropdown doesn't show items the user
 * can't open.
 *
 * Returns grouped result sets — `{ haulers: [...], drivers: [...],
 * risks: [...], ... }` — so the client can render type sections
 * without re-grouping.
 */

const roster          = require('../state/roster');
const riskRegister    = require('../state/riskRegister');
const haulerContacts  = require('../state/haulerContacts');
const alertState      = require('../state/alertState');
const filingState     = require('../state/filingState');
const { allAlerts }   = require('./alertSynth');
const { listAudit }   = require('../db/audit');

const { DRIVERS } = require('../mock/drivers');
const { FILINGS } = require('../mock/compliance');

// Per-role allowlist of result types — mirrors `lib/auth.js`
// `ROLE_PAGES` so the dropdown never offers a row the user can't
// click through to.
const ROLE_TYPES = {
  axis_admin: new Set(['hauler', 'driver', 'risk', 'alert', 'contact', 'filing', 'audit']),
  axis_ops:   new Set(['hauler', 'driver', 'risk', 'alert', 'contact', 'filing', 'audit']),
  hauler_admin: new Set(['hauler', 'driver', 'alert', 'contact']),
  lender:       new Set(['hauler', 'risk', 'alert', 'filing']),
};

const PER_TYPE_CAP = 5;
const TOTAL_CAP    = 30;

// ── Helpers ───────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').toString().toLowerCase().trim();
}

function score(text, q) {
  const t = normalize(text);
  if (!t) return 0;
  if (t === q) return 100;             // exact match
  if (t.startsWith(q)) return 50;      // prefix
  const idx = t.indexOf(q);
  if (idx === 0)  return 50;
  if (idx > 0)    return 20 - Math.min(idx, 19); // earlier match scores higher
  return 0;
}

// Score across multiple fields, take the max.
function scoreFields(q, ...fields) {
  let best = 0;
  for (const f of fields) {
    const s = score(f, q);
    if (s > best) best = s;
  }
  return best;
}

function topN(items, n) {
  return items
    .filter((it) => it._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, n)
    .map(({ _score, ...rest }) => rest);
}

// ── Per-type searchers ────────────────────────────────────────────

function searchHaulers(q, role, hauler_id) {
  return topN(roster.list().map((h) => {
    if (role === 'hauler_admin' && h.id !== hauler_id) return { _score: 0 };
    const _score = scoreFields(q, h.id, h.display_name, h.integration?.type, h.api_status);
    return {
      _score,
      type: 'hauler',
      id:   h.id,
      title: h.display_name,
      subtitle: `${h.id} · ${h.fleet?.contracted_trucks ?? '?'} trucks · ${h.integration?.type ?? 'manual'}`,
      link: { path: '/haulers', label: 'Open haulers' },
    };
  }), PER_TYPE_CAP);
}

function searchDrivers(q, role, hauler_id) {
  return topN(DRIVERS.map((d) => {
    if (role === 'hauler_admin' && d.hauler_id !== hauler_id) return { _score: 0 };
    const _score = scoreFields(q, d.id, d.full_name, d.licence_number, d.assigned_plate, d.hauler_display);
    return {
      _score,
      type: 'driver',
      id:   d.id,
      title: d.full_name,
      subtitle: `${d.hauler_display} · ${d.licence_class} licence · ${d.flag ?? 'OK'}`,
      link: { path: '/drivers', label: 'Open drivers' },
    };
  }), PER_TYPE_CAP);
}

function searchRisks(q) {
  return topN(riskRegister.listActive().map((r) => {
    const _score = scoreFields(q,
      r.title, r.description, r.mitigation_plan,
      r.category, r.severity, r.status,
      r.owner?.display_name,
    );
    return {
      _score,
      type: 'risk',
      id:   String(r.id),
      title: r.title,
      subtitle: `${r.severity} · ${r.category} · ${r.status}${r.owner?.display_name ? ' · ' + r.owner.display_name : ''}`,
      link: { path: '/risks', label: 'Open risk register' },
    };
  }), PER_TYPE_CAP);
}

function mergedAlertStatus(alert) {
  const st = alertState.getState(alert.id);
  let status = st.status_override ?? alert.status;
  if (status === 'SNOOZED' && st.snooze_until_iso) {
    if (Date.now() >= new Date(st.snooze_until_iso).getTime()) status = alert.status;
  }
  return { ...alert, status };
}

function searchAlerts(q, role, hauler_id) {
  return topN(allAlerts().map(mergedAlertStatus).map((a) => {
    if (role === 'hauler_admin' && a.hauler_id && a.hauler_id !== hauler_id) return { _score: 0 };
    const _score = scoreFields(q, a.id, a.title, a.body, a.severity, a.status, a.hauler_id);
    return {
      _score,
      type: 'alert',
      id:   a.id,
      title: a.title,
      subtitle: `${a.severity} · ${a.status}${a.hauler_id ? ' · ' + a.hauler_id : ''}`,
      link: { path: '/alerts', label: 'Open alerts' },
    };
  }), PER_TYPE_CAP);
}

function searchContacts(q, role, hauler_id) {
  // Contacts are per-hauler — iterate haulers we have contacts for
  // (latestPerHauler is a fast index) and read each set.
  const out = [];
  const latest = haulerContacts.latestPerHauler();
  for (const haulerId of Object.keys(latest)) {
    if (role === 'hauler_admin' && haulerId !== hauler_id) continue;
    const contacts = haulerContacts.forHauler(haulerId, 50);
    for (const c of contacts) {
      const _score = scoreFields(q,
        c.summary, c.counterparty_name, c.counterparty_role,
        c.channel, c.outcome, c.hauler_id,
      );
      out.push({
        _score,
        type: 'contact',
        id:   String(c.id),
        title: c.counterparty_name || `${c.hauler_id} contact`,
        subtitle: `${c.hauler_id} · ${c.channel} · ${c.outcome} · ${c.summary.slice(0, 80)}${c.summary.length > 80 ? '…' : ''}`,
        link: { path: '/haulers', label: 'Open haulers' },
      });
    }
  }
  return topN(out, PER_TYPE_CAP);
}

function searchFilings(q) {
  return topN(FILINGS.map((f) => {
    const live = filingState.getState(f.id);
    const status = live?.status ?? f.status;
    const _score = scoreFields(q, f.id, f.agency, f.detail, status, f.due);
    return {
      _score,
      type: 'filing',
      id:   f.id,
      title: `${f.agency} — ${f.detail.split('·')[0].trim()}`,
      subtitle: `${status} · due ${f.due}`,
      link: { path: '/compliance', label: 'Open compliance' },
    };
  }), PER_TYPE_CAP);
}

function searchAudit(q) {
  // Reuse the audit log's existing q parameter — the listAudit
  // function already supports free-text search across summary +
  // actor + entity_id + payload. Just hand it the query and take
  // the top 5 most recent matches.
  if (q.length < 2) return [];
  try {
    const { rows } = listAudit({ q, limit: PER_TYPE_CAP });
    return rows.map((r) => ({
      type: 'audit',
      id:   String(r.id),
      title: r.summary || `${r.entity_type} ${r.action}`,
      subtitle: `${r.actor?.display_name ?? '?'} · ${r.entity_type} · ${r.action} · ${new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ')}`,
      link: { path: '/settings#audit', label: 'Open audit log' },
    }));
  } catch {
    return [];
  }
}

// ── Compose ───────────────────────────────────────────────────────

function compose({ q = '', role = null, hauler_id = null } = {}) {
  const query = normalize(q);
  if (!query || query.length < 1) {
    return { query: '', total: 0, by_type: {}, results: [] };
  }
  const allowed = ROLE_TYPES[role] || ROLE_TYPES.axis_admin;
  const groups = {};

  if (allowed.has('hauler'))   groups.haulers   = searchHaulers(query, role, hauler_id);
  if (allowed.has('driver'))   groups.drivers   = searchDrivers(query, role, hauler_id);
  if (allowed.has('risk'))     groups.risks     = searchRisks(query);
  if (allowed.has('alert'))    groups.alerts    = searchAlerts(query, role, hauler_id);
  if (allowed.has('contact'))  groups.contacts  = searchContacts(query, role, hauler_id);
  if (allowed.has('filing'))   groups.filings   = searchFilings(query);
  if (allowed.has('audit'))    groups.audit     = searchAudit(query);

  // Flat results array for keyboard-nav consumers — preserved
  // group order matches the UI's section order.
  const flat = [];
  for (const key of ['haulers', 'drivers', 'risks', 'alerts', 'contacts', 'filings', 'audit']) {
    if (groups[key]) for (const r of groups[key]) flat.push(r);
    if (flat.length >= TOTAL_CAP) break;
  }

  const total = flat.length;
  const by_type = {};
  for (const [k, v] of Object.entries(groups)) by_type[k] = v.length;

  return { query: q, total, by_type, results: flat.slice(0, TOTAL_CAP) };
}

module.exports = { compose };
