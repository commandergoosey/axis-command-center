/*
 * AxleLoadSummary — 30-day strip: Holds / Warnings / Delay minutes / 7d
 * trend against the 60-tonne GVW cap (LI 2180, ~40-t payload). Below the
 * KPIs is a per-hauler rank of overload cost so coaching targets are
 * obvious at a glance.
 */

export default function AxleLoadSummary({ axle }) {
  if (!axle) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Axle-load compliance · 30 days</div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
          LI 2180 governs: 60-tonne GVW ceiling, ~40-tonne payload. Forced off-load at Nyinahin weighbridge on every hold.
        </div>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <Tile label="Holds"              value={String(axle.holds)}    tone={axle.holds >= 3 ? 'rust' : 'neutral'} />
        <Tile label="Warnings"           value={String(axle.warnings)} tone="neutral" />
        <Tile label="Delay accrued"      value={`${axle.delay_min_total} min`} sub={`~$${Math.round(axle.delay_min_total * 14)} opportunity cost`} />
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
      }}>
        <div className="mono" style={{
          fontSize: 10,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          Per hauler · 30-day rollup
        </div>
        {axle.by_hauler.map((h) => {
          const total = h.holds + h.warnings;
          return (
            <div key={h.hauler_id} style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr',
              gap: 'var(--space-3)',
              alignItems: 'baseline',
              padding: '10px var(--space-3)',
              background: total >= 5 ? 'rgba(162, 62, 35, 0.05)' : 'var(--surface-sunk)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
            }}>
              <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                {h.hauler_display_name}
              </span>
              <span className="tabular" style={{ color: h.holds > 0 ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
                {h.holds} holds
              </span>
              <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
                {h.warnings} warn
              </span>
              <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
                {h.delay_min_total} min
              </span>
              <span className="tabular" style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                ${h.cost_usd.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Tile({ label, value, sub, tone }) {
  const valueColor = tone === 'rust' ? 'var(--bauxite-rust)' : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-sunk)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div className="eyebrow">{label}</div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size)',
        lineHeight: 'var(--ts-h2-lh)',
        fontWeight: 'var(--fw-medium)',
        color: valueColor,
        marginTop: 4,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 2,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
