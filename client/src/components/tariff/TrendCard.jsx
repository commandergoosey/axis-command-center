/*
 * TrendCard — compact line chart for a single indexation driver series.
 * Shared between NPA diesel (GHS/L) and GSS CPI. Base-month reading is
 * marked with a dashed reference line so the current reading's delta is
 * visually clear.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

export default function TrendCard({ title, subtitle, series, baseMonth, baseValue, currentValue, unit, dataKey = 'value', color = 'var(--bauxite-rust)' }) {
  const data = series.map((r) => ({
    month: formatMonth(r.month),
    raw_month: r.month,
    [dataKey]: r[dataKey] ?? r.ghs_per_l ?? r.index,
  }));

  const latest = currentValue;
  const delta = baseValue > 0 ? ((latest - baseValue) / baseValue) * 100 : 0;
  const deltaColor = delta > 0 ? 'var(--bauxite-rust)' : delta < 0 ? 'var(--signal-green)' : 'var(--text-tertiary)';

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="eyebrow">{title}</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h2-size)',
            lineHeight: 'var(--ts-h2-lh)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {formatValue(latest, unit)}
          </div>
          <div className="mono" style={{
            fontSize: 'var(--ts-caption-size)',
            color: deltaColor,
            letterSpacing: '0.04em',
          }}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(2)}% vs base
          </div>
        </div>
      </header>

      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-hairline)' }}
              interval={1}
            />
            <YAxis
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              domain={['dataMin - 0.5', 'dataMax + 0.5']}
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
              }}
              formatter={(value) => [formatValue(value, unit), title]}
            />
            <ReferenceLine
              y={baseValue}
              stroke="var(--charcoal)"
              strokeDasharray="3 3"
              label={{
                value: `BASE · ${formatMonth(baseMonth)}`,
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                fill: 'var(--text-tertiary)',
                position: 'insideTopLeft',
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 2, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function formatValue(v, unit) {
  if (v == null) return '—';
  const fixed = Number(v).toFixed(2);
  return unit ? `${fixed} ${unit}` : fixed;
}

function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}
