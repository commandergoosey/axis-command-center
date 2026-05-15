/*
 * ObservationFeed — right column, 3–5 insight cards.
 * Phase 3 renders hand-authored observations from /api/today. Phase 7
 * replaces the source with live AXIS Intelligence summaries — layout holds.
 */

import { AlertTriangle, Info } from 'lucide-react';

const SEV_MAP = {
  warn: { icon: AlertTriangle, color: 'var(--signal-amber)', ring: 'rgba(184, 134, 11, 0.22)' },
  info: { icon: Info,          color: 'var(--iron)',         ring: 'var(--border-soft)' },
};

export default function ObservationFeed({ observations }) {
  return (
    <section>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div className="eyebrow">Observations</div>
        <span
          className="mono"
          style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
          }}
        >
          {observations?.length ?? 0} / 5
        </span>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {observations?.map((obs) => {
          const Sev = SEV_MAP[obs.severity] ?? SEV_MAP.info;
          const Icon = Sev.icon;
          return (
            <article
              key={obs.id}
              style={{
                background: 'var(--surface-raised)',
                border: `1px solid ${Sev.ring}`,
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-3)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <Icon size={14} strokeWidth={1.5} color={Sev.color} style={{ marginTop: 2, flexShrink: 0 }} />
              <p style={{
                margin: 0,
                fontSize: 'var(--ts-body-sm-size)',
                lineHeight: 'var(--ts-body-sm-lh)',
                color: 'var(--text)',
              }}>
                {obs.body}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
