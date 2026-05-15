/*
 * Phase 176 — 8-week coaching session volume trend.
 * ComposedChart: stacked bars (urgent/high/medium/routine) + completion
 * rate line (right axis). Prior weeks MODELLED.
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const TIER_META = {
  urgent:  { color: 'var(--bauxite-rust)',           label: 'Urgent' },
  high:    { color: 'rgba(162,62,35,0.50)',           label: 'High' },
  medium:  { color: 'var(--signal-amber)',            label: 'Medium' },
  routine: { color: 'rgba(100,100,100,0.45)',         label: 'Routine' },
};
const TIER_KEYS = ['urgent', 'high', 'medium', 'routine'];

function weekLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function CustomTooltip({ active, payload, label }) {
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
        {weekLabel(label)}
        {d?.is_current && (
          <span style={{ marginLeft: 6, padding: '1px 5px', background: 'var(--bauxite-rust)', borderRadius: 3, color: '#fff', fontSize: 10 }}>LIVE</span>
        )}
        {d?.modelled && !d?.is_current && (
          <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 10 }}>MODELLED</span>
        )}
      </div>
      {TIER_KEYS.map((t) => (
        (d?.[t] ?? 0) > 0 && (
          <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
            <span style={{ color: TIER_META[t].color }}>{TIER_META[t].label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>{d[t]}</span>
          </div>
        )
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-hairline)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Total</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)' }}>{d?.total ?? 0}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Completion</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: (d?.completion_pct ?? 0) >= 70 ? 'var(--signal-green)' : 'var(--signal-amber)' }}>
          {d?.completion_pct ?? 0}%
        </span>
      </div>
    </div>
  );
}

export default function CoachingSessionTrend({ sessionTrend }) {
  if (!sessionTrend?.length) return null;

  const latest = sessionTrend[sessionTrend.length - 1];

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
            Session volume · 8-week trend
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <span style={{ fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-black)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {latest?.total ?? 0}
            </span>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              sessions this week · {latest?.completion_pct ?? 0}% completion
            </span>
          </div>
        </div>
        <span style={{ fontSize: 10, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border-hairline)', borderRadius: 3, color: 'var(--text-tertiary)' }}>
          MODELLED (prior weeks)
        </span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={sessionTrend} margin={{ top: 4, right: 40, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={weekLabel}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="sessions"
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} />

          {TIER_KEYS.map((t) => (
            <Bar
              key={t}
              dataKey={t}
              stackId="sessions"
              yAxisId="sessions"
              fill={TIER_META[t].color}
              name={TIER_META[t].label}
              barSize={20}
            />
          ))}

          <Line
            yAxisId="pct"
            dataKey="completion_pct"
            stroke="var(--signal-green)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            name="Completion %"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-2)', justifyContent: 'center', fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
        {TIER_KEYS.map((t) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: TIER_META[t].color }} />
            {TIER_META[t].label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 16, height: 2, background: 'var(--signal-green)', borderRadius: 1 }} />
          Completion %
        </div>
      </div>
    </div>
  );
}
