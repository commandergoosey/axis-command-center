/*
 * AlertHaulerVolumeChart — Phase 229.
 * Horizontal bar chart of open alert count per hauler (NEEDS_ACTION +
 * MONITORING). Shows which hauler is generating the most alert load so
 * ops can direct triage and coaching effort. Corridor-wide alerts (no
 * hauler_id) are grouped under a "Corridor-wide" label.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 2 }}>{d.label}</div>
      <div style={{ color: 'var(--text-secondary)' }}>
        {d.count} open alert{d.count !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

export default function AlertHaulerVolumeChart({ alertVolumeByHauler }) {
  if (!alertVolumeByHauler?.length) return null;

  const max = Math.max(...alertVolumeByHauler.map((h) => h.count));

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <span style={{
          fontSize: 'var(--ts-body-size)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          Open alert load by hauler
        </span>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          Active alerts (Needs Action + Monitoring) grouped by hauler.
          High load on a single hauler is a priority coaching and ops signal.
        </p>
      </header>

      <ResponsiveContainer width="100%" height={alertVolumeByHauler.length * 44 + 24}>
        <BarChart
          data={alertVolumeByHauler}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 4 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fontSize: 12, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={22} label={{
            position: 'right',
            formatter: (v) => v,
            fontSize: 11,
            fill: 'var(--text-secondary)',
          }}>
            {alertVolumeByHauler.map((entry) => (
              <Cell
                key={entry.label}
                fill={entry.count === max
                  ? 'var(--bauxite-rust)'
                  : entry.count >= max * 0.6
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
