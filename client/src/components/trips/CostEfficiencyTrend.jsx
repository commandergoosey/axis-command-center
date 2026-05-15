/*
 * CostEfficiencyTrend — Phase 141.
 * 12-week rolling chart: avg cost/tonne (bar) + delay rate % (line).
 * Data comes from /api/trips → cost_trend array.
 *
 * Props:
 *   trend — cost_trend from the trips API response
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

function weekLabel(iso) {
  // iso = 'YYYY-MM-DD' (Monday of the week)
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '10px 14px',
      fontSize:     'var(--ts-caption-size)',
      color:        'var(--text)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
        w/c {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="tabular" style={{ color: 'var(--text)', marginLeft: 'auto' }}>
            {p.dataKey === 'delay_rate_pct' ? `${p.value}%` : `$${p.value}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CostEfficiencyTrend({ trend }) {
  if (!trend || trend.length < 2) return null;

  const chartData = trend.map((w) => ({
    week:                weekLabel(w.week),
    avg_cost_per_tonne:  w.avg_cost_per_tonne,
    delay_rate_pct:      w.delay_rate_pct,
    trip_count:          w.trip_count,
  }));

  // Axis domains with a little headroom
  const maxCost  = Math.max(...chartData.map((d) => d.avg_cost_per_tonne ?? 0), 0);
  const maxDelay = Math.max(...chartData.map((d) => d.delay_rate_pct ?? 0), 0);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Cost efficiency · 12-week trend</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          avg cost / tonne (bar) · delay rate % (line)
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-hairline)"
              vertical={false}
            />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            {/* Left Y — cost/tonne */}
            <YAxis
              yAxisId="cost"
              orientation="left"
              domain={[0, Math.ceil(maxCost * 1.15)]}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v}`}
              width={42}
            />
            {/* Right Y — delay % */}
            <YAxis
              yAxisId="delay"
              orientation="right"
              domain={[0, Math.ceil(Math.max(maxDelay * 1.4, 10))]}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              yAxisId="cost"
              dataKey="avg_cost_per_tonne"
              name="Cost/tonne"
              fill="var(--bauxite-rust)"
              opacity={0.55}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="delay"
              dataKey="delay_rate_pct"
              name="Delay rate"
              stroke="var(--signal-amber)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: 'var(--signal-amber)' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
