/*
 * ViolationTypeChart — Phase 228.
 * Horizontal bar chart of active compliance violations grouped by type:
 * axle holds, axle warnings, licence expiring, filing overdue. Gives
 * ops a quick read on which compliance category is driving the current
 * burden so they can direct remediation effort appropriately.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const SEVERITY_COLOR = {
  high:   'var(--bauxite-rust)',
  medium: 'var(--signal-amber)',
  low:    'var(--text-tertiary)',
};

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
        {d.count} active violation{d.count !== 1 ? 's' : ''}
      </div>
      <div style={{
        marginTop: 3,
        fontSize: 10,
        color: SEVERITY_COLOR[d.severity] || 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {d.severity} severity
      </div>
    </div>
  );
};

export default function ViolationTypeChart({ violationByType }) {
  if (!violationByType?.length) return null;

  const total = violationByType.reduce((s, v) => s + v.count, 0);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            Active violations by type
          </span>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            Compliance burden breakdown — axle holds and overdue filings carry the highest
            operational and regulatory risk. Tackle these first.
          </p>
        </div>
        <div style={{
          flexShrink: 0,
          marginLeft: 'var(--space-4)',
          textAlign: 'right',
        }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 2 }}>TOTAL</div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h2-size)',
            fontWeight: 'var(--fw-black)',
            color: total > 0 ? 'var(--bauxite-rust)' : 'var(--signal-green)',
          }}>
            {total}
          </div>
        </div>
      </header>

      <ResponsiveContainer width="100%" height={violationByType.length * 44 + 24}>
        <BarChart
          data={violationByType}
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
            width={132}
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
            {violationByType.map((entry) => (
              <Cell
                key={entry.key}
                fill={SEVERITY_COLOR[entry.severity] || 'var(--text-tertiary)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
