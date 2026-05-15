'use strict';

/*
 * Upcoming events feed — Phase 73.
 *
 * Aggregates every dated obligation in the corridor into a single
 * forward-looking timeline. Pure read-side composition over
 * primitives that already exist:
 *
 *   - Regulatory filings (DVLA, GHA, Minerals Commission, EPA)
 *   - Driver licence + medical certificate expiries
 *   - Action items with due_date set
 *   - Hauler contact follow-ups (Phase 69)
 *   - Risk register review cadences (Phase 72 — every 30 days)
 *   - Contract anniversaries (start_date, term renewals)
 *   - Take-or-pay reset (last day of each month)
 *
 * Each event is shape-normalised into { id, type, date, severity,
 * title, body, link } so the client renders a uniform timeline
 * irrespective of source. Ordered ascending by date.
 *
 * No new state. Lender-safe. Used by:
 *   - GET /api/today/calendar (full feed, grouped by date on client)
 *   - Today right rail "Next 7 days" strip
 */

const actionAssignments = require('../state/actionAssignments');
const filingState       = require('../state/filingState');
const licenceState      = require('../state/licenceState');
const haulerContacts    = require('../state/haulerContacts');
const riskRegister      = require('../state/riskRegister');
const riskSteps         = require('../state/riskSteps');
const maintenanceSchedule = require('../state/maintenanceSchedule');

const { FILINGS, LICENCE_EXPIRY } = require('../mock/compliance');
const { CONTRACT_TERMS } = require('../mock/contract');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────

function daysUntil(iso, now) {
  return Math.ceil((new Date(iso).getTime() - now) / ONE_DAY_MS);
}

function severityForDays(days, { warnAt = 7, critAt = 0 } = {}) {
  if (days < critAt)   return 'overdue';
  if (days <= warnAt)  return 'warn';
  return 'info';
}

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Last day of the calendar month for a given date (UTC).
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0));
}

// ── Source mappers ────────────────────────────────────────────────

function mapFilings(now) {
  return FILINGS
    .map((f) => {
      const live = filingState.getState(f.id);
      const status = live?.status ?? f.status;
      if (status === 'FILED') return null;
      const days = daysUntil(f.due, now);
      const sev = days < 0 ? 'overdue' : days <= 7 ? 'warn' : 'info';
      return {
        id:        `evt-filing-${f.id}`,
        type:      'filing',
        date:      f.due,
        severity:  sev,
        title:     `${f.agency} — ${f.detail.split('·')[0].trim()}`,
        body:      f.detail.includes('·') ? f.detail.split('·').slice(1).join('·').trim() : null,
        link:      { path: '/compliance', label: 'Open compliance' },
        days_until: days,
      };
    })
    .filter(Boolean);
}

function mapLicences(now) {
  return LICENCE_EXPIRY
    .map((l) => {
      const live = licenceState.getState(l.id);
      if (live?.renewed) return null; // renewals clear from the timeline
      const days = daysUntil(l.expiry, now);
      const sev = days < 0 ? 'overdue' : days <= 14 ? 'warn' : 'info';
      return {
        id:        `evt-licence-${l.id}`,
        type:      'licence',
        date:      l.expiry,
        severity:  sev,
        title:     `${l.driver} — ${l.document} expiry`,
        body:      `${l.hauler_id.toUpperCase()} · book DVLA slot before expiry.`,
        link:      { path: '/compliance', label: 'Open compliance' },
        days_until: days,
      };
    })
    .filter(Boolean);
}

function mapActionItems(now) {
  return actionAssignments.all()
    .filter((a) => a.due_date)
    .map((a) => {
      const days = daysUntil(a.due_date, now);
      const sev = days < 0 ? 'overdue' : days <= 2 ? 'warn' : 'info';
      const owner = a.assignee?.display_name ?? 'unassigned';
      return {
        id:        `evt-action-${a.action_item_id}`,
        type:      'action_item',
        date:      a.due_date,
        severity:  sev,
        title:     `Action item due — ${owner}`,
        body:      a.action_item_id,
        link:      { path: '/', label: 'Open Today' },
        days_until: days,
      };
    });
}

