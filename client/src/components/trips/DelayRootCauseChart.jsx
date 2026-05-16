/*
 * Phase 189 — Trip delay root-cause breakdown.
 * BarChart of delayed trips grouped by seeded operational cause.
 * Dual axis: count (bars) + avg delay minutes (implicit via tooltip).
 * Uses delay_causes from /api/trips.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ResponsiveContainer,
} from 'recharts';

const CAUSE_COLORS = {
  weighbridge_queue: 'var(--signal-amber)',
  traffic:           'var(--bauxite-rust)',
  mechanical:        'rgba(139,92,246,0.85)',
  driver_rest:       'rgba(59,130,246,0.85)',
  weather:           'rgba(16,185,129,0.85)',
};

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
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{d.label}</div>
      <Row label="Delayed trips" value={d.count} />
      <Row label="Avg delay"     value={`${d.avg_delay_min} min`} color={d.avg_delay_min > 45 ? 'var(--bauxite-rust)' : 'var(--signal-amber)'} />
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: color ?? 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

export default function DelayRootCauseChart({ delayCauses }) {
  if (!delayCauses?.length) return null;

  const topCause = delayCauses[0];
  const totalDelayed = delayCauses.reduce((s, c) => s + c.count, 0);

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
            Delay root-cause breakdown
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            {totalDelayed} delayed trip{totalDelayed !== 1 ? 's' : ''} classified by operational cause
          </div>
        </div>
        {topCause && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 'var(--ts-caption-size)',
              fontWeight: 'var(--fw-medium)',
              color: CAUSE_COLORS[topCause.key] ?? 'var(--signal-amber)',
            }}>
              {topCause.label}
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              top cause ({topCause.count} trips)
            </div>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={delayCauses} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barSize={32}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={24}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {delayCauses.map((c) => (
              <Cell
                key={c.key}
                fill={CAUSE_COLORS[c.key] ?? 'var(--text-tertiary)'}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Avg delay footer */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
        flexWrap: 'wrap',
      }}>
        {delayCauses.map((c) => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: CAUSE_COLORS[c.key] ?? 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              {c.label} · avg {c.avg_delay_min} min
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
