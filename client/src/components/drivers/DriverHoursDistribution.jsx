/*
 * Phase 173 — driver HOS hours distribution chart.
 * Buckets drivers by their hours_this_week into 5 compliance bands
 * and shows a BarChart. No server change needed — uses the hours_this_week
 * field already present on each driver record.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const BINS = [
  { key: '0–40h',   min: 0,  max: 40, label: '≤40 h',  color: 'var(--signal-green)',    desc: 'Well within limit' },
  { key: '41–50h',  min: 41, max: 50, label: '41–50 h', color: 'rgba(16,185,129,0.55)',  desc: 'Normal operating range' },
  { key: '51–56h',  min: 51, max: 56, label: '51–56 h', color: 'var(--signal-amber)',    desc: 'Approaching limit' },
  { key: '57–60h',  min: 57, max: 60, label: '57–60 h', color: 'var(--bauxite-rust)',    desc: 'Near legal maximum' },
  { key: '60h+',    min: 61, max: Infinity, label: '60+ h', color: '#7f1d1d',            desc: 'Breach — requires action' },
];

function buildBins(drivers) {
  const counts = Object.fromEntries(BINS.map((b) => [b.key, 0]));
  for (const d of drivers) {
    const h = d.hours_this_week ?? 0;
    for (const b of BINS) {
      if (h >= b.min && h <= b.max) { counts[b.key]++; break; }
    }
  }
  return BINS.map((b) => ({ ...b, count: counts[b.key] }));
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
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>{d.label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Drivers</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: d.color }}>
          {d.count}
        </span>
      </div>
      <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>{d.desc}</div>
    </div>
  );
}

export default function DriverHoursDistribution({ drivers }) {
  if (!drivers?.length) return null;

  const data        = buildBins(drivers);
  const total       = drivers.length;
  const breachCount = data.find((b) => b.key === '60h+')?.count ?? 0;
  const nearCount   = (data.find((b) => b.key === '57–60h')?.count ?? 0) + breachCount;

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
            Driver HOS distribution · this week
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            {total} driver{total !== 1 ? 's' : ''} · 60 h weekly legal maximum (GHA Road Traffic Regs)
          </div>
        </div>
        {breachCount > 0 && (
          <span style={{
            padding: '2px 8px',
            background: 'rgba(127,29,29,0.10)',
            border: '1px solid rgba(127,29,29,0.30)',
            borderRadius: 4,
            fontSize: 'var(--ts-caption-size)',
            color: '#7f1d1d',
            fontWeight: 'var(--fw-medium)',
          }}>
            {breachCount} breach{breachCount !== 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
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
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} barSize={36}>
            {data.map((b) => (
              <Cell key={b.key} fill={b.color} fillOpacity={0.80} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Summary callout */}
      {nearCount > 0 && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'rgba(162,62,35,0.06)',
          border: '1px solid rgba(162,62,35,0.20)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
        }}>
          <strong style={{ color: 'var(--bauxite-rust)' }}>{nearCount}</strong> driver{nearCount !== 1 ? 's' : ''} at or near the 60 h ceiling — review scheduling before next dispatch.
        </div>
      )}
    </div>
  );
}
