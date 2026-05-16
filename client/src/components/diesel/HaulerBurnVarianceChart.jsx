/*
 * Phase 179 — per-hauler fuel burn variance chart (client-only).
 * Diverging horizontal BarChart: bars extend right (over corridor avg, worse)
 * in rust, left (under avg, better) in green. Uses existing burn_ranking data.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const above = (d.vs_avg_pct ?? 0) > 0;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{d.display_name}</div>
      <Row label="Burn cost"    value={`$${d.fuel_usd_per_tonne}/t`} />
      <Row label="vs avg"       value={`${above ? '+' : ''}${d.vs_avg_pct}%`}
           color={above ? 'var(--bauxite-rust)' : 'var(--signal-green)'} />
      <Row label="vs avg ($)"   value={`${above ? '+' : ''}$${d.vs_avg_usd}/t`} />
      <Row label="Trips"        value={d.trip_count} />
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: color ?? 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

export default function HaulerBurnVarianceChart({ burnRanking, corridorAvg }) {
  if (!burnRanking?.length) return null;

  // Center the domain symmetrically around 0.
  const maxAbs = Math.max(...burnRanking.map((h) => Math.abs(h.vs_avg_pct ?? 0)), 5);
  const domain = [-(maxAbs + 2), maxAbs + 2];

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
          Fuel burn variance vs corridor avg
        </div>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          Corridor avg ${corridorAvg?.toFixed(2) ?? '—'}/t · bars extend right = above avg (higher cost)
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(100, burnRanking.length * 52)}>
        <BarChart
          data={burnRanking}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={domain}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`}
          />
          <YAxis
            type="category"
            dataKey="display_name"
            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={110}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine x={0} stroke="var(--text-tertiary)" strokeWidth={1.5} />
          <Bar dataKey="vs_avg_pct" barSize={18} radius={[0, 3, 3, 0]}>
            {burnRanking.map((h) => (
              <Cell
                key={h.hauler_id}
                fill={(h.vs_avg_pct ?? 0) > 0 ? 'var(--bauxite-rust)' : 'var(--signal-green)'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
