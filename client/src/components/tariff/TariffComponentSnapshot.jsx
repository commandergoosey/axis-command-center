/*
 * Phase 213 — Tariff component snapshot: current-month breakdown of the
 * effective rate into fuel / CPI / fixed USD contributions.
 * Derived from the latest component_history entry — no server change needed.
 * Three tiles + proportional stacked bar for quick visual read.
 */

const MODELLED = (
  <span style={{
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--signal-amber)',
    background: 'rgba(217,158,45,0.12)',
    borderRadius: 3,
    padding: '1px 5px',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

const COMPONENT_META = {
  fuel_usd:  { label: 'Fuel (NPA diesel)', color: 'var(--bauxite-rust)',  desc: '40% weight · indexed to NPA monthly pump price' },
  cpi_usd:   { label: 'CPI (GSS)',         color: 'var(--signal-amber)',  desc: '30% weight · indexed to Ghana CPI headline' },
  fixed_usd: { label: 'Fixed USD',          color: 'var(--signal-green)', desc: '30% weight · fixed in USD, no index adjustment' },
};

function fmtUsd(v) {
  return v == null ? '—' : `$${Number(v).toFixed(2)}`;
}

export default function TariffComponentSnapshot({ componentHistory }) {
  if (!componentHistory?.length) return null;

  // Use the latest (current-month) entry.
  const latest = componentHistory[componentHistory.length - 1];
  const { fuel_usd, cpi_usd, fixed_usd, effective_usd_per_tonne, month } = latest;
  const total = (fuel_usd ?? 0) + (cpi_usd ?? 0) + (fixed_usd ?? 0);

  const components = [
    { key: 'fuel_usd',  value: fuel_usd  ?? 0 },
    { key: 'cpi_usd',   value: cpi_usd   ?? 0 },
    { key: 'fixed_usd', value: fixed_usd ?? 0 },
  ];

  const monthLabel = month
    ? new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'Current month';

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
          }}>
            Effective rate breakdown — {monthLabel}
          </span>
          {MODELLED}
        </div>
        <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          How the {fmtUsd(effective_usd_per_tonne)}/t effective rate is composed.
          Each component's USD contribution at the current index values.
        </p>
      </div>

      {/* Three component tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}>
        {components.map(({ key, value }) => {
          const meta = COMPONENT_META[key];
          const pct  = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <div key={key} style={{
              background: 'var(--surface-page)',
              border: `1px solid var(--border-hairline)`,
              borderTop: `3px solid ${meta.color}`,
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-3) var(--space-3)',
            }}>
              <div style={{
                fontSize: 'var(--ts-micro-size)',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}>
                {meta.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontVariantNumeric: 'tabular-nums lining-nums',
                  fontWeight: 'var(--fw-black)',
                  fontSize: 'var(--ts-h3-size)',
                  color: meta.color,
                }}>
                  {fmtUsd(value)}
                </span>
                <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                  /t · {pct}%
                </span>
              </div>
              <div style={{
                marginTop: 4,
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
              }}>
                {meta.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Proportional stacked bar */}
      <div style={{
        display: 'flex',
        borderRadius: 4,
        overflow: 'hidden',
        height: 10,
      }}>
        {components.map(({ key, value }) => {
          const meta = COMPONENT_META[key];
          const pct  = total > 0 ? (value / total) * 100 : 0;
          return (
            <div
              key={key}
              title={`${COMPONENT_META[key].label}: ${pct.toFixed(1)}%`}
              style={{ width: `${pct}%`, background: meta.color }}
            />
          );
        })}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span>Fuel ← dominant if diesel spikes</span>
        <span>Effective rate: {fmtUsd(effective_usd_per_tonne)}/t</span>
      </div>
    </div>
  );
}
