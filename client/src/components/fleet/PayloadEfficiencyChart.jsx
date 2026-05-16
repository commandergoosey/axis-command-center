/*
 * PayloadEfficiencyChart — Phase 199.
 * Horizontal BarChart comparing each hauler's average actual payload (tonnes
 * loaded per southbound trip) against their fleet's average rated capacity.
 * The efficiency % shows how close to full-load the operator runs — gaps
 * signal suboptimal loading at the mine gate or oversized rig allocation.
 *
 * Data: roster.data.payload_efficiency[] from GET /api/fleet.
 * Each entry: { hauler_id, hauler_display, avg_capacity_t, avg_payload_t, efficiency_pct, trip_count }
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

function barColor(pct) {
  if (pct == null) return 'var(--text-tertiary)';
  if (pct >= 90)   return 'var(--signal-green)';
  if (pct >= 80)   return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

function shortName(s) {
  return s.replace(/\s+Haulage.*/, '').replace(/\s+Transport.*/, '');
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      minWidth: 180,
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        {d.hauler_display}
      </div>
      <Row label="Avg payload"   value={`${d.avg_payload_t} t`}    color={barColor(d.efficiency_pct)} />
      <Row label="Rated capacity" value={`${d.avg_capacity_t} t`}   color="var(--text-tertiary)" />
      <Row label="Efficiency"    value={`${d.efficiency_pct}%`}     color={barColor(d.efficiency_pct)} />
      <Row label="Trips sampled" value={d.trip_count.toLocaleString()} color="var(--text-tertiary)" />
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export default function PayloadEfficiencyChart({ payloadEfficiency }) {
  if (!payloadEfficiency?.length) return null;

  const chartData = payloadEfficiency.map((h) => ({
    ...h,
    name: shortName(h.hauler_display),
  }));

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <span className="eyebrow">Payload efficiency by hauler</span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          Avg actual ÷ rated capacity · southbound laden trips
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 40, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={80}
              tick={{ fontSize: 11, fill: 'var(--text)', fontFamily: 'var(--font-primary)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <ReferenceLine
              x={90}
              stroke="var(--signal-green)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: '90%',
                position: 'top',
                fontSize: 9,
                fill: 'var(--signal-green)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <Bar dataKey="efficiency_pct" radius={[0, 3, 3, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.hauler_id} fill={barColor(entry.efficiency_pct)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          {[
            { color: 'var(--signal-green)', label: '≥ 90% — full-load' },
            { color: 'var(--signal-amber)', label: '80–89% — light-load' },
            { color: 'var(--bauxite-rust)', label: '< 80% — underloaded' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.85 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
