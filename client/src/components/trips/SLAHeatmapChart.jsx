/*
 * Phase 188 — SLA attainment heatmap (day-of-week × hauler).
 * Custom div grid: rows = haulers, cols = Mon–Sun, cells coloured
 * by on-time pct. No data cell rendered as a grey dimple.
 * Uses sla_heatmap from /api/trips.
 */

function cellColor(pct) {
  if (pct === null) return { bg: 'var(--border-hairline)', text: 'var(--text-tertiary)', label: '—' };
  if (pct >= 80)   return { bg: 'rgba(16,185,129,0.18)',  text: 'var(--signal-green)',  label: `${pct}%` };
  if (pct >= 60)   return { bg: 'rgba(245,158,11,0.18)',  text: 'var(--signal-amber)',  label: `${pct}%` };
  return           { bg: 'rgba(185,68,49,0.18)',          text: 'var(--bauxite-rust)',  label: `${pct}%` };
}

export default function SLAHeatmapChart({ slaHeatmap }) {
  if (!slaHeatmap?.length) return null;

  const days = slaHeatmap[0]?.days ?? [];
  const totalCells = slaHeatmap.reduce((s, h) => s + h.days.filter((d) => d.trips > 0).length, 0);
  const onTimeCells = slaHeatmap.reduce(
    (s, h) => s + h.days.filter((d) => d.trips > 0 && (d.on_time_pct ?? 0) >= 80).length,
    0,
  );
  const overallPct = totalCells > 0 ? Math.round((onTimeCells / totalCells) * 100) : null;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            SLA attainment — day of week × hauler
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Laden trips only · on-time = zero delay · green ≥ 80% · amber ≥ 60% · rust &lt; 60%
          </div>
        </div>
        {overallPct !== null && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 'var(--ts-h2-size, 22px)',
              fontWeight: 'var(--fw-black)',
              fontVariantNumeric: 'tabular-nums',
              color: overallPct >= 80 ? 'var(--signal-green)' : overallPct >= 60 ? 'var(--signal-amber)' : 'var(--bauxite-rust)',
              lineHeight: 1.1,
            }}>
              {overallPct}%
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              cells on-target
            </div>
          </div>
        )}
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3, width: '100%', tableLayout: 'auto', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{
                fontSize: 9,
                color: 'var(--text-tertiary)',
                textAlign: 'left',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '0 4px 6px 0',
                fontWeight: 'var(--fw-medium)',
                minWidth: 100,
              }}>
                Hauler
              </th>
              {days.map((d) => (
                <th key={d.dow} style={{
                  fontSize: 9,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 'var(--fw-medium)',
                  textAlign: 'center',
                  padding: '0 2px 6px',
                  whiteSpace: 'nowrap',
                }}>
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slaHeatmap.map((h) => (
              <tr key={h.hauler_id}>
                <td style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-secondary)',
                  paddingRight: 8,
                  paddingBottom: 3,
                  whiteSpace: 'nowrap',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {h.hauler_display}
                </td>
                {h.days.map((cell) => {
                  const { bg, text, label } = cellColor(cell.trips > 0 ? cell.on_time_pct : null);
                  return (
                    <td key={cell.dow} style={{ padding: 2, textAlign: 'center' }}>
                      <div
                        title={cell.trips > 0 ? `${cell.trips} trip${cell.trips !== 1 ? 's' : ''} · ${cell.on_time_pct ?? 0}% on time` : 'No data'}
                        style={{
                          background: bg,
                          borderRadius: 4,
                          padding: '4px 2px',
                          fontSize: 9,
                          fontVariantNumeric: 'tabular-nums',
                          color: text,
                          fontWeight: 'var(--fw-medium)',
                          minWidth: 36,
                          cursor: cell.trips > 0 ? 'default' : 'not-allowed',
                        }}
                      >
                        {label}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.3)' }} />
          ≥ 80% on time
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.3)' }} />
          60–79%
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(185,68,49,0.18)', border: '1px solid rgba(185,68,49,0.3)' }} />
          &lt; 60%
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--border-hairline)' }} />
          No data
        </div>
      </div>
    </div>
  );
}
