/*
 * RiskAgeChart — Phase 225.
 * Horizontal bar chart showing open risks bucketed by age (days since
 * created_at). Older open risks indicate slow triage or stale register
 * hygiene. Rust for 90d+, amber for 31-90d, green for fresh risks.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const BUCKET_COLOR = {
  d0_7:    'var(--signal-green)',
  d8_30:   'var(--signal-green)',
  d31_90:  'var(--signal-amber)',
  d91plus: 'var(--bauxite-rust)',
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
        {d.count} open risk{d.count !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

export default function RiskAgeChart({ riskAgeProfile }) {
  if (!riskAgeProfile?.length) return null;
  if (riskAgeProfile.every((b) => b.count === 0)) return null;

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
          Open risk age profile
        </span>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          How long open risks have been in the register. Risks open 90d+
          without review are a governance flag — review or close them.
        </p>
      </header>

      <ResponsiveContainer width="100%" height={riskAgeProfile.length * 44 + 24}>
        <BarChart
          data={riskAgeProfile}
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
            width={96}
            tick={{ fontSize: 12, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={22} label={{
            position: 'right',
            formatter: (v) => v || '',
            fontSize: 11,
            fill: 'var(--text-secondary)',
          }}>
            {riskAgeProfile.map((entry) => (
              <Cell
                key={entry.key}
                fill={BUCKET_COLOR[entry.key] || 'var(--text-tertiary)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
