/*
 * SettlementAgeingStrip — Phase 142.
 * Compact per-hauler strip showing oldest outstanding balance age and
 * total unpaid amount. Sorted by oldest days outstanding descending so
 * the most stale balances appear first — coaching surface for AXIS.
 *
 * Props:
 *   haulerAging — /api/settlements → hauler_aging array
 */

const MAX_EXPECTED_DAYS = 90; // anything ≥ 90d = full-bar width

function ageBand(days) {
  if (days >= 60) return { color: 'var(--bauxite-rust)',  bg: 'rgba(139,46,26,0.08)',  border: 'rgba(139,46,26,0.25)',  label: '>60d' };
  if (days >= 30) return { color: 'var(--signal-amber)', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)', label: '30–60d' };
  return             { color: 'var(--text-secondary)',   bg: 'var(--surface-raised)',  border: 'var(--border-hairline)', label: '<30d' };
}

export default function SettlementAgeingStrip({ haulerAging }) {
  if (!haulerAging || haulerAging.length === 0) return null;

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Outstanding balance ageing · per hauler
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {haulerAging.map((h, idx) => {
          const band   = ageBand(h.oldest_days_outstanding);
          const barPct = Math.min(100, (h.oldest_days_outstanding / MAX_EXPECTED_DAYS) * 100);
          return (
            <div
              key={h.hauler_id}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: idx < haulerAging.length - 1
                  ? '1px solid var(--border-hairline)'
                  : 'none',
                background: band.bg,
              }}
            >
              <div style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                marginBottom:   8,
                gap:            8,
                flexWrap:       'wrap',
              }}>
                {/* Hauler name */}
                <div style={{
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      'var(--text)',
                }}>
                  {h.hauler_display}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                  {/* Statements count */}
                  <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                    {h.statement_count} statement{h.statement_count !== 1 ? 's' : ''}
                  </span>

                  {/* Outstanding amount */}
                  <span className="tabular" style={{
                    fontSize:   'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-medium)',
                    color:      band.color,
                  }}>
                    ${new Intl.NumberFormat('en-US').format(Math.round(h.outstanding_usd))}
                  </span>

                  {/* Age badge */}
                  <span className="mono" style={{
                    fontSize:      9,
                    padding:       '2px 7px',
                    background:    band.bg,
                    border:        `1px solid ${band.border}`,
                    borderRadius:  3,
                    color:         band.color,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    {h.oldest_days_outstanding}d oldest
                  </span>
                </div>
              </div>

              {/* Ageing bar */}
              <div style={{
                height:       3,
                background:   'var(--border-hairline)',
                borderRadius: 2,
                overflow:     'hidden',
              }}>
                <div style={{
                  height:     '100%',
                  width:      `${barPct}%`,
                  background: band.color,
                  borderRadius: 2,
                  opacity:    0.7,
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
