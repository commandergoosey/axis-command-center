/*
 * Phase 214 — TripCostBreakdownChart
 * Stacked horizontal BarChart showing cumulative trip cost split by component
 * (fuel / driver / maint / tolls) for each hauler. Sorted highest-spend first.
 * MODELLED badge not required — all figures are derived directly from TRIPS mock.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const FMT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

function shortName(display) {
  return display?.replace(/\s+(Haulage|Transport|Logistics|Ltd\.?|Limited)$/i, '') ?? display;
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
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6, color: 'var(--text)' }}>
        {label}
      </div>
      {payload.map((p) => (
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
        <span>Total</span>
        <span className="mono">{FMT_USD.format(total)}</span>
      </div>
    </div>
  );
};

export default function TripCostBreakdownChart({ costComponentByHauler }) {
  if (!costComponentByHauler?.length) return null;

  const data = costComponentByHauler.map((h) => ({
    ...h,
    name: shortName(h.hauler_display),
  }));

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
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{
          fontSize: 'var(--ts-body-size)',
          fontWeight: 'var(--fw-semibold)',
          color: 'var(--text)',
          marginBottom: 2,
        }}>
          Trip cost by component
        </div>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Cumulative · all trips · USD · fuel / driver / maintenance / tolls
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 48)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barSize={20}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            tick={axisTick}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={axisTick}
            width={100}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}
          />
          <Bar dataKey="fuel_usd"   name="Fuel"   stackId="a" fill="var(--bauxite-rust)"   radius={0} />
          <Bar dataKey="driver_usd" name="Driver" stackId="a" fill="var(--signal-amber)"   radius={0} />
          <Bar dataKey="maint_usd"  name="Maint"  stackId="a" fill="var(--signal-green)"   radius={0} />
          <Bar dataKey="tolls_usd"  name="Tolls"  stackId="a" fill="var(--text-tertiary)"  radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
