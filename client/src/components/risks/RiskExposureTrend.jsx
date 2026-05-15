/*
 * Phase 170 — 8-week risk exposure score trend.
 * AreaChart showing the composite severity × likelihood exposure score
 * over time. Current week is live; prior weeks are MODELLED.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function weekLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

const ZONE_COLORS = {
  high:   'var(--bauxite-rust)',
  medium: 'var(--signal-amber)',
  low:    'var(--signal-green)',
};

function scoreZone(score) {
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
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
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>
        {weekLabel(label)}
        {d?.is_current && (
          <span style={{
            marginLeft: 6,
            padding: '1px 5px',
            background: 'var(--bauxite-rust)',
            borderRadius: 3,
            color: '#fff',
            fontSize: 10,
          }}>LIVE</span>
        )}
        {d?.modelled && !d?.is_current && (
          <span style={{
            marginLeft: 6,
            color: 'var(--text-tertiary)',
            fontSize: 10,
          }}>MODELLED</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Exposure score</span>
        <span style={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 'var(--fw-medium)',
          color: ZONE_COLORS[scoreZone(d?.score ?? 0)],
        }}>
          {d?.score ?? '—'}
        </span>
      </div>
    </div>
  );
}

export default function RiskExposureTrend({ exposureTrend }) {
  if (!exposureTrend?.length) return null;

  const latest = exposureTrend[exposureTrend.length - 1];
  const zone   = scoreZone(latest?.score ?? 0);
  const lineColor = ZONE_COLORS[zone];

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
            Risk exposure score · 8-week trend
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{
              fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-black)',
              color: lineColor,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {latest?.score ?? '—'}
            </span>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              / 100
            </span>
            <span style={{
              fontSize: 'var(--ts-caption-size)',
              color: lineColor,
              fontWeight: 'var(--fw-medium)',
              textTransform: 'uppercase',
            }}>
              {zone === 'high' ? 'Elevated' : zone === 'medium' ? 'Moderate' : 'Contained'}
            </span>
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
          MODELLED (prior weeks)
        </span>
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={exposureTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradExposure" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={lineColor} stopOpacity={0.18} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
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
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Zone reference lines */}
          <ReferenceLine y={60} stroke="var(--bauxite-rust)"  strokeDasharray="4 3" strokeOpacity={0.4} label={{ value: 'High', position: 'right', fontSize: 9, fill: 'var(--bauxite-rust)' }} />
          <ReferenceLine y={35} stroke="var(--signal-amber)"  strokeDasharray="4 3" strokeOpacity={0.4} label={{ value: 'Mod', position: 'right', fontSize: 9, fill: 'var(--signal-amber)' }} />
          <Area
            type="monotone"
            dataKey="score"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#gradExposure)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
