/*
 * Phase 172 — 4-week corridor throughput forecast.
 * ComposedChart: shaded area between conservative and optimistic bounds,
 * base trend line, MODELLED tag on every data point.
 */

import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function weekLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function fmtTonnes(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} Mt`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)} kt`;
  return `${v} t`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const base  = payload.find((p) => p.dataKey === 'base_tonnes');
  const opt   = payload.find((p) => p.dataKey === 'optimistic_tonnes');
  const cons  = payload.find((p) => p.dataKey === 'conservative_tonnes');

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
        <span style={{
          marginLeft: 6,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          fontWeight: 'normal',
        }}>MODELLED</span>
      </div>
      {opt && (
        <Row label="Optimistic" value={fmtTonnes(opt.value)} color="var(--signal-green)" />
      )}
      {base && (
        <Row label="Base"       value={fmtTonnes(base.value)} color="var(--bauxite-rust)" />
      )}
      {cons && (
        <Row label="Conservative" value={fmtTonnes(cons.value)} color="var(--text-secondary)" />
      )}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color }}>
        {value}
      </span>
    </div>
  );
}

export default function ThroughputForecast({ throughputForecast }) {
  if (!throughputForecast?.length) return null;

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
            Throughput forecast · next 4 weeks
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Base / optimistic / conservative · weekly tonnes · Nyinahin–Takoradi
          </div>
        </div>
        <span style={{
          fontSize: 10,
          padding: '2px 6px',
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 3,
          color: 'var(--text-tertiary)',
        }}>
          MODELLED
        </span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={throughputForecast} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradForecastBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="rgba(59,130,246,0.18)" />
              <stop offset="100%" stopColor="rgba(59,130,246,0.04)" />
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
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Shaded optimistic–conservative band */}
          <Area
            dataKey="optimistic_tonnes"
            stroke="transparent"
            fill="url(#gradForecastBand)"
            legendType="none"
            activeDot={false}
          />
          <Area
            dataKey="conservative_tonnes"
            stroke="transparent"
            fill="var(--surface)"
            legendType="none"
            activeDot={false}
          />

          {/* Scenario lines */}
          <Line
            dataKey="optimistic_tonnes"
            stroke="var(--signal-green)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            name="Optimistic"
          />
          <Line
            dataKey="base_tonnes"
            stroke="var(--bauxite-rust)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
            name="Base"
          />
          <Line
            dataKey="conservative_tonnes"
            stroke="var(--text-tertiary)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            name="Conservative"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend row */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-4)',
        justifyContent: 'center',
        marginTop: 'var(--space-2)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-secondary)',
      }}>
        <LegendItem color="var(--signal-green)"  dash label="Optimistic" />
        <LegendItem color="var(--bauxite-rust)"         label="Base" />
        <LegendItem color="var(--text-tertiary)" dash label="Conservative" />
      </div>
    </div>
  );
}

function LegendItem({ color, dash, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <svg width={24} height={4}>
        <line
          x1="0" y1="2" x2="24" y2="2"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dash ? '5 3' : undefined}
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}
