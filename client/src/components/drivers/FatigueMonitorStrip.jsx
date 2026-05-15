/*
 * FatigueMonitorStrip — Phase 143.
 * Flags drivers approaching the 70h weekly hours-of-service ceiling.
 * Data comes from /api/drivers/leaderboard → fatigue_flags.
 * Advisory only — operators must verify against driver logs before action.
 *
 * Severity tiers (matching server):
 *   WATCH    ≥ 60h  · green/neutral — note in next coaching session
 *   WARNING  ≥ 65h  · amber         — consider early rest, reshuffle schedule
 *   CRITICAL ≥ 68h  · rust          — remove from rotation, mandatory rest
 *
 * Props:
 *   flags — fatigue_flags array from leaderboard response
 */

const HOS_CEILING = 70;

const SEVERITY_META = {
  CRITICAL: {
    color:  'var(--bauxite-rust)',
    bg:     'rgba(139,46,26,0.08)',
    border: 'rgba(139,46,26,0.28)',
    action: 'Remove from rotation — mandatory rest',
  },
  WARNING: {
    color:  'var(--signal-amber)',
    bg:     'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.28)',
    action: 'Consider schedule reshuffle',
  },
  WATCH: {
    color:  'var(--text-secondary)',
    bg:     'var(--surface-raised)',
    border: 'var(--border-hairline)',
    action: 'Note in next coaching session',
  },
};

export default function FatigueMonitorStrip({ flags }) {
  if (!flags || flags.length === 0) return null;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Fatigue monitor · hours-of-service</div>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          {flags.length} driver{flags.length !== 1 ? 's' : ''} ≥ 60h this week · 70h ceiling · advisory
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {flags.map((d, idx) => {
          const meta   = SEVERITY_META[d.severity] ?? SEVERITY_META.WATCH;
          const barPct = Math.min(100, (d.hours_this_week / HOS_CEILING) * 100);
          return (
            <div
              key={d.driver_id}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: idx < flags.length - 1
                  ? '1px solid var(--border-hairline)'
                  : 'none',
                borderLeft:   `3px solid ${meta.color}`,
                background:   meta.bg,
              }}
            >
              {/* Row: name, hauler, hours, severity, action */}
              <div style={{
                display:        'flex',
                alignItems:     'center',
                gap:            'var(--space-4)',
                flexWrap:       'wrap',
                marginBottom:   8,
              }}>
                {/* Name */}
                <div style={{
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      'var(--text)',
                  flex:       '1 1 150px',
                }}>
                  {d.full_name}
                </div>

                {/* Hauler */}
                <div style={{
                  fontSize: 'var(--ts-caption-size)',
                  color:    'var(--text-tertiary)',
                  flex:     '1 1 120px',
                }}>
                  {d.hauler_display}
                </div>

                {/* Hours */}
                <div style={{
                  display:     'flex',
                  alignItems:  'baseline',
                  gap:         4,
                  flexShrink:  0,
                }}>
                  <span
                    className="tabular"
                    style={{
                      fontSize:   'var(--ts-h4-size, 18px)',
                      fontWeight: 'var(--fw-semibold)',
                      color:      meta.color,
                      lineHeight: 1,
                    }}
                  >
                    {d.hours_this_week}h
                  </span>
                  <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                    / {HOS_CEILING}h ceiling
                  </span>
                </div>

                {/* Severity badge */}
                <span
                  className="mono"
                  style={{
                    fontSize:      9,
                    padding:       '2px 7px',
                    background:    meta.bg,
                    border:        `1px solid ${meta.border}`,
                    borderRadius:  3,
                    color:         meta.color,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    flexShrink:    0,
                  }}
                >
                  {d.severity}
                </span>

                {/* Recommended action */}
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color:    'var(--text-tertiary)',
                  fontStyle:'italic',
                  flex:     '1 1 180px',
                }}>
                  {meta.action}
                </span>
              </div>

              {/* HOS progress bar */}
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
                  borderRadius: 2,
                  transition: 'width 600ms ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
