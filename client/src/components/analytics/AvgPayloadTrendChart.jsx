/*
 * Phase 210 — Average payload per southbound trip, 12-week trend.
 * AreaChart with rated-capacity ReferenceLine at 40 t.
 * Utilisation % shown in tooltip; WoW delta in header.
 * Real fleet telemetry — not modelled.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 4 }}>w/c {label}</div>
      <div>Avg payload: <strong>{d.avg_payload_t} t</strong></div>
      <div style={{ color: d.utilisation_pct >= 90 ? 'var(--signal-green)' : d.utilisation_pct >= 75 ? 'var(--signal-amber)' : 'var(--bauxite-rust)' }}>
        Utilisation: {d.utilisation_pct}%
      </div>
      <div style={{ color: 'var(--text-tertiary)' }}>{d.trip_count} trips this week</div>
    </div>
  );
}

export default function AvgPayloadTrendChart({ avgPayloadTrend }) {
  if (!avgPayloadTrend?.length) return null;

  const data = avgPayloadTrend.map((w) => ({
    ...w,
    week: fmtDate(w.week_of),
  }));

  const latest   = avgPayloadTrend[avgPayloadTrend.length - 1];
  const prev     = avgPayloadTrend[avgPayloadTrend.length - 2];
  const delta    = prev ? Number((latest.avg_payload_t - prev.avg_payload_t).toFixed(1)) : null;
  const rated    = latest?.rated_payload_t ?? 40;

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
            Avg payload per trip — 12 weeks
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            Southbound trips only. Rated capacity {rated} t per trip (40-tonne 6×4 tipper, LI 2180).
          </p>
          <div style={{ flexShrink: 0 }}>
            <span style={{
              fontVariantNumeric: 'tabular-nums lining-nums',
              fontWeight: 'var(--fw-semibold)',
              color: latest.utilisation_pct >= 90 ? 'var(--signal-green)'
                   : latest.utilisation_pct >= 75 ? 'var(--signal-amber)'
                   : 'var(--bauxite-rust)',
            }}>
              {latest.avg_payload_t} t
            </span>
            {delta != null && (
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                color: delta >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)',
              }}>
                {delta >= 0 ? '+' : ''}{delta} t WoW
              </span>
            )}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -4, bottom: 4 }}>
          <defs>
            <linearGradient id="payloadGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--bauxite-rust)" stopOpacity={0.18} />
              <stop offset="95%" stopColor="var(--bauxite-rust)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[30, Math.max(rated + 2, ...data.map((d) => d.avg_payload_t)) + 1]}
            tickFormatter={(v) => `${v}t`}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={rated}
            stroke="var(--signal-green)"
            strokeDasharray="4 3"
            label={{
              value: `Rated ${rated}t`,
              position: 'insideTopRight',
              fill: 'var(--signal-green)',
              fontSize: 10,
            }}
          />
          <Area
            dataKey="avg_payload_t"
            name="Avg payload"
            type="monotone"
            stroke="var(--bauxite-rust)"
            strokeWidth={2}
            fill="url(#payloadGrad)"
            dot={{ r: 3, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
