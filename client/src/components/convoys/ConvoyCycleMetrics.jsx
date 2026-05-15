/*
 * Phase 171 — per-hauler convoy cycle time metrics.
 * Horizontal bar chart showing average cycle hours per hauler,
 * with on-schedule % and convoy count as secondary stats.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
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
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
        {d.hauler_display}
      </div>
      <Row label="Avg cycle" value={d.avg_cycle_h != null ? `${d.avg_cycle_h} h` : '—'} />
      <Row label="Min cycle" value={d.min_cycle_h != null ? `${d.min_cycle_h} h` : '—'} />
      <Row label="Max cycle" value={d.max_cycle_h != null ? `${d.max_cycle_h} h` : '—'} />
      <Row label="On schedule" value={d.on_schedule_pct != null ? `${d.on_schedule_pct}%` : '—'} />
      <Row label="Convoys" value={d.total_convoys} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

export default function ConvoyCycleMetrics({ haulerCycleMetrics }) {
  if (!haulerCycleMetrics?.length) return null;

  // Build chart data only for haulers that have cycle_h data.
  const chartData = haulerCycleMetrics.filter((h) => h.avg_cycle_h != null);
  if (!chartData.length) return null;

  // Corridor avg cycle for the reference line.
  const corridorAvg = Number(
    (chartData.reduce((s, h) => s + h.avg_cycle_h, 0) / chartData.length).toFixed(1),
  );

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
        marginBottom: 'var(--space-1)',
      }}>
        Convoy cycle time · by hauler
      </div>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-secondary)',
        marginBottom: 'var(--space-3)',
      }}>
        Average round-trip hours · corridor avg {corridorAvg} h
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 'dataMax + 4']}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            unit=" h"
          />
          <YAxis
            type="category"
            dataKey="hauler_display"
            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={110}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine
            x={corridorAvg}
            stroke="var(--signal-amber)"
            strokeDasharray="4 3"
            strokeOpacity={0.7}
            label={{ value: 'Avg', position: 'top', fontSize: 9, fill: 'var(--signal-amber)' }}
          />
          <Bar dataKey="avg_cycle_h" barSize={16} radius={[0, 3, 3, 0]}>
            {chartData.map((_, i) => (
              <Cell
                key={i}
                fill={CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length]}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* On-schedule summary row */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
        paddingTop: 'var(--space-3)',
        flexWrap: 'wrap',
      }}>
        {haulerCycleMetrics.map((h, i) => (
          <div key={h.hauler_id} style={{ fontSize: 'var(--ts-caption-size)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length],
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>{h.hauler_display}</span>
            <span style={{
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-medium)',
              color: (h.on_schedule_pct ?? 0) >= 70 ? 'var(--signal-green)' : 'var(--signal-amber)',
            }}>
              {h.on_schedule_pct != null ? `${h.on_schedule_pct}% on time` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
