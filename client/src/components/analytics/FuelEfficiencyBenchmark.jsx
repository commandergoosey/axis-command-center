/*
 * Phase 178 — per-hauler fuel efficiency benchmark.
 * ScatterChart (first use): x = avg L/100km (lower = better),
 * y = avg weekly trips (higher = better), dot size = truck fleet count.
 * Lets ops spot the efficiency-vs-throughput trade-off per hauler.
 */

import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, ZAxis, Cell,
} from 'recharts';

const CORRIDOR_PALETTE = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{d.hauler_display}</div>
      <Row label="L/100km (avg)"     value={`${d.avg_l_per_100km} L`} />
      <Row label="Trips/week (avg)"  value={d.avg_trips_per_week} />
      <Row label="Truck count"       value={d.truck_count} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

export default function FuelEfficiencyBenchmark({ efficiencyBenchmark }) {
  if (!efficiencyBenchmark?.length) return null;

  const avgX = efficiencyBenchmark.reduce((s, h) => s + h.avg_l_per_100km, 0) / efficiencyBenchmark.length;
  const avgY = efficiencyBenchmark.reduce((s, h) => s + h.avg_trips_per_week, 0) / efficiencyBenchmark.length;

  // Recharts ScatterChart requires all series points in one <Scatter> or per-hauler <Scatter>.
  // We use per-hauler Scatter so each gets its own colour.
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{
          fontSize: 'var(--ts-micro-size)',
          letterSpacing: 'var(--ts-micro-tracking)',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          fontWeight: 'var(--fw-medium)',
          marginBottom: 4,
        }}>
          Fuel efficiency vs throughput · per hauler
        </div>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          x-axis: avg L/100 km (left = more efficient) · y-axis: avg weekly trips (up = higher throughput) · dot size: fleet count
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            dataKey="avg_l_per_100km"
            name="L/100km"
            domain={['dataMin - 1', 'dataMax + 1']}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'L/100km', position: 'insideBottomRight', offset: -8, fontSize: 10, fill: 'var(--text-tertiary)' }}
          />
          <YAxis
            type="number"
            dataKey="avg_trips_per_week"
            name="Trips/wk"
            domain={['dataMin - 1', 'dataMax + 1']}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Trips/wk', angle: -90, position: 'insideLeft', offset: 16, fontSize: 10, fill: 'var(--text-tertiary)' }}
          />
          {/* bubble size scaled to truck_count */}
          <ZAxis type="number" dataKey="truck_count" range={[120, 600]} />
          <Tooltip content={<CustomTooltip />} />

          {/* Corridor average cross-hairs */}
          <ReferenceLine x={avgX} stroke="var(--border-soft)" strokeDasharray="4 3" strokeOpacity={0.7}
            label={{ value: 'Avg eff', position: 'top', fontSize: 9, fill: 'var(--text-tertiary)' }} />
          <ReferenceLine y={avgY} stroke="var(--border-soft)" strokeDasharray="4 3" strokeOpacity={0.7}
            label={{ value: 'Avg trips', position: 'right', fontSize: 9, fill: 'var(--text-tertiary)' }} />

          {efficiencyBenchmark.map((h, i) => (
            <Scatter
              key={h.hauler_id}
              name={h.hauler_display}
              data={[h]}
              fill={CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length]}
              fillOpacity={0.75}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 'var(--space-2)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-secondary)',
      }}>
        {efficiencyBenchmark.map((h, i) => (
          <div key={h.hauler_id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length],
              opacity: 0.8,
            }} />
            {h.hauler_display}
          </div>
        ))}
      </div>
    </div>
  );
}
