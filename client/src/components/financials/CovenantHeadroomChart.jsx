/*
 * CovenantHeadroomChart — Phase 163.
 * Horizontal bar chart showing each covenant's headroom — how far
 * the current value is from the threshold, as a percentage of that
 * threshold. Positive = safe side; negative = breach territory.
 *
 * Visually answers "which covenant is closest to breach?" at a glance.
 * Complements CovenantTable (which shows absolute values and status)
 * with a spatial / relative-distance view.
 *
 * No server change needed — covenants already in /api/financials.
 *
 * Props:
 *   covenants — covenants array from /api/financials
 */

function headroomPct(c) {
  // For metrics where higher is better (DSCR, take-or-pay tonnes):
  //   headroom = (current − threshold) / |threshold| × 100
  // For metrics where lower is better (gearing %, concentration %, etc.):
  //   headroom = (threshold − current) / |threshold| × 100
  // We detect direction by checking the covenant id / name.
  if (!c || c.threshold == null || c.current == null) return 0;
  const isLowerBetter = ['cov-gearing', 'cov-concentration', 'cov-sla', 'cov-receivables']
    .some((id) => c.id === id);
  if (isLowerBetter) {
    return c.threshold !== 0
      ? Number(((c.threshold - c.current) / Math.abs(c.threshold) * 100).toFixed(1))
      : 0;
  }
  return c.threshold !== 0
    ? Number(((c.current - c.threshold) / Math.abs(c.threshold) * 100).toFixed(1))
    : 0;
}

const STATUS_COLOR = {
  PASS:   'var(--signal-green)',
  WATCH:  'var(--signal-amber)',
  BREACH: 'var(--bauxite-rust)',
};

const MAX_BAR_PCT = 30; // clamp display at ±30 % so narrow bars stay readable

export default function CovenantHeadroomChart({ covenants }) {
  if (!covenants?.length) return null;

  const rows = covenants.map((c) => ({
    ...c,
    headroom: headroomPct(c),
  }));

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Covenant headroom</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Distance from threshold · positive = safe · negative = breach
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {rows.map((c, i) => {
          const color    = STATUS_COLOR[c.status] ?? STATUS_COLOR.PASS;
          const hw       = c.headroom;
          const isNeg    = hw < 0;
          const barWidth = Math.min(100, (Math.abs(hw) / MAX_BAR_PCT) * 100);

          return (
            <div
              key={c.id}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: i < rows.length - 1 ? '1px solid var(--border-hairline)' : 'none',
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{
                  flex:       1,
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      'var(--text)',
                }}>
                  {c.name}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   'var(--ts-caption-size)',
                  color:      'var(--text-secondary)',
                }}>
                  {c.metric}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   'var(--ts-caption-size)',
                  fontWeight: 'var(--fw-medium)',
                  color,
                  minWidth:   54,
                  textAlign:  'right',
                }}>
                  {hw > 0 ? '+' : ''}{hw}%
                </span>
              </div>

              {/* Headroom bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 8 }}>
                {/* Negative side (breach zone) */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  {isNeg && (
                    <div style={{
                      width:        `${barWidth}%`,
                      height:       8,
                      background:   color,
                      borderRadius: '3px 0 0 3px',
                    }} />
                  )}
                </div>
                {/* Centre line */}
                <div style={{ width: 2, height: 12, background: 'var(--border-soft)', flexShrink: 0 }} />
                {/* Positive side (safe zone) */}
                <div style={{ flex: 1 }}>
                  {!isNeg && (
                    <div style={{
                      width:        `${barWidth}%`,
                      height:       8,
                      background:   color,
                      borderRadius: '0 3px 3px 0',
                    }} />
                  )}
                </div>
              </div>

              {/* Sub-label */}
              <div style={{
                marginTop:  4,
                fontSize:   'var(--ts-caption-size)',
                color:      'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}>
                {c.status === 'BREACH' ? 'Covenant breach — immediate remediation required'
               : c.status === 'WATCH'  ? 'Within watch zone — monitor closely'
               : 'Covenant passing'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
