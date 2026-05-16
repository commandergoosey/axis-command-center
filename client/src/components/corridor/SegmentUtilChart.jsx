/*
 * Phase 191 — Corridor segment utilisation.
 * Horizontal BarChart: laden / (laden + empty) per segment.
 * High utilisation = more southbound (loaded) runs than return.
 * Uses segment_util from /api/corridor.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';

// Waypoint ID → readable short label for the chart.
const WAYPOINT_LABEL = {
  'nyinahin-wb':   'Nyinahin WB',
  'kumasi-jct':    'Kumasi Jct',
  'mid-wb':        'Bekwai WB',
  'dunkwa-rest':   'Dunkwa Rest',
  'takoradi-wb':   'Takoradi WB',
  'takoradi-port': 'Takoradi Port',
};

function shortLabel(waypointId) {
  return WAYPOINT_LABEL[waypointId] ?? waypointId;
}

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
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
        {shortLabel(d.from)} → {shortLabel(d.to)}
      </div>
      <Row label="Laden (southbound)"  value={`${d.laden} trucks`} color="var(--bauxite-rust)" />
      <Row label="Empty (northbound)"  value={`${d.empty} trucks`} color="var(--text-secondary)" />
      <Row label="Total"               value={`${d.total} trucks`} />
      <Row label="Utilisation"         value={`${d.util_pct}%`} color={d.util_pct >= 55 ? 'var(--signal-green)' : 'var(--signal-amber)'} />
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

export default function SegmentUtilChart({ segmentUtil }) {
  if (!segmentUtil?.length) return null;

  // Add readable labels for chart display.
  const chartData = segmentUtil.map((s) => ({
    ...s,
    seg_label: `${shortLabel(s.from)} → ${shortLabel(s.to)}`,
  }));

  const avgUtil = Math.round(chartData.reduce((s, seg) => s + seg.util_pct, 0) / chartData.length);

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
            Segment utilisation
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Laden trucks as % of total corridor traffic per segment · pinch points show as low util
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: 'var(--ts-h2-size, 22px)',
            fontWeight: 'var(--fw-black)',
            fontVariantNumeric: 'tabular-nums',
            color: avgUtil >= 50 ? 'var(--signal-green)' : 'var(--signal-amber)',
            lineHeight: 1.1,
          }}>
            {avgUtil}%
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            corridor avg
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barSize={32}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="seg_label"
            tick={{ fontSize: 9, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine
            y={50}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            strokeWidth={1}
            label={{ value: '50%', position: 'insideTopRight', fontSize: 9, fill: 'var(--text-tertiary)' }}
          />
          <Bar dataKey="util_pct" radius={[3, 3, 0, 0]}>
            {chartData.map((seg) => (
              <Cell
                key={seg.id}
                fill={seg.util_pct >= 55 ? 'var(--bauxite-rust)' : 'var(--signal-amber)'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', textAlign: 'right' }}>
        Rust = &gt;55% laden · Amber = &lt;55% · dashed = 50% balanced-flow reference
      </div>
    </div>
  );
}
