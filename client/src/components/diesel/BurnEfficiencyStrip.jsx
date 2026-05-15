/*
 * BurnEfficiencyStrip — Phase 149.
 * Per-hauler fuel cost per tonne vs the corridor average.
 * Sorted worst-first so the coaching signal is immediate:
 * the hauler at the top is burning the most per tonne above average.
 *
 * Props:
 *   burnRanking — burn_ranking from /api/diesel
 *   corridorAvg — fleet_burn.corridor_avg_fuel_usd_per_tonne
 */

const MAX_DEVIATION_PCT = 15; // bar width normalisation cap

function barColor(vsPct) {
  if (vsPct > 8)  return 'var(--bauxite-rust)';
  if (vsPct > 3)  return 'var(--signal-amber)';
  if (vsPct >= 0) return 'var(--signal-green)';
  return 'var(--signal-green)'; // below average — positive
}

function deviationLabel(vsPct) {
  if (vsPct === 0) return '— avg';
  const sign = vsPct > 0 ? '+' : '';
  return `${sign}${vsPct}% vs avg`;
}

export default function BurnEfficiencyStrip({ burnRanking, corridorAvg }) {
  if (!burnRanking || burnRanking.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Fuel burn efficiency · by hauler</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          corridor avg {corridorAvg != null ? `$${corridorAvg.toFixed(2)}/t` : '—'} · worst first
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {burnRanking.map((h, idx) => {
          const isLast  = idx === burnRanking.length - 1;
          const color   = barColor(h.vs_avg_pct);
          const barPct  = Math.min(100, (Math.abs(h.vs_avg_pct) / MAX_DEVIATION_PCT) * 100);
          const above   = h.vs_avg_pct > 0;

          return (
            <div
              key={h.hauler_id}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
              }}
            >
              {/* Header row */}
              <div style={{
                display:        'flex',
                alignItems:     'baseline',
                justifyContent: 'space-between',
                gap:            8,
                marginBottom:   6,
                flexWrap:       'wrap',
              }}>
                <span style={{
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      'var(--text)',
                  flex:       '1 1 120px',
                }}>
                  {h.display_name}
                </span>

                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color:    'var(--text-tertiary)',
                  flexShrink: 0,
                }}>
                  {h.trip_count} laden trip{h.trip_count !== 1 ? 's' : ''}
                </span>

                {/* Deviation badge */}
                <span
                  className="mono"
                  style={{
                    fontSize:      9,
                    padding:       '2px 7px',
                    border:        `1px solid ${color}40`,
                    borderRadius:  3,
                    color,
                    letterSpacing: '0.06em',
                    flexShrink:    0,
                  }}
                >
                  {deviationLabel(h.vs_avg_pct)}
                </span>

                {/* $/tonne value */}
                <span
                  className="tabular"
                  style={{
                    fontSize:   'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-semibold)',
                    color:      above ? color : 'var(--signal-green)',
                    minWidth:   54,
                    textAlign:  'right',
                    flexShrink: 0,
                  }}
                >
                  ${h.fuel_usd_per_tonne.toFixed(2)}/t
                </span>
              </div>

              {/* Deviation bar — width = |deviation| relative to cap */}
              <div style={{
                height:       4,
                background:   'var(--border-hairline)',
                borderRadius: 2,
                overflow:     'hidden',
              }}>
                <div style={{
                  height:     '100%',
                  width:      `${barPct}%`,
                  background: color,
                  opacity:    0.75,
                  borderRadius: 2,
                  transition: 'width 500ms ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
