/*
 * Phase 175 — 8-week maintenance cost trend (MODELLED).
 * Stacked AreaChart: workshop labour/overhead (rust) + parts (amber).
 * Current week uses live rig counters; prior weeks are seeded.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function weekLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function fmtUSD(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v}`;
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
      minWidth: 170,
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
      <Row label="Workshop"    value={fmtUSD(d?.workshop_usd)} color="var(--bauxite-rust)" />
      <Row label="Parts"       value={fmtUSD(d?.parts_usd)}    color="var(--signal-amber)" />
      <Row label="Total"       value={fmtUSD(d?.total_usd)}    color="var(--text)" bold />
      <Row label="Rigs in shop" value={d?.rigs_in_shop}        color="var(--text-secondary)" />
    </div>
  );
}

function Row({ label, value, color, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 'var(--fw-medium)' : 'normal', color }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

export default function MaintenanceCostTrend({ costTrend }) {
  if (!costTrend?.length) return null;

  const latest     = costTrend[costTrend.length - 1];
  const totalEight = costTrend.reduce((s, w) => s + (w.total_usd ?? 0), 0);

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
            Maintenance cost · 8-week trend
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
            <span style={{
              fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-black)',
              color: 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtUSD(latest?.total_usd)}
            </span>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              this week · 8-week total {fmtUSD(totalEight)}
            </span>
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: '2px 6px',
          background: 'var(--surface)', border: '1px solid var(--border-hairline)',
          borderRadius: 3, color: 'var(--text-tertiary)',
        }}>MODELLED</span>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={costTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradWorkshop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--bauxite-rust)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--bauxite-rust)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gradParts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--signal-amber)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--signal-amber)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={weekLabel}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="workshop_usd"
            stackId="cost"
            stroke="var(--bauxite-rust)"
            strokeWidth={1.5}
            fill="url(#gradWorkshop)"
            name="Workshop"
          />
          <Area
            type="monotone"
            dataKey="parts_usd"
            stackId="cost"
            stroke="var(--signal-amber)"
            strokeWidth={1.5}
            fill="url(#gradParts)"
            name="Parts"
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center', marginTop: 'var(--space-2)', fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
        <LegendDot color="var(--bauxite-rust)" label="Workshop" />
        <LegendDot color="var(--signal-amber)" label="Parts" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </div>
  );
}
