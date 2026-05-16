/*
 * CoachingTopicChart — Phase 226.
 * Horizontal bar chart of coaching topic distribution across the
 * intervention pipeline. Identifies the dominant driver behaviour
 * themes on the corridor so ops can prioritise training materials.
 * MODELLED — seeded per pipeline entry (real topic tagging requires
 * session form data).
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const TOPIC_COLOR = {
  driver_behavior: 'var(--bauxite-rust)',
  hos_compliance:  'var(--signal-amber)',
  fuel_efficiency: 'var(--signal-green)',
  vehicle_check:   'var(--charcoal)',
  route_adherence: 'var(--text-tertiary)',
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

const CustomTooltip = ({ active, payload, total }) => {
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
        {d.count} driver{d.count !== 1 ? 's' : ''} · {pct}% of pipeline
      </div>
    </div>
  );
};

export default function CoachingTopicChart({ topicBreakdown }) {
  if (!topicBreakdown?.length) return null;

  const total = topicBreakdown.reduce((s, t) => s + t.count, 0);

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
            Topic distribution
          </span>
          {MODELLED}
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          Estimated coaching themes across the active intervention pipeline.
          Driver behaviour and HOS compliance account for the bulk of the
          coaching burden — a direct fleet safety signal.
        </p>
      </header>

      <ResponsiveContainer width="100%" height={topicBreakdown.length * 44 + 24}>
        <BarChart
          data={topicBreakdown}
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
          <Tooltip
            content={<CustomTooltip total={total} />}
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          />
          <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={22} label={{
            position: 'right',
            formatter: (v) => v,
            fontSize: 11,
            fill: 'var(--text-secondary)',
          }}>
            {topicBreakdown.map((entry) => (
              <Cell
                key={entry.key}
                fill={TOPIC_COLOR[entry.key] || 'var(--text-tertiary)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
