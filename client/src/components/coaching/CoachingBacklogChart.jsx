/*
 * Phase 192 — Coaching backlog by hauler.
 * Stacked horizontal BarChart: urgent / high / medium / routine per hauler.
 * Sorted by urgent+high descending so the most at-risk haulers sit at top.
 * Uses backlog_by_hauler from /api/coaching/pipeline.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const TIER_META = {
  urgent:  { label: 'Urgent',  color: 'var(--bauxite-rust)' },
  high:    { label: 'High',    color: 'var(--signal-amber)' },
  medium:  { label: 'Medium',  color: 'rgba(59,130,246,0.85)' },
  routine: { label: 'Routine', color: 'rgba(16,185,129,0.75)' },
};

const TIER_KEYS = ['urgent', 'high', 'medium', 'routine'];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 170,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: p.fill }}>{TIER_META[p.dataKey]?.label ?? p.dataKey}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)' }}>{p.value}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--border-hairline)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Total</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)' }}>{total}</span>
      </div>
    </div>
  );
}

export default function CoachingBacklogChart({ backlogByHauler }) {
  if (!backlogByHauler?.length) return null;

  const totalPipeline = backlogByHauler.reduce((s, h) => s + h.total, 0);
  const urgentTotal   = backlogByHauler.reduce((s, h) => s + (h.urgent ?? 0), 0);

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
            Coaching backlog by hauler
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Drivers in intervention pipeline · sorted by urgent + high count
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: 'var(--ts-h2-size, 22px)',
            fontWeight: 'var(--fw-black)',
            fontVariantNumeric: 'tabular-nums',
            color: urgentTotal > 0 ? 'var(--bauxite-rust)' : 'var(--text)',
            lineHeight: 1.1,
          }}>
            {totalPipeline}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            total in pipeline
          </div>
        </div>
      </div>

      {urgentTotal > 0 && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(185,68,49,0.08)',
          border: '1px solid rgba(185,68,49,0.25)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--bauxite-rust)',
          marginBottom: 'var(--space-3)',
        }}>
          {urgentTotal} driver{urgentTotal !== 1 ? 's' : ''} in urgent tier — safety intervention overdue
        </div>
      )}

      <ResponsiveContainer width="100%" height={Math.max(100, backlogByHauler.length * 52)}>
        <BarChart
          data={backlogByHauler}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="hauler_display"
            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={110}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          {TIER_KEYS.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="backlog"
              fill={TIER_META[key].color}
              barSize={18}
              radius={key === 'routine' ? [0, 3, 3, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
      }}>
        {TIER_KEYS.map((key) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: TIER_META[key].color }} />
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>{TIER_META[key].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
