/*
 * TurnaroundTimeChart — Phase 233.
 * Horizontal bar chart of avg trip turnaround time per hauler (hours
 * from departed_at to completed_at, southbound laden trips).
 * Slowest haulers at the top — high turnaround tied to low cadence
 * (trip_cadence chart) indicates maintenance or driver behaviour issues.
 * Corridor average marked as a reference line.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts';

const CustomTooltip = ({ active, payload, corridorAvg }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const vs = Number((d.avg_hours - corridorAvg).toFixed(1));
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>{d.display_name}</div>
      <div style={{ color: 'var(--text-secondary)' }}>
        Avg turnaround: <strong>{d.avg_hours}h</strong>
      </div>
      <div style={{ color: vs > 0 ? 'var(--bauxite-rust)' : 'var(--signal-green)' }}>
        {vs > 0 ? '+' : ''}{vs}h vs corridor avg
      </div>
      <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
        {d.trip_count} southbound trip{d.trip_count !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

export default function TurnaroundTimeChart({ turnaroundByHauler }) {
  if (!turnaroundByHauler?.haulers?.length) return null;

  const { corridor_avg_hours: corridorAvg, haulers } = turnaroundByHauler;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      marginBottom: 'var(--space-4)',
    }}>
      <header style={{
        marginBottom: 'var(--space-3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            Trip turnaround time by hauler
          </span>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            Avg hours from departure to completion (southbound laden trips). Slower turnaround
            reduces weekly trip capacity. Cross with trip cadence to spot the underperformers.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 2 }}>
            CORRIDOR AVG
          </div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: 'var(--text)',
          }}>
            {corridorAvg}h
          </div>
        </div>
      </header>

      <ResponsiveContainer width="100%" height={haulers.length * 44 + 24}>
        <BarChart
          data={haulers}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tickFormatter={(v) => `${v}h`}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="display_name"
            width={120}
            tick={{ fontSize: 12, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<CustomTooltip corridorAvg={corridorAvg} />}
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          />
          <ReferenceLine
            x={corridorAvg}
            stroke="var(--charcoal)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: `avg ${corridorAvg}h`, position: 'top', fontSize: 10, fill: 'var(--text-tertiary)' }}
          />
          <Bar dataKey="avg_hours" radius={[0, 3, 3, 0]} maxBarSize={22} label={{
            position: 'right',
            formatter: (v) => `${v}h`,
            fontSize: 11,
            fill: 'var(--text-secondary)',
          }}>
            {haulers.map((entry) => (
              <Cell
                key={entry.hauler_id}
                fill={entry.vs_corridor > 2
                  ? 'var(--bauxite-rust)'
                  : entry.vs_corridor > 0
                    ? 'var(--signal-amber)'
                    : 'var(--signal-green)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
