/*
 * Phase 207 — Per-hauler fleet L/100km efficiency.
 * Horizontal BarChart, worst-to-best. ReferenceLine at corridor average.
 * Cell coloring: green ≤ avg, amber ≤ avg+1, rust > avg+1.
 * Source data is real fleet telemetry (not modelled).
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const vsSign = d.vs_corridor >= 0 ? '+' : '';
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 4 }}>{d.display_name}</div>
      <div>Avg: {d.avg_l_per_100km} L/100km</div>
      <div style={{
        color: d.vs_corridor > 0 ? 'var(--bauxite-rust)'
             : d.vs_corridor < 0 ? 'var(--signal-green)'
             : 'var(--text-tertiary)',
      }}>
        vs corridor: {vsSign}{d.vs_corridor} L/100km
      </div>
    </div>
  );
}

function cellColor(vs_corridor) {
  if (vs_corridor <= 0) return 'var(--signal-green)';
  if (vs_corridor <= 1) return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

export default function FleetEfficiencyChart({ fleetEfficiency }) {
  if (!fleetEfficiency?.haulers?.length) return null;

  const { corridor_avg_l_per_100km, haulers } = fleetEfficiency;

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
            Fleet efficiency — L/100km by hauler
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          Average fuel consumption per hauler from rig telemetry (laden southbound).
          Corridor avg: <strong style={{ color: 'var(--text)' }}>{corridor_avg_l_per_100km} L/100km</strong>.
          Haulers above the line absorb the variance.
        </p>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(160, haulers.length * 44)}>
        <BarChart
          data={haulers}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={['auto', 'auto']}
            tickFormatter={(v) => `${v}L`}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="display_name"
            width={130}
            tick={{ fontSize: 12, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            x={corridor_avg_l_per_100km}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            label={{
              value: `Avg ${corridor_avg_l_per_100km}L`,
              position: 'top',
              fill: 'var(--text-tertiary)',
              fontSize: 10,
            }}
          />
          <Bar dataKey="avg_l_per_100km" name="L/100km" radius={[0, 3, 3, 0]} barSize={18}>
            {haulers.map((h) => (
              <Cell key={h.hauler_id} fill={cellColor(h.vs_corridor)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