function mapContactFollowups(now) {
  // Hauler contact follow-ups (Phase 69). Unresolved follow_up_at
  // entries are forward-looking commitments to circle back.
  const all = [];
  // No global "all contacts" exporter; iterate per known hauler.
  // Pull from the latestPerHauler index then read each hauler's
  // contacts and filter for unresolved follow-ups.
  const latest = haulerContacts.latestPerHauler();
  for (const haulerId of Object.keys(latest)) {
    const contacts = haulerContacts.forHauler(haulerId, 50);
    for (const c of contacts) {
      if (!c.follow_up_at || c.follow_up_resolved) continue;
      const days = daysUntil(c.follow_up_at, now);
      const sev = days < 0 ? 'overdue' : days <= 2 ? 'warn' : 'info';
      all.push({
        id:        `evt-contact-${c.id}`,
        type:      'contact_followup',
        date:      c.follow_up_at,
        severity:  sev,
        title:     `Hauler ${c.hauler_id} — follow up on ${c.channel} contact`,
        body:      c.summary.slice(0, 140) + (c.summary.length > 140 ? '…' : ''),
        link:      { path: '/haulers', label: 'Open haulers' },
        days_until: days,
      });
    }
  }
  return all;
}

function mapRiskSteps(now) {
  // Phase 74 — open mitigation steps with a due date join the
  // calendar feed. Done/closed steps drop out automatically
  // (state filters at the SQL level).
  const allOpen = riskSteps.openWithDueDate();
  if (allOpen.length === 0) return [];
  // Resolve risk titles for the rows the operator sees.
  const riskById = new Map();
  for (const r of riskRegister.listActive()) riskById.set(r.id, r);
  return allOpen.map((s) => {
    const risk = riskById.get(s.risk_id);
    if (!risk) return null; // archived risk; drop the step
    const days = daysUntil(s.due_date, now);
    const sev = days < 0 ? 'overdue' : days <= 3 ? 'warn' : 'info';
    const ownerLabel = s.owner?.display_name ? ` · ${s.owner.display_name}` : ' · unowned';
    return {
      id:        `evt-risk-step-${s.id}`,
      type:      'risk_step',
      date:      s.due_date,
      severity:  sev,
      title:     s.title,
      body:      `Mitigation for "${risk.title}"${ownerLabel}`,
      link:      { path: '/risks', label: 'Open risk register' },
      days_until: days,
    };
  }).filter(Boolean);
}

function mapRiskReviews(now) {
  // Risks are reviewed every 30 days. Compute next-review-due date
  // as last_reviewed_at + 30d (or "now" if never reviewed). Closed
  // and archived risks excluded.
  return riskRegister.listActive()
    .filter((r) => r.status !== 'closed')
    .map((r) => {
      const reviewedMs = r.last_reviewed_at
        ? new Date(r.last_reviewed_at).getTime()
        : null;
      const dueMs = reviewedMs != null ? reviewedMs + 30 * ONE_DAY_MS : now;
      const days = Math.ceil((dueMs - now) / ONE_DAY_MS);
      const sev = days < 0 ? 'overdue' : days <= 7 ? 'warn' : 'info';
      return {
        id:        `evt-risk-${r.id}`,
        type:      'risk_review',
        date:      new Date(dueMs).toISOString(),
        severity:  sev,
        title:     `Review risk — ${r.title}`,
        body:      `${r.severity} · ${r.category} · ${r.status}${r.owner?.display_name ? ` · ${r.owner.display_name}` : ''}`,
        link:      { path: '/risks', label: 'Open risk register' },
        days_until: days,
      };
    });
}

