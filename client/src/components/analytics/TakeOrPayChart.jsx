/*
 * TakeOrPayChart — Phase 194.
 * Per-hauler take-or-pay floor attainment: actual MTD tonnes vs contracted
 * monthly allocation, with a floor marker showing where each hauler needs
 * to be by month-end to avoid a shortfall penalty.
 *
 * Data: data.take_or_pay_risk[] from GET /api/analytics.
 * Each row: hauler_id, display_name, tonnes_actual, tonnes_contracted,
 *           mtd_floor, attainment_pct, floor_pct, shortfall_t, at_risk.
 */

const MODELLED_BADGE = (
  <span style={{
    fontSize: 9,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(139,46,26,0.10)',
    color: 'var(--bauxite-rust)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    textTransform: 'uppercase',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function fmt(n) { return n == null ? '—' : Math.round(n).toLocaleString(); }
function fmtPct(n) { return n == null ? '—' : `${n}%`; }

export default function TakeOrPayChart({ takeOrPayRisk }) {
  if (!takeOrPayRisk?.length) return null;

  const atRiskCount = takeOrPayRisk.filter((h) => h.at_risk).length;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span className="eyebrow">Take-or-pay floor attainment</span>
          {MODELLED_BADGE}
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-tertiary)',
        }}>
          MTD actual vs contracted · floor = pro-rated daily target
          {atRiskCount > 0 && (
            <span style={{ color: 'var(--bauxite-rust)', marginLeft: 8 }}>
              {atRiskCount} hauler{atRiskCount > 1 ? 's' : ''} at risk
            </span>
          )}
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 2.4fr 72px 72px 80px',
          gap: 'var(--space-3)',
          paddingBottom: 6,
          borderBottom: '1px solid var(--border-hairline)',
          marginBottom: 4,
        }}>
          {['Hauler', 'MTD progress', 'Actual', 'Floor %', 'Shortfall'].map((h) => (
            <span key={h} className="micro" style={{ color: 'var(--text-tertiary)' }}>{h}</span>
          ))}
        </div>

        {takeOrPayRisk.map((h, i) => {
          const barPct = Math.min(100, h.tonnes_contracted > 0
            ? (h.tonnes_actual / h.tonnes_contracted) * 100
            : 0);
          const floorPct = Math.min(100, h.tonnes_contracted > 0
            ? (h.mtd_floor / h.tonnes_contracted) * 100
            : 0);
          const barColor = h.floor_pct >= 100 ? 'var(--signal-green)'
                         : h.floor_pct >= 80  ? 'var(--signal-amber)'
                         : 'var(--bauxite-rust)';
          const floorColor = h.floor_pct >= 100 ? 'var(--signal-green)'
                           : h.floor_pct >= 80  ? 'var(--signal-amber)'
                           : 'var(--bauxite-rust)';

          return (
            <div
              key={h.hauler_id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 2.4fr 72px 72px 80px',
                gap: 'var(--space-3)',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < takeOrPayRisk.length - 1 ? '1px solid var(--border-hairline)' : 'none',
              }}
            >
              {/* Hauler name + at-risk badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {h.display_name.replace(/\s+Haulage.*/, '').replace(/\s+Transport.*/, '')}
                </span>
                {h.at_risk && (
                  <span style={{
                    fontSize: 9,
                    letterSpacing: '0.06em',
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'rgba(139,46,26,0.12)',
                    color: 'var(--bauxite-rust)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}>
                    AT RISK
                  </span>
                )}
              </div>

              {/* Progress track: contracted bg, actual fill, floor marker */}
              <div style={{ position: 'relative', height: 8, background: 'var(--border-hairline)', borderRadius: 4, overflow: 'visible' }}>
                {/* Actual fill */}
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: `${barPct}%`,
                  background: barColor,
                  opacity: 0.85,
                  borderRadius: 4,
                  transition: 'width 400ms ease',
                }} />
                {/* Floor marker tick */}
                <div style={{
                  position: 'absolute',
                  left: `${floorPct}%`,
                  top: -3,
                  bottom: -3,
                  width: 2,
                  background: 'var(--text-secondary)',
                  borderRadius: 1,
                }} />
              </div>

              {/* Actual tonnes */}
              <span className="tabular" style={{
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text)',
              }}>
                {fmt(h.tonnes_actual)} t
              </span>

              {/* Floor % */}
              <span className="tabular" style={{
                fontSize: 'var(--ts-caption-size)',
                fontWeight: 'var(--fw-medium)',
                color: floorColor,
              }}>
                {fmtPct(h.floor_pct)}
              </span>

              {/* Shortfall */}
              <span className="tabular" style={{
                fontSize: 'var(--ts-caption-size)',
                color: h.shortfall_t > 0 ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
              }}>
                {h.shortfall_t > 0 ? `−${fmt(h.shortfall_t)} t` : '—'}
              </span>
            </div>
          );
        })}

        {/* Legend */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-4)',
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
          flexWrap: 'wrap',
        }}>
          {[
            { color: 'var(--signal-green)',  label: '≥ 100% floor — on track' },
            { color: 'var(--signal-amber)',  label: '80–99% — watch' },
            { color: 'var(--bauxite-rust)',  label: '< 80% — at risk' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.85 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {label}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 2, height: 10, borderRadius: 1, background: 'var(--text-secondary)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Floor marker (pro-rated daily target)
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
