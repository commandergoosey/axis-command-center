/*
 * RiskMatrix — Phase 139.
 * 5 × 4 likelihood × severity heat matrix. Each cell shows the count of
 * open (non-closed) risks. Color intensity reflects inherent risk exposure:
 * top-right (almost_certain × critical) is the highest-risk zone.
 *
 * Props:
 *   matrix — from /api/risks: array of { likelihood, cells[{severity,count}] }
 *   onCellClick(likelihood, severity) — optional filter hook for parent
 */

const LIKELIHOOD_LABELS = {
  rare:           'Rare',
  unlikely:       'Unlikely',
  possible:       'Possible',
  likely:         'Likely',
  almost_certain: 'Almost certain',
};
const SEVERITY_LABELS = {
  low:      'Low',
  medium:   'Medium',
  high:     'High',
  critical: 'Critical',
};

// Risk score = likelihood_idx (0–4) × severity_idx (0–3).
// Normalise to 0-1 for color mapping.
const LIKELIHOOD_ORDER = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'];
const SEVERITY_ORDER   = ['low', 'medium', 'high', 'critical'];

function cellRiskLevel(likelihoodKey, severityKey) {
  const li = LIKELIHOOD_ORDER.indexOf(likelihoodKey);
  const si = SEVERITY_ORDER.indexOf(severityKey);
  if (li < 0 || si < 0) return 0;
  return (li * SEVERITY_ORDER.length + si) / ((LIKELIHOOD_ORDER.length - 1) * (SEVERITY_ORDER.length - 1));
}

function cellColor(level, count) {
  if (count === 0) return 'transparent';
  if (level < 0.25) return 'rgba(74,222,128,0.18)';   // green zone
  if (level < 0.5)  return 'rgba(251,191,36,0.18)';   // amber zone
  if (level < 0.75) return 'rgba(251,146,60,0.22)';   // orange zone
  return 'rgba(139,46,26,0.22)';                       // rust zone
}

function cellBorder(level, count) {
  if (count === 0) return 'var(--border-hairline)';
  if (level < 0.25) return 'rgba(74,222,128,0.3)';
  if (level < 0.5)  return 'rgba(251,191,36,0.3)';
  if (level < 0.75) return 'rgba(251,146,60,0.35)';
  return 'rgba(139,46,26,0.4)';
}

function cellTextColor(level, count) {
  if (count === 0) return 'var(--text-tertiary)';
  if (level < 0.25) return 'var(--signal-green)';
  if (level < 0.5)  return 'var(--signal-amber)';
  if (level < 0.75) return 'rgba(251,146,60,1)';
  return 'var(--bauxite-rust)';
}

export default function RiskMatrix({ matrix, onCellClick }) {
  if (!matrix || !matrix.length) return null;

  // Reverse row order: highest likelihood at the top (Y axis reads up).
  const rows = [...matrix].reverse();

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Likelihood × severity matrix
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
        overflowX:    'auto',
      }}>
        {/* Column headers — severity */}
        <div style={{ display: 'flex', marginLeft: 116, marginBottom: 6, gap: 6 }}>
          {SEVERITY_ORDER.map((s) => (
            <div
              key={s}
              style={{
                flex:        1,
                minWidth:    72,
                textAlign:   'center',
                fontSize:    'var(--ts-caption-size)',
                color:       'var(--text-tertiary)',
                fontWeight:  'var(--fw-medium)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {SEVERITY_LABELS[s]}
            </div>
          ))}
        </div>

        {/* Matrix rows */}
        {rows.map((row) => (
          <div
            key={row.likelihood}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}
          >
            {/* Row label — likelihood */}
            <div style={{
              width:       110,
              flexShrink:  0,
              textAlign:   'right',
              fontSize:    'var(--ts-caption-size)',
              color:       'var(--text-tertiary)',
              paddingRight: 6,
            }}>
              {LIKELIHOOD_LABELS[row.likelihood]}
            </div>

            {/* Cells */}
            {row.cells.map((cell) => {
              const level = cellRiskLevel(row.likelihood, cell.severity);
              const bg     = cellColor(level, cell.count);
              const border = cellBorder(level, cell.count);
              const tc     = cellTextColor(level, cell.count);
              const clickable = onCellClick && cell.count > 0;
              return (
                <div
                  key={cell.severity}
                  onClick={clickable ? () => onCellClick(row.likelihood, cell.severity) : undefined}
                  title={`${LIKELIHOOD_LABELS[row.likelihood]} × ${SEVERITY_LABELS[cell.severity]}: ${cell.count} risk${cell.count !== 1 ? 's' : ''}`}
                  style={{
                    flex:          1,
                    minWidth:      72,
                    height:        52,
                    display:       'flex',
                    alignItems:    'center',
                    justifyContent:'center',
                    background:    bg,
                    border:        `1px solid ${border}`,
                    borderRadius:  'var(--radius-sm)',
                    cursor:        clickable ? 'pointer' : 'default',
                    transition:    'filter 120ms ease',
                  }}
                >
                  {cell.count > 0 ? (
                    <span
                      className="tabular"
                      style={{
                        fontWeight:   'var(--fw-semibold)',
                        fontSize:     'var(--ts-h3-size)',
                        color:        tc,
                        lineHeight:   1,
                      }}
                    >
                      {cell.count}
                    </span>
                  ) : (
                    <span style={{
                      width:        8,
                      height:       8,
                      borderRadius: '50%',
                      background:   'var(--border-hairline)',
                      display:      'block',
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div style={{
          display:       'flex',
          alignItems:    'center',
          gap:           'var(--space-4)',
          marginTop:     'var(--space-3)',
          marginLeft:    116,
          flexWrap:      'wrap',
        }}>
          {[
            { label: 'Low zone',     bg: 'rgba(74,222,128,0.18)',  border: 'rgba(74,222,128,0.3)' },
            { label: 'Medium zone',  bg: 'rgba(251,191,36,0.18)',  border: 'rgba(251,191,36,0.3)' },
            { label: 'High zone',    bg: 'rgba(251,146,60,0.22)',  border: 'rgba(251,146,60,0.35)' },
            { label: 'Critical zone',bg: 'rgba(139,46,26,0.22)',   border: 'rgba(139,46,26,0.4)' },
          ].map(({ label, bg, border }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: bg, border: `1px solid ${border}` }} />
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
