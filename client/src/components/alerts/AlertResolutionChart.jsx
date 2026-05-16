/*
 * Phase 212 — Mean time to resolve by alert type.
 * Horizontal BarChart, sorted slowest-to-resolve first.
 * MODELLED — seeded values reflect domain knowledge of each type's
 * typical resolution pathway (convoy delays clear in hours; licence
 * renewals go through DVLA and take days).
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

const MODELLED = (
  <span style={{
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--signal-amber)',
    background: 'rgba(217,158,45,0.12)',
    borderRadius: 3,
    padding: '1px 5px',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function cellColor(days) {
  if (days <= 1)  return 'var(--signal-green)';
  if (days <= 3)  return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 4 }}>{d.label}</div>
      <div style={{ color: cellColor(d.avg_days) }}>
        Avg resolution: <strong>{d.avg_days} days</strong>
      </div>
    </div>
  );
}

export default function AlertResolutionChart({ resolutionByType }) {
  if (!resolutionByType?.length) return null;

  // Reverse for horizontal chart: top = slowest (worst at top of list)
  const data = [...resolutionByType].reverse();
  const overallAvg = Number(
    (resolutionByType.reduce((s, t) => s + t.avg_days, 0) / resolutionByType.length).toFixed(1),
  );

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
          }}>
            Mean time to resolve by alert type
          </span>
          {MODELLED}
        </div>
        <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          Average days from alert opening to resolution.
          Overall avg: <strong style={{ color: 'var(--text)' }}>{overallAvg} days</strong>.
          Fastest types: convoy delays and integration failures. Slowest: licence and filing issues.
        </p>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 'auto']}
            tickFormatter={(v) => `${v}d`}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={148}
            tick={{ fontSize: 11, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            x={overallAvg}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            label={{
              value: `Avg ${overallAvg}d`,
              position: 'top',
              fill: 'var(--text-tertiary)',
              fontSize: 10,
            }}
          />
          <Bar dataKey="avg_days" name="Avg days" radius={[0, 3, 3, 0]} barSize={16}>
            {data.map((d) => (
              <Cell key={d.type} fill={cellColor(d.avg_days)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
