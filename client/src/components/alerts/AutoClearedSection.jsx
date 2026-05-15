/*
 * AutoClearedSection — Phase 39.
 *
 * Static alerts that the alertSynth filter suppressed because the
 * underlying lifecycle entity is now resolved (licence renewed,
 * dispatcher coached, HSE incident closed). The synth drops them from
 * the active list, but operators were left wondering "where did that
 * alert go?". This collapsible section restores the breadcrumb and
 * shows WHY each one cleared, with a deep-link to the remediating
 * record on /compliance.
 *
 * No triage controls — these aren't actionable. If the underlying
 * lifecycle gets undone (licence overlay deleted, etc.) the alert
 * automatically reappears in the active list on the next read.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, GraduationCap, AlertOctagon, ArrowUpRight } from 'lucide-react';

const KIND_ICON = {
  licence_renewed:  ShieldCheck,
  coaching_logged:  GraduationCap,
  hse_closed:       AlertOctagon,
};

const SEVERITY_DOT = {
  CRITICAL: 'var(--bauxite-rust)',
  WARNING:  'var(--signal-amber)',
  INFO:     'var(--iron)',
};

const TYPE_LABEL = {
  axle_load_breach: 'Axle load',
  licence_expiry:   'Licence',
  hse_event:        'HSE',
};

export default function AutoClearedSection({ alerts }) {
  const [open, setOpen] = useState(false);
  const count = alerts.length;
  if (count === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className="eyebrow" style={{ color: 'var(--text-secondary)' }}>
            Auto-cleared by lifecycle · {count}
          </span>
          <span style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            Suppressed because the root cause was remediated
          </span>
        </span>
        <span className="mono" style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.04em',
        }}>
          {open ? 'HIDE' : 'SHOW'}
        </span>
      </button>

      {open && (
        <ul style={{
          listStyle: 'none',
          margin: 'var(--space-3) 0 0 0',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}>
          {alerts.map((a) => <ClearedRow key={a.id} alert={a} />)}
        </ul>
      )}
    </section>
  );
}

function ClearedRow({ alert }) {
  const navigate = useNavigate();
  const Icon = KIND_ICON[alert.cleared_by?.kind] ?? ShieldCheck;
  const severityColor = SEVERITY_DOT[alert.severity] ?? 'var(--iron)';
  const link = alert.cleared_by?.link;

  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: 'var(--space-3)',
      alignItems: 'center',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      // De-emphasise — these are settled events, not work
      opacity: 0.92,
    }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28, height: 28,
        borderRadius: '50%',
        background: 'rgba(46, 107, 63, 0.10)',
        color: 'var(--signal-green)',
      }}>
        <Icon size={14} />
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}>
          <span style={{
            display: 'inline-block',
            width: 6, height: 6, borderRadius: '50%',
            background: severityColor,
          }} />
          <span className="micro" style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.06em',
          }}>
            {TYPE_LABEL[alert.type] ?? alert.type?.toUpperCase()}
          </span>
          <span style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text)',
            fontWeight: 'var(--fw-medium)',
          }}>
            {alert.title}
          </span>
          {alert.hauler_display_name && (
            <span style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
            }}>
              · {alert.hauler_display_name}
            </span>
          )}
        </div>
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
          marginTop: 4,
        }}>
          {alert.cleared_by?.reason}
          {alert.cleared_by?.actor && (
            <span style={{ color: 'var(--text-tertiary)' }}>
              {' · '}{alert.cleared_by.actor}
              {alert.cleared_by.when && ` · ${formatWhen(alert.cleared_by.when)}`}
            </span>
          )}
        </div>
      </div>

      {link && (
        <button
          type="button"
          onClick={() => navigate(link.path)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
          title={link.label}
        >
          {link.label}
          <ArrowUpRight size={12} />
        </button>
      )}
    </li>
  );
}

function formatWhen(iso) {
  // 2026-04-27T14:29:35.078Z → "27 Apr 14:29"
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day   = d.getUTCDate().toString().padStart(2, '0');
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh    = d.getUTCHours().toString().padStart(2, '0');
  const mm    = d.getUTCMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}
