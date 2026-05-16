/*
 * Phase 209 — Per-hauler trip cadence: avg trips per week, trailing 8 weeks.
 * Horizontal BarChart, highest to lowest. Gives ops a fast view of which
 * haulers are running hardest and which are under-utilised.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 4 }}>{d.display_name}</div>
      <div>Avg: <strong>{d.avg_trips_per_week}</strong> trips/wk</div>
      <div style={{ color: 'var(--text-tertiary)' }}>
        {d.trips_8w} trips over {d.weeks_active} active week{d.weeks_active !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function barColor(avg, corridorAvg) {
  if (avg >= corridorAvg * 1.05) return 'var(--signal-green)';
  if (avg >= corridorAvg * 0.85) return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

export default function HaulerTripCadenceChart({ tripCadence }) {
  if (!tripCadence?.length) return null;

  const total   = tripCadence.reduce((s, h) => s + h.avg_trips_per_week, 0);
  const corrAvg = tripCadence.length > 0 ? Number((total / tripCadence.length).toFixed(1)) : 0;

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
            Trip cadence — avg trips/week per hauler
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          Trailing 8-week average. Corridor avg:{' '}
          <strong style={{ color: 'var(--text)' }}>{corrAvg} trips/wk</strong>.
          Haulers below 85% of corridor avg are flagged.
        </p>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(160, tripCadence.length * 44)}>
        <BarChart
          data={tripCadence}
          layout="vertical"
          margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 'auto']}
            tickFormatter={(v) => `${v}`}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'trips/wk', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: 'var(--text-tertiary)' }}
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
            x={corrAvg}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            label={{
              value: `Avg ${corrAvg}`,
              position: 'top',
              fill: 'var(--text-tertiary)',
              fontSize: 10,
            }}
          />
          <Bar dataKey="avg_trips_per_week" name="Avg trips/wk" radius={[0, 3, 3, 0]} barSize={18}>
            {tripCadence.map((h) => (
              <Cell key={h.hauler_id} fill={barColor(h.avg_trips_per_week, corrAvg)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
