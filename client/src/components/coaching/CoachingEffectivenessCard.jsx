/*
 * CoachingEffectivenessCard — Phase 144.
 * Shows the expected safety improvement ROI per coaching cohort tier,
 * derived from recent sessions' expected_delta_pct values. Gives ops a
 * quick read on whether coaching effort is targeting the right tiers.
 *
 * Props:
 *   summary — effectiveness_summary from /api/coaching/pipeline
 */

const TIER_META = {
  urgent:  { label: 'Urgent',  color: 'var(--bauxite-rust)',  bg: 'rgba(139,46,26,0.06)' },
  high:    { label: 'High',    color: 'var(--bauxite-rust)',  bg: 'rgba(139,46,26,0.04)' },
  medium:  { label: 'Medium',  color: 'var(--signal-amber)', bg: 'rgba(251,191,36,0.06)' },
  routine: { label: 'Routine', color: 'var(--text-secondary)',bg: 'var(--surface-raised)' },
};

const MAX_DELTA = 12; // cap for bar width normalisation

export default function CoachingEffectivenessCard({ summary }) {
  if (!summary || summary.length === 0) return null;

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Coaching effectiveness · expected safety delta by tier
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {summary.map((row, idx) => {
          const meta    = TIER_META[row.tier] ?? TIER_META.routine;
          const barPct  = Math.min(100, (row.avg_expected_delta_pct / MAX_DELTA) * 100);
          const isLast  = idx === summary.length - 1;
          return (
            <div
              key={row.tier}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
                background:   meta.bg,
              }}
            >
              <div style={{
                display:        'flex',
                alignItems:     'center',
                gap:            'var(--space-4)',
                flexWrap:       'wrap',
                marginBottom:   8,
              }}>
                {/* Tier badge */}
                <span
                  className="mono"
                  style={{
                    fontSize:      9,
                    padding:       '2px 7px',
                    border:        `1px solid ${meta.color}40`,
                    borderRadius:  3,
                    color:         meta.color,
                    letterSpacing: '0.09em',
                    textTransform: 'uppercase',
                    flexShrink:    0,
                    minWidth:      56,
                    textAlign:     'center',
                  }}
                >
                  {meta.label}
                </span>

                {/* Session + attendee count */}
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color:    'var(--text-tertiary)',
                }}>
                  {row.sessions} session{row.sessions !== 1 ? 's' : ''} · {row.attendees} driver{row.attendees !== 1 ? 's' : ''}
                </span>

                {/* Delta value */}
                <span
                  className="tabular"
                  style={{
                    marginLeft:  'auto',
                    fontSize:    'var(--ts-body-sm-size)',
                    fontWeight:  'var(--fw-semibold)',
                    color:       meta.color,
                  }}
                >
                  +{row.avg_expected_delta_pct}% avg safety lift
                </span>
              </div>

              {/* Progress bar */}
              <div style={{
                height:       3,
                background:   'var(--border-hairline)',
                borderRadius: 2,
                overflow:     'hidden',
              }}>
                <div style={{
                  height:     '100%',
                  width:      `${barPct}%`,
                  background: meta.color,
                  opacity:    0.65,
                  borderRadius: 2,
                  transition: 'width 600ms ease',
                }} />
              </div>
            </div>
          );
        })}

        {/* Footer note */}
        <div style={{
          padding:    'var(--space-2) var(--space-4)',
          borderTop:  '1px solid var(--border-hairline)',
          fontSize:   'var(--ts-caption-size)',
          color:      'var(--text-tertiary)',
          fontStyle:  'italic',
        }}>
          Expected delta is self-reported by the dispatcher at session time. Verify against actual safety score trend.
        </div>
      </div>
    </section>
  );
}
