/*
 * HaulerContributionCard — horizontal bars, tonnes delivered by hauler this week.
 * Charcoal bars with Bauxite Rust on the lead hauler. Manual-mode haulers
 * show an Ash bar to signal lag in the feed rather than a real gap.
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';

export default function HaulerContributionCard({ contribution }) {
  const rows = contribution ?? [];
  if (rows.length === 0) {
    return <CardFrame title="Hauler contribution" subtitle="No data" />;
  }

  const sorted = [...rows].sort((a, b) => b.tonnes_week - a.tonnes_week);
  const leadId = sorted[0].id;
  const total = rows.reduce((s, r) => s + r.tonnes_week, 0);

  return (
    <CardFrame
      title="Hauler contribution"
      subtitle="Tonnes delivered · last 7 days"
      right={
        <div style={{ textAlign: 'right' }}>
          <div
            className="tabular"
            style={{
              fontSize: 'var(--ts-h3-size)',
              fontWeight: 'var(--fw-black)',
              color: 'var(--text)',
            }}
          >
            {new Intl.NumberFormat('en-GB').format(total)}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.02em',
            }}
          >
            tonnes · corridor total
          </div>
        </div>
      }
    >
      <div style={{ height: 180, margin: '0 -8px' }}>
        <ResponsiveContainer>
          <BarChart
            data={sorted}
            layout="vertical"
            margin={{ top: 8, right: 28, bottom: 0, left: 16 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="display_name"
              tick={{
                fill: 'var(--text-secondary)',
                fontSize: 12,
                fontFamily: 'var(--font-primary)',
              }}
              axisLine={false}
              tickLine={false}
              width={84}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--charcoal)',
                border: 'none',
                borderRadius: 6,
                color: 'var(--bone)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
              cursor={{ fill: 'var(--accent-tint)' }}
              formatter={(v) => [`${new Intl.NumberFormat('en-GB').format(v)} t`, 'Week']}
            />
            <Bar dataKey="tonnes_week" maxBarSize={18} radius={[0, 2, 2, 0]}>
              {sorted.map((row) => (
                <Cell
                  key={row.id}
                  fill={row.id === leadId ? 'var(--bauxite-rust)' : 'var(--charcoal)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardFrame>
  );
}

function CardFrame({ title, subtitle, right, children }) {
  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        minHeight: 260,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
      }}>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)' }}>{title}</div>
          {subtitle && (
            <div style={{
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
              marginTop: 2,
            }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
