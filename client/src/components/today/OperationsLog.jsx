/*
 * OperationsLog — "what got done on the corridor today."
 *
 * Phase 38 — composes audit_log writes since UTC start-of-day with
 * the auto-cleared alerts from Phase 37 telemetry. Sits at the bottom
 * of Today's left column as the narrative complement to Action items
 * (which says "what to do next").
 *
 * Each row: time · entity icon · summary · actor name. Rows compress
 * vertically; long days are capped server-side at 30 entries.
 *
 * Visibility: axis_admin / axis_ops see the full corridor feed.
 * hauler_admin sees only their own. Lender sees a lock placeholder.
 */

import { useEffect, useState } from 'react';
import {
  ShieldCheck, ClipboardList, Wrench, FileCheck2, Users,
  AlertOctagon, Bell, Zap, Printer,
} from 'lucide-react';
import { authFetch } from '../../lib/auth';

const ENTITY_ICON = {
  hse_incident:     <AlertOctagon size={12} />,
  licence:          <ShieldCheck  size={12} />,
  filing:           <FileCheck2   size={12} />,
  workorder:        <Wrench       size={12} />,
  coaching_session: <Users        size={12} />,
  alert:            <Bell         size={12} />,
};

const ACTION_LABEL = {
  create:     'logged',
  close:      'closed',
  open:       'opened',
  progress:   'progressed',
  resolve:    'resolved',
  renew:      'renewed',
  mark_filed: 'marked filed',
  auto_clear: 'auto-cleared',
};

export default function OperationsLog() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await authFetch('/api/today/operations-log');
        if (res.status === 403) {
          if (!abort) setData({ restricted: true });
          return;
        }
        if (!res.ok) throw new Error(`operations-log ${res.status}`);
        const d = await res.json();
        if (!abort) setData(d);
      } catch (err) {
        if (!abort) setError(err.message);
      }
    })();
    return () => { abort = true; };
  }, []);

  if (data?.restricted) return null;
  if (error) return null;
  if (!data) return null;

  const { entries = [], counts = {} } = data;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">Operations log · today</div>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}>
            {counts.writes ?? 0} write{counts.writes === 1 ? '' : 's'} ·{' '}
            {counts.auto_cleared ?? 0} alert{counts.auto_cleared === 1 ? '' : 's'} auto-cleared by lifecycle
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {entries.length === 0 && (
            <span style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
            }}>
              Quiet so far
            </span>
          )}
          {/* Phase 40 — print-friendly end-of-day digest in a new tab.
              Lives here (not in the page header) because the digest is
              fundamentally "operations log plus context" — adjacent
              placement makes the relationship obvious. */}
          <a
            href="/today/digest"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              fontFamily: 'inherit',
            }}
            title="Open the printable end-of-day digest in a new tab"
          >
            <Printer size={12} strokeWidth={1.6} />
            Print digest
          </a>
        </div>
      </header>

      {entries.length === 0 ? (
        <p style={{
          margin: 0,
          padding: 'var(--space-3) 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          No corridor activity recorded today yet.
        </p>
      ) : (
        <ol style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {entries.map((e) => (
            <li
              key={e.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto auto 1fr auto',
                columnGap: 'var(--space-3)',
                alignItems: 'baseline',
                padding: '6px 0',
                borderTop: '1px solid var(--border-hairline)',
                fontSize: 'var(--ts-body-sm-size)',
              }}
            >
              <time
                className="mono tabular"
                style={{
                  color: 'var(--text-tertiary)',
                  fontSize: 11,
                }}
              >
                {formatTime(e.ts)}
              </time>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  color: e.action === 'auto_clear' ? 'var(--signal-green)' : 'var(--text-secondary)',
                }}
                title={`${e.entity_type} / ${e.action}`}
              >
                {ENTITY_ICON[e.entity_type] ?? <Zap size={12} />}
              </span>
              <span style={{ color: 'var(--text)' }}>
                {e.summary}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  whiteSpace: 'nowrap',
                }}
                title={e.actor?.role || ''}
              >
                {actorShort(e.actor)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatTime(iso) {
  // 2026-04-26T20:21:24.317Z → "20:21"
  return iso.slice(11, 16);
}

function actorShort(actor) {
  if (!actor) return '—';
  if (actor.role === 'system') return 'lifecycle';
  return actor.display_name?.split(' ')[0] ?? actor.email ?? '—';
}
