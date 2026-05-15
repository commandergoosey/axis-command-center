/*
 * DeadlineCountdownStrip — Phase 150.
 * Unified countdown of upcoming driver licence and regulatory filing
 * deadlines within the next 90 days. Sorted urgency-first (overdue
 * at top, then nearest expiry). Colour-coded by time remaining:
 *   Overdue / ≤7 days  → rust
 *   ≤30 days           → amber
 *   31–90 days         → neutral
 *
 * Props:
 *   deadlines — upcoming_deadlines from /api/compliance
 */

function urgencyMeta(days, overdue) {
  if (overdue || days <= 0)  return { color: 'var(--bauxite-rust)',  bg: 'rgba(139,46,26,0.04)', label: 'OVERDUE' };
  if (days <= 7)             return { color: 'var(--bauxite-rust)',  bg: 'rgba(139,46,26,0.04)', label: `${days}d` };
  if (days <= 30)            return { color: 'var(--signal-amber)',  bg: 'rgba(251,191,36,0.04)', label: `${days}d` };
  return                            { color: 'var(--text-secondary)', bg: 'transparent',          label: `${days}d` };
}

function kindLabel(kind) {
  return kind === 'filing' ? 'Filing' : 'Licence';
}

export default function DeadlineCountdownStrip({ deadlines }) {
  if (!deadlines || deadlines.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Upcoming compliance deadlines</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          licences + filings · next 90 days
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {deadlines.map((d, idx) => {
          const meta   = urgencyMeta(d.days_remaining, d.overdue);
          const isLast = idx === deadlines.length - 1;

          return (
            <div
              key={d.id}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          'var(--space-3)',
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
                borderLeft:   `3px solid ${meta.color}`,
                background:   meta.bg,
                flexWrap:     'wrap',
              }}
            >
              {/* Kind chip */}
              <span
                className="mono"
                style={{
                  fontSize:      9,
                  padding:       '2px 6px',
                  border:        `1px solid ${meta.color}40`,
                  borderRadius:  3,
                  color:         meta.color,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  flexShrink:    0,
                  minWidth:      44,
                  textAlign:     'center',
                }}
              >
                {kindLabel(d.kind)}
              </span>

              {/* Label (detail text) */}
              <div style={{
                flex:       '1 1 180px',
                fontSize:   'var(--ts-body-sm-size)',
                color:      'var(--text)',
                lineHeight: 1.4,
              }}>
                {d.label}
                {d.hauler_display && (
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 6, fontSize: 'var(--ts-caption-size)' }}>
                    {d.hauler_display}
                  </span>
                )}
                {d.agency && (
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 6, fontSize: 'var(--ts-caption-size)' }}>
                    {d.agency}
                  </span>
                )}
              </div>

              {/* Due date */}
              <span style={{
                fontSize:   'var(--ts-caption-size)',
                color:      'var(--text-tertiary)',
                flexShrink: 0,
              }}>
                due {d.due_date}
              </span>

              {/* Countdown badge */}
              <span
                className="tabular"
                style={{
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-semibold)',
                  color:      meta.color,
                  minWidth:   48,
                  textAlign:  'right',
                  flexShrink: 0,
                }}
              >
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
