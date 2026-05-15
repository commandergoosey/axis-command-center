/*
 * FleetAvailabilityStrip — Phase 157.
 * Per-hauler fleet availability breakdown derived from availability_by_hauler
 * in GET /api/fleet. Shows active / garage / idle counts with inline
 * progress bars so ops can immediately spot which hauler is under-utilising.
 *
 * Props:
 *   availabilityByHauler — availability_by_hauler array from /api/fleet
 */

export default function FleetAvailabilityStrip({ availabilityByHauler }) {
  if (!availabilityByHauler || availabilityByHauler.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Fleet availability · by hauler</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Active · garage · idle counts
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {availabilityByHauler.map((h, i) => {
          const activePct = h.total > 0 ? (h.active  / h.total) * 100 : 0;
          const garagePct = h.total > 0 ? (h.garage  / h.total) * 100 : 0;
          const idlePct   = h.total > 0 ? (h.idle    / h.total) * 100 : 0;
          const utilPct   = Math.round(activePct);
          const utilColor = utilPct >= 75 ? 'var(--signal-green)'
                          : utilPct >= 50 ? 'var(--signal-amber)'
                          : 'var(--bauxite-rust)';

          return (
            <div
              key={h.hauler_id}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: i < availabilityByHauler.length - 1
                              ? '1px solid var(--border-hairline)'
                              : 'none',
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <span style={{
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      'var(--text)',
                  flex: 1,
                }}>
                  {h.display_name}
                </span>

                {/* Count chips */}
                {[
                  { label: 'active',  count: h.active,  color: 'var(--signal-green)'  },
                  { label: 'garage',  count: h.garage,  color: 'var(--signal-amber)'  },
                  { label: 'idle',    count: h.idle,    color: 'var(--text-tertiary)' },
                ].map(({ label, count, color }) => (
                  <span key={label} style={{
                    fontSize:     'var(--ts-caption-size)',
                    fontFamily:   'var(--font-mono)',
                    color,
                    whiteSpace:   'nowrap',
                  }}>
                    {count} {label}
                  </span>
                ))}

                {/* Flagged badge */}
                {h.flagged > 0 && (
                  <span style={{
                    fontSize:     'var(--ts-caption-size)',
                    fontFamily:   'var(--font-mono)',
                    color:        'var(--bauxite-rust)',
                    background:   'rgba(139,46,26,0.10)',
                    borderRadius: 'var(--radius-sm)',
                    padding:      '1px 6px',
                    whiteSpace:   'nowrap',
                  }}>
                    ⚑ {h.flagged} flagged
                  </span>
                )}

                {/* Utilisation % */}
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   'var(--ts-caption-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      utilColor,
                  minWidth:   40,
                  textAlign:  'right',
                }}>
                  {utilPct}%
                </span>
              </div>

              {/* Stacked progress bar */}
              <div style={{
                height:       6,
                borderRadius: 3,
                background:   'var(--border-soft)',
                overflow:     'hidden',
                display:      'flex',
              }}>
                <div style={{ width: `${activePct}%`,  background: 'var(--signal-green)',  transition: 'width 0.4s' }} />
                <div style={{ width: `${garagePct}%`,  background: 'var(--signal-amber)',  transition: 'width 0.4s' }} />
                <div style={{ width: `${idlePct}%`,    background: 'var(--text-tertiary)', opacity: 0.35, transition: 'width 0.4s' }} />
              </div>

              {/* Sub-caption */}
              <div style={{
                marginTop:  4,
                fontSize:   'var(--ts-caption-size)',
                color:      'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}>
                {h.total} trucks total
                {h.flagged > 0 ? ` · ${h.flagged} on maintenance watch` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
