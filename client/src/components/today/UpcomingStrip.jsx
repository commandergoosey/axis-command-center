/*
 * UpcomingStrip — Phase 73.
 *
 * Compact 7-day forward-looking timeline mounted on Today's right
 * rail. Surfaces just the highest-severity events from the
 * upcoming-events feed so the operator sees a tightly-packed
 * "what's hitting this week" callout without leaving Today.
 *
 * Composed server-side via /api/today/calendar?days=7. All roles.
 * The full calendar lives at /calendar (Phase 73 page).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, FileText, IdCard, ClipboardCheck, Phone, ShieldAlert, Coins, FileSignature,
  ArrowRight,
} from 'lucide-react';
import { authFetch } from '../../lib/auth';

const TYPE_META = {
  filing:                { icon: FileText },
  licence:               { icon: IdCard },
  action_item:           { icon: ClipboardCheck },
  contact_followup:      { icon: Phone },
  risk_review:           { icon: ShieldAlert },
  take_or_pay_reset:     { icon: Coins },
  contract_anniversary:  { icon: FileSignature },
};
const TONE = {
  overdue: 'var(--bauxite-rust)',
  warn:    'var(--signal-amber)',
  info:    'var(--text-secondary)',
};

const HORIZON_DAYS = 7;
const MAX_VISIBLE = 5;

export default function UpcomingStrip({ refreshKey }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    let abort = false;
    authFetch(`/api/today/calendar?days=${HORIZON_DAYS}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!abort && j) setData(j); })
      .catch(() => { /* advisory */ });
    return () => { abort = true; };
  }, [refreshKey]);

  if (!data || !data.events || data.events.length === 0) return null;

  const visible = data.events.slice(0, MAX_VISIBLE);
  const overflow = data.events.length - visible.length;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CalendarDays size={12} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Next 7 days</span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/calendar')}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--bauxite-rust)',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          full calendar
          <ArrowRight size={10} strokeWidth={1.6} />
        </button>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.map((e) => <Row key={e.id} event={e} navigate={navigate} />)}
      </div>

      {overflow > 0 && (
        <div style={{
          marginTop: 6,
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          textAlign: 'center',
        }}>
          +{overflow} more this week
        </div>
      )}
    </section>
  );
}

function Row({ event, navigate }) {
  const Icon = TYPE_META[event.type]?.icon || CalendarDays;
  const tone = TONE[event.severity] || 'var(--text-secondary)';
  const d = event.days_until;
  const rel = d < 0 ? `${-d}d ago`
            : d === 0 ? 'today'
            : d === 1 ? 'tomorrow'
            : `in ${d}d`;
  return (
    <div
      onClick={event.link ? () => navigate(event.link.path) : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        columnGap: 8,
        alignItems: 'center',
        padding: '6px 8px',
        background: 'var(--surface)',
        borderRadius: 'var(--radius-sm)',
        borderLeft: `2px solid ${tone}`,
        cursor: event.link ? 'pointer' : 'default',
      }}
    >
      <Icon size={11} strokeWidth={1.6} color={tone} />
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {event.title}
      </span>
      <span className="mono tabular" style={{
        fontSize: 10, color: tone,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}>
        {rel}
      </span>
    </div>
  );
}
