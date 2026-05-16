/*
 * Phase 208 — 8-week axle event frequency trend.
 * Stacked BarChart: holds (rust) + warnings (amber) per week.
 * Current week uses live counts; prior 7 weeks MODELLED.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
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

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const holds    = payload.find((p) => p.dataKey === 'holds')?.value    ?? 0;
  const warnings = payload.find((p) => p.dataKey === 'warnings')?.value ?? 0;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>w/c {label}</div>
      <div style={{ color: 'var(--bauxite-rust)' }}>Holds: {holds}</div>
      <div style={{ color: 'var(--signal-amber)' }}>Warnings: {warnings}</div>
      <div style={{
        borderTop: '1px solid var(--border-hairline)',
        marginTop: 6,
        paddingTop: 6,
        fontWeight: 'var(--fw-semibold)',
      }}>
        Total: {holds + warnings}
      </div>
    </div>
  );
}

export default function AxleWeeklyTrendChart({ axleWeeklyTrend }) {
  if (!axleWeeklyTrend?.length) return null;

  const data = axleWeeklyTrend.map((w) => ({
    ...w,
    week: fmtDate(w.week),
  }));

  // 4-week rolling avg for context callout
  const last4 = axleWeeklyTrend.slice(-4);
  const avg4  = last4.length
    ? Math.round(last4.reduce((s, w) => s + w.total, 0) / last4.length)
    : null;

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
            Axle event frequency — 8 weeks
          </span>
          {MODELLED}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            Weighbridge holds and driver warnings per week.
            Holds trigger immediate off-road action; warnings serve as coaching input.
          </p>
          {avg4 != null && (
            <span style={{
              flexShrink: 0,
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-tertiary)',
            }}>
              4w avg: <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums lining-nums' }}>{avg4}</strong>/wk
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={24}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="holds"    name="Holds"    stackId="a" fill="var(--bauxite-rust)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="warnings" name="Warnings" stackId="a" fill="var(--signal-amber)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
