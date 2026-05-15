/*
 * ConvoyCycleCard — 7-day cycle-time trend plus laden/empty trip split.
 * Uses Recharts composed chart: line for cycle hours, stacked bars for trips.
 * Palette is Charcoal + Iron for data and Bauxite Rust for the lead line.
 */

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

export default function ConvoyCycleCard({ series }) {
  if (!series || series.length === 0) {
    return <CardFrame title="Convoy cycle" subtitle="No data" />;
  }

  const latest = series[series.length - 1];
  const prior = series[0];
  const delta = Number((latest.cycle_hours - prior.cycle_hours).toFixed(1));

  const data = series.map((d) => ({
    label: new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    cycle: d.cycle_hours,
    laden: d.trips_laden,
    empty: d.trips_empty,
  }));

  return (
    <CardFrame
      title="Convoy cycle"
      subtitle="7-day trend · laden vs empty trips"
      right={
        <div style={{ textAlign: 'right' }}>
          <div
            className="tabular"
            style={{
              fontSize: 'var(--ts-h3-size)',
              fontWeight: 'var(--fw-black)',
              color: 'var(--text)',
            }}
          >
            {latest.cycle_hours.toFixed(1)} h
          </div>
          <div
            className="mono"
            style={{
              fontSize: 'var(--ts-caption-size)',
              color: delta > 0 ? 'var(--signal-red)' : 'var(--signal-green)',
              letterSpacing: '0.02em',
            }}
          >
            {delta > 0 ? '+' : ''}{delta} h vs 7d ago
          </div>
        </div>
      }
    >
      <div style={{ height: 180, margin: '0 -8px' }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -16 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis yAxisId="left" hide />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              width={36}
              domain={['dataMin - 1', 'dataMax + 1']}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--charcoal)',
                border: 'none',
                borderRadius: 6,
                color: 'var(--bone)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
              cursor={{ fill: 'var(--accent-tint)' }}
            />
            <Bar
              yAxisId="left"
              dataKey="laden"
              stackId="trips"
              fill="var(--iron)"
              maxBarSize={22}
              radius={[2, 2, 0, 0]}
            />
            <Bar
              yAxisId="left"
              dataKey="empty"
              stackId="trips"
              fill="var(--ash)"
              maxBarSize={22}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cycle"
              stroke="var(--bauxite-rust)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--bauxite-rust)' }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Legend />
    </CardFrame>
  );
}

function Legend() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        paddingTop: 8,
      }}
    >
      <Swatch fill="var(--iron)" label="Laden trips" />
      <Swatch fill="var(--ash)" label="Empty trips" ringColor="var(--border-soft)" />
      <Swatch fill="var(--bauxite-rust)" label="Cycle h" />
    </div>
  );
}

function Swatch({ fill, label, ringColor }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: fill,
          border: ringColor ? `1px solid ${ringColor}` : 'none',
        }}
      />
      {label}
    </span>
  );
}

function CardFrame({ title, subtitle, right, children }) {
  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        minHeight: 260,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
      }}>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)' }}>{title}</div>
          {subtitle && (
            <div style={{
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
              marginTop: 2,
            }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
