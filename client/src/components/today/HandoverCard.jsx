/*
 * HandoverCard — Phase 67.
 *
 * The first thing the incoming operator reads on Today: a narrative
 * left by the outgoing shift covering what's outstanding, what's
 * been escalated, what's expected to land. Rendered prominently
 * near the top of the left column, between the dominant story and
 * the take-or-pay forecast.
 *
 * Hidden when no handover has been posted in the last 36 hours
 * (yesterday's note is still relevant; older ones are stale and
 * just clutter the cockpit).
 */

import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { authFetch } from '../../lib/auth';

const FRESHNESS_HOURS = 36;

export default function HandoverCard({ refreshKey }) {
  const [note, setNote] = useState(null);

  useEffect(() => {
    let abort = false;
    authFetch('/api/today/handover/latest')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!abort && j) setNote(j.handover); })
      .catch(() => { /* silent — card is decorative */ });
    return () => { abort = true; };
  }, [refreshKey]);

  if (!note) return null;
  const ageMs = Date.now() - new Date(note.created_at).getTime();
  if (ageMs > FRESHNESS_HOURS * 60 * 60 * 1000) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderLeft: '3px solid var(--bauxite-rust)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScrollText size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Handover from previous shift</span>
        </div>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          <span style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)' }}>
            {note.author?.display_name ?? 'Unknown'}
          </span>
          {' · '}
          <span className="mono tabular">{fmtRelative(note.created_at)}</span>
        </span>
      </header>
      <p style={{
        margin: 0,
        fontSize: 'var(--ts-body-size)',
        lineHeight: 'var(--ts-body-lh)',
        color: 'var(--text)',
        whiteSpace: 'pre-wrap',
      }}>
        {note.body}
      </p>
    </section>
  );
}

function fmtRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'UTC',
  }) + ' UTC';
}
