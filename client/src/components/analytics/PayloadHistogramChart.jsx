/*
 * PayloadHistogramChart — Phase 231.
 * Bar chart of southbound trip counts binned by payload weight.
 * Shows how often trucks run underloaded (<35 t on a 40 t rated vehicle).
 * Underloaded trips are a direct EBITDA drag — same fuel cost, less tonnage.
 * Ops can use this as a loading dock or scheduling coaching trigger.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';

// Bins with colour: <30 t = underloaded (rust), 30-35 t = borderline (amber),
// ≥35 t = good (green)
function barColor(key) {
  if (key === 'under_25t' || key === '25_30t') return 'var(--bauxite-rust)';
  if (key === '30_35t')                         return 'var(--signal-amber)';
  return 'var(--signal-green)';
}

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
        {d.count} trip{d.count !== 1 ? 's' : ''} · {d.share_pct}% of southbound loads
      </div>
    </div>
  );
};

export default function PayloadHistogramChart({ payloadHistogram }) {
  if (!payloadHistogram?.length) return null;
  if (payloadHistogram.every((b) => b.count === 0)) return null;

  const underloaded = payloadHistogram
    .filter((b) => ['under_25t', '25_30t', '30_35t'].includes(b.key))
    .reduce((s, b) => s + b.share_pct, 0);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
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
            Trip payload distribution
          </span>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            Southbound trips by payload band. Loads under 35 t on a 40 t rated truck
            represent avoidable cost — the same fuel is burned for less revenue.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 2 }}>
            UNDERLOADED
          </div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: underloaded > 30 ? 'var(--bauxite-rust)' : 'var(--signal-amber)',
          }}>
            {underloaded.toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
            trips &lt; 35 t
          </div>
        </div>
      </header>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={payloadHistogram} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={52}>
            <LabelList
              dataKey="share_pct"
              position="top"
              formatter={(v) => v > 0 ? `${v}%` : ''}
              style={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            />
            {payloadHistogram.map((entry) => (
              <Cell key={entry.key} fill={barColor(entry.key)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
