/*
 * RepairTypeChart — Phase 224.
 * Horizontal bar chart showing the breakdown of maintenance events
 * by repair category (engine, brakes, tyres, electrical, bodywork).
 * Gives ops a fast read on which failure modes dominate the corridor.
 * MODELLED — seeded from the rig roster.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const TYPE_COLOR = {
  engine:      'var(--bauxite-rust)',
  brakes:      'var(--signal-amber)',
  tyres:       'var(--signal-green)',
  electrical:  'var(--charcoal)',
  bodywork:    'var(--text-tertiary)',
};

const MODELLED = (
  <span style={{
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: '0.07em',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(184,134,11,0.10)',
    color: 'var(--signal-amber)',
    border: '1px solid rgba(184,134,11,0.22)',
    verticalAlign: 'middle',
    marginLeft: 6,
  }}>MODELLED</span>
);

export default function RepairTypeChart({ repairTypeBreakdown }) {
  if (!repairTypeBreakdown?.length) return null;

  const total = repairTypeBreakdown.reduce((s, r) => s + r.count, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const pct = total > 0 ? ((d.count / total) * 100).toFixed(0) : 0;
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
          {d.count} events · {pct}% of total
        </div>
      </div>
    );
  };

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            Repair type breakdown
          </span>
          {MODELLED}
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          Distribution of maintenance events by failure category across the active rig roster.
          Engine and brake issues carry the highest downtime cost.
        </p>
      </header>

      <ResponsiveContainer width="100%" height={repairTypeBreakdown.length * 44 + 24}>
        <BarChart
          data={repairTypeBreakdown}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 4 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tickFormatter={(v) => v}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fontSize: 12, fill: 'var(--text)', dy: 0 }}
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
            {repairTypeBreakdown.map((entry) => (
              <Cell
                key={entry.key}
                fill={TYPE_COLOR[entry.key] || 'var(--text-tertiary)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
