/*
 * IndexationPanel — breaks down the effective tariff into its three
 * indexation components. Each component shows its weight, current reading,
 * base reading, and the weighted contribution to the multiplier.
 *
 * Stacked composition bar makes the 40/30/30 weighting visible at a glance.
 */

const COMP_COLOR = {
  fuel:  'var(--bauxite-rust)',
  cpi:   'var(--charcoal)',
  fixed: 'var(--iron)',
};

export default function IndexationPanel({ data }) {
  if (!data?.components?.length) return null;
  const { components, multiplier, clamped_at_cap, clamped_at_floor } = data;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div className="eyebrow">Indexation composition</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Weighted fuel (40%) + CPI (30%) + fixed (30%). Rebases monthly to NPA and GSS prints.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          × {multiplier.toFixed(4)}
        </div>
      </header>

      {/* Stacked composition bar by weight */}
      <div style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden' }}>
        {components.map((c) => (
          <div
            key={c.key}
            style={{
              flex: c.weight,
              background: COMP_COLOR[c.key] ?? 'var(--slate)',
            }}
            title={`${c.label} · weight ${(c.weight * 100).toFixed(0)}%`}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {components.map((c) => <Row key={c.key} component={c} />)}
      </div>

      {(clamped_at_cap || clamped_at_floor) && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)',
          background: 'rgba(184, 134, 11, 0.10)',
          color: 'var(--signal-amber)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
        }}>
          Pass-through {clamped_at_cap ? 'cap' : 'floor'} hit — rate clamped per tariff terms.
        </div>
      )}
    </section>
  );
}

function Row({ component }) {
  const delta = (component.index_current - 1) * 100;
  const deltaColor = delta > 0 ? 'var(--bauxite-rust)' : delta < 0 ? 'var(--signal-green)' : 'var(--text-tertiary)';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '12px 1fr auto auto auto',
      alignItems: 'center',
      gap: 'var(--space-3)',
    }}>
      <span
        aria-hidden
        style={{
          width: 10, height: 10,
          background: COMP_COLOR[component.key] ?? 'var(--slate)',
          borderRadius: 2,
          display: 'inline-block',
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
          {component.label}
        </div>
        <div className="mono" style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 2,
          letterSpacing: '0.04em',
        }}>
          Base {component.base_reading} · Now {component.current_reading}
        </div>
      </div>
      <span className="mono" style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        letterSpacing: '0.04em',
      }}>
        {(component.weight * 100).toFixed(0)}%
      </span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        × {component.index_current.toFixed(4)}
      </span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: deltaColor,
        minWidth: 64,
        textAlign: 'right',
      }}>
        {delta >= 0 ? '+' : ''}{delta.toFixed(2)}%
      </span>
    </div>
  );
}
