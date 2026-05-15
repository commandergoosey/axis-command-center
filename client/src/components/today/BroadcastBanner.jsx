/*
 * BroadcastBanner — Phase 85.
 *
 * Corridor-wide announcements visible to the calling user's
 * audience filter. Renders the most-urgent active broadcast
 * inline at the top of Today (and MyHauler), with a "+N more"
 * disclosure that expands the rest in place.
 *
 * Hidden when there's nothing active for the role.
 */

import { useEffect, useState } from 'react';
import { Megaphone, ChevronDown, ChevronUp, X } from 'lucide-react';
import { authFetch } from '../../lib/auth';

const TONE = {
  urgent: { color: 'var(--bauxite-rust)', bg: 'rgba(139, 46, 26, 0.06)', label: 'URGENT' },
  warn:   { color: 'var(--signal-amber)', bg: 'rgba(217, 158, 55, 0.06)', label: 'NOTICE' },
  info:   { color: 'var(--text-secondary)', bg: 'transparent',           label: 'INFO' },
};

export default function BroadcastBanner({ refreshKey }) {
  const [items, setItems] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let abort = false;
    authFetch('/api/broadcasts/active')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!abort && j) setItems(j.broadcasts || []); })
      .catch(() => { /* advisory */ });
    return () => { abort = true; };
  }, [refreshKey]);

  if (!items || items.length === 0) return null;

  const [first, ...rest] = items;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <BroadcastCard broadcast={first} />
      {rest.length > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={moreLinkStyle}
        >
          <ChevronDown size={11} strokeWidth={1.6} />
          {rest.length} more announcement{rest.length === 1 ? '' : 's'}
        </button>
      )}
      {expanded && rest.map((b) => <BroadcastCard key={b.id} broadcast={b} />)}
      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={moreLinkStyle}
        >
          <ChevronUp size={11} strokeWidth={1.6} />
          Collapse
        </button>
      )}
    </section>
  );
}

function BroadcastCard({ broadcast }) {
  const tone = TONE[broadcast.severity] || TONE.info;
  const ts = new Date(broadcast.posted_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', timeZone: 'UTC',
  });
  return (
    <div style={{
      background: tone.bg,
      border: `1px solid color-mix(in srgb, ${tone.color} 28%, transparent)`,
      borderLeft: `3px solid ${tone.color}`,
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      columnGap: 12,
      alignItems: 'flex-start',
    }}>
      <Megaphone size={14} strokeWidth={1.6} color={tone.color} style={{ marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 4,
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
            <span className="mono" style={{
              fontSize: 9,
              letterSpacing: '0.08em',
              color: tone.color,
              fontWeight: 'var(--fw-medium)',
            }}>
              {tone.label}
            </span>
            <span style={{
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {broadcast.title}
            </span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {broadcast.posted_by?.display_name && (
              <>{broadcast.posted_by.display_name} · </>
            )}
            <span className="mono">{ts}</span>
          </span>
        </div>
        <p style={{
          margin: 0,
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}>
          {broadcast.body}
        </p>
      </div>
    </div>
  );
}

const moreLinkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  padding: '4px 0',
  cursor: 'pointer',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--bauxite-rust)',
  fontFamily: 'inherit',
  alignSelf: 'flex-start',
};
