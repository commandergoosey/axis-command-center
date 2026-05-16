/*
 * Phase 184 — Convoy departure cadence by hauler.
 * Horizontal BarChart showing average inter-departure gap per hauler
 * vs the 6-hour target. Wide gaps → bunching risk. Uses departure_cadence
 * from /api/convoys.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';

const TARGET_GAP_H = 6;

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const overTarget = (d.avg_gap_h ?? 0) > TARGET_GAP_H;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{d.hauler_display}</div>
      <Row label="Avg gap"    value={`${d.avg_gap_h ?? '—'}h`} color={overTarget ? 'var(--signal-amber)' : 'var(--signal-green)'} />
      <Row label="Min gap"    value={d.min_gap_h != null ? `${d.min_gap_h}h` : '—'} />
      <Row label="Max gap"    value={d.max_gap_h != null ? `${d.max_gap_h}h` : '—'} />
      <Row label="Convoys"    value={d.convoy_count} />
      <Row label="Target"     value={`${TARGET_GAP_H}h`} />
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

export default function ConvoyCadenceChart({ departureCadence }) {
  if (!departureCadence?.length) return null;

  // Only show haulers with at least 2 convoys (need 1 gap to be meaningful).
  const chartData = departureCadence.filter((h) => h.avg_gap_h != null);
  if (!chartData.length) return null;

  const bunchingCount = chartData.filter((h) => (h.avg_gap_h ?? 0) > TARGET_GAP_H).length;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Convoy departure cadence
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Avg inter-departure gap per hauler · target ≤ {TARGET_GAP_H}h · wide gaps = convoy bunching
          </div>
        </div>
        {bunchingCount > 0 && (
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--signal-amber)',
            fontWeight: 'var(--fw-medium)',
            whiteSpace: 'nowrap',
          }}>
            {bunchingCount} hauler{bunchingCount !== 1 ? 's' : ''} bunching
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={Math.max(100, chartData.length * 52)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}h`}
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
            x={TARGET_GAP_H}
            stroke="var(--signal-green)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: `${TARGET_GAP_H}h target`, position: 'insideTopRight', fontSize: 9, fill: 'var(--signal-green)' }}
          />
          <Bar dataKey="avg_gap_h" barSize={18} radius={[0, 3, 3, 0]}>
            {chartData.map((h) => (
              <Cell
                key={h.hauler_id}
                fill={(h.avg_gap_h ?? 0) > TARGET_GAP_H ? 'var(--signal-amber)' : 'var(--signal-green)'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
