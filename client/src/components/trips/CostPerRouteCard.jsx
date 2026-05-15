/*
 * CostPerRouteCard — cost vs revenue breakdown per route, southbound first.
 * Each route renders a stacked horizontal bar of cost buckets (fuel, driver,
 * maintenance, tolls) against its total revenue. Northbound routes return
 * empty so revenue is zero — the card still shows the cost stack so the
 * operator sees the round-trip economics honestly.
 */

const BUCKETS = [
  { key: 'cost_fuel_usd',   label: 'Fuel',        color: 'var(--bauxite-rust)' },
  { key: 'cost_driver_usd', label: 'Driver',      color: 'var(--charcoal)' },
  { key: 'cost_maint_usd',  label: 'Maintenance', color: 'var(--iron)' },
  { key: 'cost_tolls_usd',  label: 'Tolls',       color: 'var(--slate)' },
];

export default function CostPerRouteCard({ rows }) {
  if (!rows?.length) return null;

  // Scale all routes to the largest cost or revenue across the set so the
  // bars are mutually comparable. Guard against division by zero.
  const ceiling = Math.max(
    1,
    ...rows.map((r) => Math.max(r.cost_total_usd, r.revenue_usd)),
  );

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow">Cost per route</div>
        <div style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          marginTop: 2,
        }}>
          Stacked USD by cost category · revenue bar shown for southbound laden trips only
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {rows.map((r) => (
          <RouteBar key={r.route_id} row={r} ceiling={ceiling} />
        ))}
      </div>

      <Legend />
    </section>
  );
}

function RouteBar({ row, ceiling }) {
  const margin = row.revenue_usd - row.cost_total_usd;
  const marginTone = margin >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)';

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {row.route_label}
          </div>
          <div className="mono" style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
            marginTop: 2,
          }}>
            {row.trips} trips · {Math.round(row.tonnes)} t
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text)',
            fontWeight: 'var(--fw-medium)',
          }}>
            ${Math.round(row.cost_total_usd).toLocaleString()} cost
          </div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-caption-size)',
            color: marginTone,
            marginTop: 2,
          }}>
            {margin >= 0 ? '+' : ''}${Math.round(margin).toLocaleString()} margin
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex',
        width: '100%',
        height: 10,
        background: 'var(--surface-sunk)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
      }}>
        {BUCKETS.map((b) => {
          const w = (row[b.key] / ceiling) * 100;
          if (w <= 0) return null;
          return (
            <div
              key={b.key}
              style={{ width: `${w}%`, background: b.color }}
              title={`${b.label} · $${Math.round(row[b.key]).toLocaleString()}`}
            />
          );
        })}
      </div>

      {row.revenue_usd > 0 && (
        <div style={{ position: 'relative', marginTop: 4, height: 6 }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${(row.revenue_usd / ceiling) * 100}%`,
            height: 6,
            background: 'repeating-linear-gradient(45deg, var(--signal-green) 0 4px, transparent 4px 8px)',
            borderRadius: 'var(--radius-sm)',
            opacity: 0.75,
          }} />
          <span className="mono" style={{
            position: 'absolute',
            right: 0,
            top: -2,
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
          }}>
            ${Math.round(row.revenue_usd).toLocaleString()} revenue
          </span>
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-4)',
      marginTop: 'var(--space-4)',
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--border-hairline)',
      flexWrap: 'wrap',
    }}>
      {BUCKETS.map((b) => (
        <span key={b.key} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
        }}>
          <span style={{
            width: 10, height: 10,
            background: b.color,
            borderRadius: 2,
            flexShrink: 0,
          }} />
          {b.label}
        </span>
      ))}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-secondary)',
      }}>
        <span style={{
          width: 20, height: 6,
          background: 'repeating-linear-gradient(45deg, var(--signal-green) 0 4px, transparent 4px 8px)',
          opacity: 0.75,
          borderRadius: 2,
        }} />
        Revenue
      </span>
    </div>
  );
}
