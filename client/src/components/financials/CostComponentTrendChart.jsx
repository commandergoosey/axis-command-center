/*
 * Phase 217 — CostComponentTrendChart
 * Stacked area chart of monthly operating cost broken down into four components:
 * fuel (rust) / driver (amber) / maintenance (green) / other (secondary).
 * Helps identify whether cost growth is fuel-driven (macro) or driver/maint
 * (operational), complementing the EBITDA bridge's single-line cost delta.
 * MODELLED badge per §12.4 — proportions are seeded estimates.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const MODELLED = (
  <span style={{
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(100,100,100,0.08)',
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 'var(--fw-medium)',
    textTransform: 'uppercase',
    verticalAlign: 'middle',
    marginLeft: 6,
  }}>
    MODELLED
  </span>
);

const FMT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

function shortMonth(iso) {
  const [y, m] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
      minWidth: 200,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6, color: 'var(--text)' }}>
        {label}
      </div>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          color: 'var(--text-secondary)', marginBottom: 2,
        }}>
          <span>{p.name}</span>
          <span className="mono">{FMT_USD.format(p.value)}</span>
        </div>
      ))}
      <div style={{
        borderTop: '1px solid var(--border-hairline)', marginTop: 6, paddingTop: 6,
        display: 'flex', justifyContent: 'space-between', gap: 16,
        fontWeight: 'var(--fw-medium)', color: 'var(--text)',
      }}>
        <span>Operating costs</span>
        <span className="mono">{FMT_USD.format(total)}</span>
      </div>
    </div>
  );
};

export default function CostComponentTrendChart({ costComponentTrend }) {
  if (!costComponentTrend?.length) return null;

  const data = costComponentTrend.map((m) => ({
    ...m,
    month_label: shortMonth(m.month),
  }));

  const latest = costComponentTrend[costComponentTrend.length - 1];
  const latestFuelPct = latest
    ? Math.round((latest.fuel_usd / (latest.fuel_usd + latest.driver_usd + latest.maint_usd + latest.other_usd)) * 100)
    : null;

  const axisTick = {
    fontSize: 'var(--ts-caption-size)',
    fill: 'var(--text-tertiary)',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
            marginBottom: 2,
          }}>
            Operating cost mix{MODELLED}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Monthly · fuel / driver / maintenance / other · USD
          </div>
        </div>
        {latestFuelPct !== null && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="tabular" style={{
              fontSize: 'var(--ts-h3-size)',
              fontWeight: 'var(--fw-black)',
              color: 'var(--bauxite-rust)',
              lineHeight: 1,
            }}>
              {latestFuelPct}%
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
              fuel share
            </div>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="ccFuel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--bauxite-rust)"  stopOpacity={0.45} />
              <stop offset="95%" stopColor="var(--bauxite-rust)"  stopOpacity={0.06} />
            </linearGradient>
            <linearGradient id="ccDriver" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--signal-amber)"  stopOpacity={0.40} />
              <stop offset="95%" stopColor="var(--signal-amber)"  stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="ccMaint" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--signal-green)"  stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--signal-green)"  stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="ccOther" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--charcoal)"      stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--charcoal)"      stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis dataKey="month_label" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}
          />
          <Area
            type="monotone"
            dataKey="fuel_usd"
            name="Fuel"
            stackId="a"
            stroke="var(--bauxite-rust)"
            strokeWidth={1.5}
            fill="url(#ccFuel)"
          />
          <Area
            type="monotone"
            dataKey="driver_usd"
            name="Driver"
            stackId="a"
            stroke="var(--signal-amber)"
            strokeWidth={1.5}
            fill="url(#ccDriver)"
          />
          <Area
            type="monotone"
            dataKey="maint_usd"
            name="Maint"
            stackId="a"
            stroke="var(--signal-green)"
            strokeWidth={1.5}
            fill="url(#ccMaint)"
          />
          <Area
            type="monotone"
            dataKey="other_usd"
            name="Other"
            stackId="a"
            stroke="var(--charcoal)"
            strokeWidth={1.5}
            fill="url(#ccOther)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
