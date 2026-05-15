/*
 * CovenantTable — lender side-letter tests. Each row shows the headline
 * metric, a PASS / WATCH / BREACH pill, and one-line detail. Colour
 * sparingly: Signal Green for PASS, Amber for WATCH, Bauxite Rust for BREACH.
 */

const TONE = {
  PASS:   { bg: 'rgba(46, 107, 63, 0.12)',   fg: 'var(--signal-green)',  label: 'PASS'   },
  WATCH:  { bg: 'rgba(184, 134, 11, 0.14)',  fg: 'var(--signal-amber)',  label: 'WATCH'  },
  BREACH: { bg: 'rgba(162, 62, 35, 0.14)',   fg: 'var(--bauxite-rust)',  label: 'BREACH' },
};

export default function CovenantTable({ covenants }) {
  if (!covenants?.length) return null;
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Covenant compliance</div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
          Lender side-letter tests. All four must hold month-on-month for continued drawdown eligibility.
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {covenants.map((c) => {
          const tone = TONE[c.status] ?? TONE.PASS;
          return (
            <div key={c.id} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr auto',
              gap: 'var(--space-4)',
              alignItems: 'center',
              padding: '14px 0',
              borderTop: '1px solid var(--border-hairline)',
            }}>
              <div>
                <div style={{
                  fontSize: 'var(--ts-body-size)',
                  color: 'var(--text)',
                  fontWeight: 'var(--fw-medium)',
                }}>
                  {c.name}
                </div>
                <div style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}>
                  {c.detail}
                </div>
              </div>
              <div className="tabular" style={{
                fontSize: 'var(--ts-body-size)',
                color: 'var(--text)',
                fontWeight: 'var(--fw-medium)',
                textAlign: 'right',
              }}>
                {c.metric}
              </div>
              <span style={{
                padding: '4px 10px',
                background: tone.bg,
                color: tone.fg,
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-micro-size)',
                letterSpacing: 'var(--ts-micro-tracking)',
                fontWeight: 'var(--fw-medium)',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {tone.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