function mapMaintenanceWindows(now) {
  // Phase 84 — planned maintenance windows in the calendar feed.
  // We surface the start_at as the event date (the planned arrival
  // at the workshop). Cancelled/completed windows drop out.
  return maintenanceSchedule.upcoming().map((m) => {
    const days = daysUntil(m.start_at, now);
    const sev = days < 0 ? 'overdue' : days <= 3 ? 'warn' : 'info';
    const typeLabel = m.type.replace(/_/g, ' ');
    const durationDays = Math.max(1, Math.ceil(
      (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / ONE_DAY_MS,
    ));
    return {
      id:        `evt-maint-${m.id}`,
      type:      'maintenance',
      date:      m.start_at,
      severity:  sev,
      title:     `${m.rig_id} — ${typeLabel}`,
      body:      `${m.hauler_id} · ${durationDays}-day window${m.notes ? ` · ${m.notes.slice(0, 80)}` : ''}`,
      link:      { path: '/maintenance', label: 'Open maintenance' },
      days_until: days,
    };
  });
}

function mapTakeOrPayResets(now, horizonMs) {
  // Take-or-pay floor resets at the last day of each month. Surface
  // every reset date inside the horizon window.
  const out = [];
  const end = new Date(now + horizonMs);
  // Start from the current month's last day.
  let cursor = lastDayOfMonth(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth());
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getTime() >= now) {
      const days = daysUntil(cursor.toISOString(), now);
      out.push({
        id:        `evt-top-reset-${isoDate(cursor)}`,
        type:      'take_or_pay_reset',
        date:      cursor.toISOString(),
        severity:  days <= 7 ? 'warn' : 'info',
        title:     `Take-or-pay floor resets`,
        body:      `End of ${cursor.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — month-end attainment locks in.`,
        link:      { path: '/financials', label: 'Open financials' },
        days_until: days,
      });
    }
    cursor = lastDayOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
  }
  return out;
}

function mapContractAnniversaries(now, horizonMs) {
  // Contract start anniversary — the offtake's annual review point.
  if (!CONTRACT_TERMS?.start_date) return [];
  const start = new Date(CONTRACT_TERMS.start_date + 'T00:00:00Z');
  const out = [];
  const end = new Date(now + horizonMs);
  // Compute next anniversary.
  let year = new Date(now).getUTCFullYear();
  let candidate = new Date(Date.UTC(year, start.getUTCMonth(), start.getUTCDate()));
  if (candidate.getTime() < now) candidate = new Date(Date.UTC(year + 1, start.getUTCMonth(), start.getUTCDate()));
  if (candidate.getTime() <= end.getTime()) {
    const days = daysUntil(candidate.toISOString(), now);
    out.push({
      id:        `evt-contract-${isoDate(candidate)}`,
      type:      'contract_anniversary',
      date:      candidate.toISOString(),
      severity:  days <= 30 ? 'warn' : 'info',
      title:     `${CONTRACT_TERMS.counterparty} contract anniversary`,
      body:      `Annual review point — ${CONTRACT_TERMS.term_years}-year term, ${CONTRACT_TERMS.renewal}.`,
      link:      { path: '/contract', label: 'Open contract' },
      days_until: days,
    });
  }
  return out;
}

// ── Compose ───────────────────────────────────────────────────────

function compose({ days = 30, now = Date.now() } = {}) {
  const horizonMs = days * ONE_DAY_MS;
  const cutoff = now + horizonMs;

  let events = [
    ...mapFilings(now),
    ...mapLicences(now),
    ...mapActionItems(now),
    ...mapContactFollowups(now),
    ...mapRiskSteps(now),
    ...mapRiskReviews(now),
    ...mapMaintenanceWindows(now),
    ...mapTakeOrPayResets(now, horizonMs),
    ...mapContractAnniversaries(now, horizonMs),
  ];

  // Filter to within the horizon (but always include overdue items —
  // they're past-due, not future, so the windowing rule is "show
  // anything not yet resolved that's either overdue or due within
  // the horizon").
  events = events.filter((e) => {
    const eventMs = new Date(e.date).getTime();
    return eventMs <= cutoff; // overdue AND in-window both pass
  });

  // Sort ascending by date; within a date, severity-first
  // (overdue → warn → info).
  const SEV_RANK = { overdue: 0, warn: 1, info: 2 };
  events.sort((a, b) => {
    const da = a.date.localeCompare(b.date);
    if (da !== 0) return da;
    return (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3);
  });

  // Counts useful for KPI tiles on the page.
  const counts = events.reduce((m, e) => {
    m.total++;
    m[e.severity] = (m[e.severity] || 0) + 1;
    m.by_type[e.type] = (m.by_type[e.type] || 0) + 1;
    return m;
  }, { total: 0, overdue: 0, warn: 0, info: 0, by_type: {} });

  return {
    generated_at: new Date(now).toISOString(),
    horizon: { days, until: new Date(cutoff).toISOString() },
    counts,
    events,
  };
}

module.exports = { compose };
