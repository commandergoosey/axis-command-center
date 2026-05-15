/*
 * Calendar — Phase 73.
 *
 * Forward-looking timeline aggregating every dated obligation in
 * the corridor: filings, driver licences, action item due dates,
 * hauler contact follow-ups, risk review cadences, take-or-pay
 * resets, and contract anniversaries.
 *
 * Composed server-side by services/upcomingEvents.js. The page
 * renders events grouped by date so the operator's eye runs down
 * a single column, with severity left-borders inheriting the same
 * cockpit signal palette (rust=overdue, amber=warn, text=info).
 *
 * Read-open to all roles — corridor-level governance data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, FileText, IdCard, ClipboardCheck,
  Phone, ShieldAlert, Coins, FileSignature, ArrowRight,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';

const TYPE_META = {
  filing:                { label: 'Filing',           icon: FileText },
  licence:               { label: 'Licence',          icon: IdCard },
  action_item:           { label: 'Action item',      icon: ClipboardCheck },
  contact_followup:      { label: 'Contact follow-up', icon: Phone },
  risk_review:           { label: 'Risk review',      icon: ShieldAlert },
  take_or_pay_reset:     { label: 'Take-or-pay reset', icon: Coins },
  contract_anniversary:  { label: 'Contract',         icon: FileSignature },
};

const SEVERITY_TONE = {
  overdue: 'var(--bauxite-rust)',
  warn:    'var(--signal-amber)',
  info:    'var(--text-secondary)',
};

const HORIZONS = [
  { days: 30,  label: '30 days' },
  { days: 60,  label: '60 days' },
  { days: 90,  label: '90 days' },
  { days: 180, label: '180 days' },
];

export default function Calendar() {
  const [horizon, setHorizon] = useState(60);
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [filterType, setFilterType] = useState(null);

  const load = useCallback((days) => {
    setError(null);
    authFetch(`/api/today/calendar?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(horizon); }, [horizon, load]);

  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    if (!filterType) return data.events;
    return data.events.filter((e) => e.type === filterType);
  }, [data, filterType]);

  const groups = useMemo(() => groupByDate(filteredEvents), [filteredEvents]);

  return (
    <PageShell
      eyebrow="Governance"
      title="Upcoming events"
      description="Forward-looking timeline of every dated obligation across the corridor — filings, driver licences, action items, contact follow-ups, risk reviews, take-or-pay resets, and contract anniversaries. Composed live."
    >
      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--bauxite-rust)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          fontSize: 'var(--ts-body-sm-size)',
          marginBottom: 'var(--space-4)',
        }}>
          Calendar feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <KpiStrip counts={data?.counts} horizon={horizon} />
        <FilterRow
          horizon={horizon}
          setHorizon={setHorizon}
          filterType={filterType}
          setFilterType={setFilterType}
          counts={data?.counts}
        />

        {data == null ? (
          <p style={emptyStyle}>Composing timeline…</p>
        ) : groups.length === 0 ? (
          <p style={emptyStyle}>
            {filterType
              ? `No ${TYPE_META[filterType]?.label.toLowerCase() ?? filterType} events in the next ${horizon} days.`
              : `No events in the next ${horizon} days.`}
          </p>
        ) : (
          <Timeline groups={groups} />
        )}
      </div>
    </PageShell>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ counts, horizon }) {
  const total = counts?.total ?? 0;
  const overdue = counts?.overdue ?? 0;
  const warn = counts?.warn ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile label={`Events · next ${horizon} days`} value={total} sub="across every dated obligation" tone={total === 0 ? 'tertiary' : 'text'} />
      <Tile label="Overdue" value={overdue} sub={overdue > 0 ? 'past their due date' : 'none past due'} tone={overdue > 0 ? 'rust' : 'green'} />
      <Tile label="Due in next 7 days" value={warn} sub={warn > 0 ? 'require near-term attention' : 'no near-term obligations'} tone={warn > 0 ? 'amber' : 'green'} />
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
        color, lineHeight: 1.05,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

// ── Filter row ────────────────────────────────────────────────────

function FilterRow({ horizon, setHorizon, filterType, setFilterType, counts }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>HORIZON</span>
      {HORIZONS.map((h) => (
        <Chip
          key={h.days}
          label={h.label}
          active={horizon === h.days}
          onClick={() => setHorizon(h.days)}
        />
      ))}
      <span style={{ width: 1, height: 18, background: 'var(--border-soft)' }} />
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>TYPE</span>
      <Chip
        label={`All${counts?.total != null ? ` · ${counts.total}` : ''}`}
        active={!filterType}
        onClick={() => setFilterType(null)}
      />
      {Object.entries(TYPE_META).map(([id, meta]) => {
        const n = counts?.by_type?.[id];
        if (!n) return null; // hide types with no events in window
        return (
          <Chip
            key={id}
            label={`${meta.label} · ${n}`}
            active={filterType === id}
            onClick={() => setFilterType((f) => f === id ? null : id)}
          />
        );
      })}
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--accent-tint)' : 'transparent',
        border: `1px solid ${active ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
        borderRadius: 999,
        fontSize: 'var(--ts-caption-size)',
        color: active ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Timeline ──────────────────────────────────────────────────────

function Timeline({ groups }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {groups.map((g) => <DateGroup key={g.date} group={g} />)}
      </div>
    </div>
  );
}

function DateGroup({ group }) {
  const labelDate = new Date(group.date + 'T00:00:00Z');
  const long = labelDate.toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long',
    timeZone: 'UTC',
  });
  const groupTone = group.events.some((e) => e.severity === 'overdue')
    ? SEVERITY_TONE.overdue
    : group.events.some((e) => e.severity === 'warn')
      ? SEVERITY_TONE.warn
      : SEVERITY_TONE.info;
  const dRel = group.daysUntil;
  const relLabel = dRel < 0 ? `${-dRel}d overdue`
                  : dRel === 0 ? 'today'
                  : dRel === 1 ? 'tomorrow'
                  : `in ${dRel} days`;
  return (
    <section>
      <header style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
        marginBottom: 8,
        paddingBottom: 4,
        borderBottom: '1px dashed var(--border-hairline)',
      }}>
        <span style={{
          fontSize: 'var(--ts-body-sm-size)',
          fontWeight: 'var(--fw-medium)',
          color: groupTone,
        }}>
          {long}
        </span>
        <span className="mono" style={{
          fontSize: 11, color: 'var(--text-tertiary)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          {relLabel}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {group.events.length} event{group.events.length === 1 ? '' : 's'}
        </span>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.events.map((e) => <EventRow key={e.id} event={e} />)}
      </div>
    </section>
  );
}

function EventRow({ event }) {
  const navigate = useNavigate();
  const meta = TYPE_META[event.type] || { label: event.type, icon: CalendarDays };
  const Icon = meta.icon;
  const tone = SEVERITY_TONE[event.severity] || 'var(--text-secondary)';
  return (
    <div
      onClick={event.link ? () => navigate(event.link.path) : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        columnGap: 12,
        alignItems: 'center',
        padding: '8px 12px',
        background: 'var(--surface)',
        border: '1px solid var(--border-hairline)',
        borderLeft: `3px solid ${tone}`,
        borderRadius: 'var(--radius-sm)',
        cursor: event.link ? 'pointer' : 'default',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: tone,
      }}>
        <Icon size={14} strokeWidth={1.6} />
        <span className="mono" style={{
          fontSize: 9, letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {meta.label}
        </span>
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontWeight: 'var(--fw-medium)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.title}
        </div>
        {event.body && (
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {event.body}
          </div>
        )}
      </div>
      {event.link && (
        <span style={{
          color: 'var(--text-tertiary)',
          fontSize: 'var(--ts-caption-size)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {event.link.label}
          <ArrowRight size={11} strokeWidth={1.6} />
        </span>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function groupByDate(events) {
  const map = new Map();
  for (const e of events) {
    const date = e.date.slice(0, 10);
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(e);
  }
  return Array.from(map.entries()).map(([date, events]) => {
    const dueMs = new Date(date + 'T00:00:00Z').getTime();
    const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const daysUntil = Math.round((dueMs - todayMs) / (24 * 60 * 60 * 1000));
    return { date, events, daysUntil };
  });
}

const emptyStyle = {
  margin: 0,
  padding: 'var(--space-5)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
  textAlign: 'center',
};
