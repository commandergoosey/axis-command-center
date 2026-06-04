/*
 * Phase 180 — DSO (Days Sales Outstanding) 6-month trend.
 * LineChart with a 30-day target reference line.
 * Derives from dso_trend on /api/financials.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function formatMonth(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
        {formatMonth(d?.month)}
        {d?.partial && (
          <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>MTD</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>DSO</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: (d?.dso ?? 0) > 35 ? 'var(--signal-amber)' : 'var(--signal-green)' }}>
          {d?.dso} days
        </span>
      </div>
      {d?.modelled && (
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Modelled (§12.4)
        </div>
      )}
    </div>
  );
}

export default function DSOTrendChart({ dsoTrend }) {
  if (!dsoTrend?.length) return null;

  const currentDso = dsoTrend[dsoTrend.length - 1]?.dso ?? 0;
  const overTarget = currentDso > 30;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Days Sales Outstanding — 6-month trend
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Target ≤ 30 days · corridor receivables velocity
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 'var(--ts-h2-size, 22px)',
            fontWeight: 'var(--fw-black)',
            fontVariantNumeric: 'tabular-nums',
            color: overTarget ? 'var(--signal-amber)' : 'var(--signal-green)',
            lineHeight: 1.1,
          }}>
            {currentDso}d
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            current DSO
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-3)', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--signal-amber)', display: 'inline-block' }} />
        Modelled (§12.4) — prior months
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={dsoTrend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}d`}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={30}
            stroke="var(--signal-green)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: '30d target', position: 'insideTopRight', fontSize: 9, fill: 'var(--signal-green)' }}
          />
          <Line
            dataKey="dso"
            stroke="var(--signal-amber)"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              if (payload.partial) {
                return <circle key={cx} cx={cx} cy={cy} r={4} fill="var(--signal-amber)" stroke="var(--surface-raised)" strokeWidth={2} />;
              }
              return <circle key={cx} cx={cx} cy={cy} r={3} fill="var(--signal-amber)" />;
            }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
