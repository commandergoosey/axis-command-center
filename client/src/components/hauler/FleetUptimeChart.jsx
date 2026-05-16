/*
 * Phase 193 — Fleet uptime by hauler.
 * Horizontal BarChart showing operational (active + in_transit) vs
 * idle + garage trucks per hauler as an uptime percentage.
 * Uses fleet_uptime field on each hauler from /api/haulers.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';

const TARGET_UPTIME = 70; // operational fleet uptime target %

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const fu = d.fleet_uptime;
  if (!fu) return null;
  const overTarget = (fu.uptime_pct ?? 0) >= TARGET_UPTIME;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 190,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{d.display_name}</div>
      <Row label="Operational"    value={`${fu.operational} trucks`} color={overTarget ? 'var(--signal-green)' : 'var(--signal-amber)'} />
      <Row label="Idle"           value={`${fu.idle} trucks`} />
      <Row label="In workshop"    value={`${fu.garage} trucks`} color={fu.garage > 0 ? 'var(--bauxite-rust)' : 'var(--text)'} />
      <Row label="Fleet total"    value={`${fu.total} trucks`} />
      <Row label="Uptime %"       value={`${fu.uptime_pct}%`} color={overTarget ? 'var(--signal-green)' : 'var(--signal-amber)'} />
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

export default function FleetUptimeChart({ haulers }) {
  if (!haulers?.length) return null;

  // Only include haulers with fleet_uptime data.
  const chartData = haulers
    .filter((h) => h.fleet_uptime && h.status === 'active')
    .sort((a, b) => (b.fleet_uptime.uptime_pct ?? 0) - (a.fleet_uptime.uptime_pct ?? 0));

  if (!chartData.length) return null;

  const corridorUptime = Math.round(
    chartData.reduce((s, h) => s + (h.fleet_uptime.uptime_pct ?? 0), 0) / chartData.length,
  );
  const belowTarget = chartData.filter((h) => (h.fleet_uptime.uptime_pct ?? 0) < TARGET_UPTIME).length;

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
            Fleet operational uptime by hauler
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Active + in-transit as % of contracted fleet · target ≥ {TARGET_UPTIME}%
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: 'var(--ts-h2-size, 22px)',
            fontWeight: 'var(--fw-black)',
            fontVariantNumeric: 'tabular-nums',
            color: corridorUptime >= TARGET_UPTIME ? 'var(--signal-green)' : 'var(--signal-amber)',
            lineHeight: 1.1,
          }}>
            {corridorUptime}%
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>corridor avg</div>
        </div>
      </div>

      {belowTarget > 0 && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-amber)',
          marginBottom: 'var(--space-3)',
        }}>
          {belowTarget} hauler{belowTarget !== 1 ? 's' : ''} below {TARGET_UPTIME}% uptime target
        </div>
      )}

      <ResponsiveContainer width="100%" height={Math.max(80, chartData.length * 52)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
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
          <ReferenceLine
            x={TARGET_UPTIME}
            stroke="var(--signal-green)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: `${TARGET_UPTIME}%`, position: 'insideTopRight', fontSize: 9, fill: 'var(--signal-green)' }}
          />
          <Bar dataKey="fleet_uptime.uptime_pct" barSize={18} radius={[0, 3, 3, 0]}>
            {chartData.map((h) => (
              <Cell
                key={h.id}
                fill={(h.fleet_uptime.uptime_pct ?? 0) >= TARGET_UPTIME ? 'var(--signal-green)' : 'var(--signal-amber)'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
