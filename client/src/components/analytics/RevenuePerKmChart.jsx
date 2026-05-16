/*
 * RevenuePerKmChart — Phase 198.
 * Line chart showing weekly corridor revenue per kilometre over the last 12
 * weeks (southbound laden trips only). A reference line marks the expected
 * revenue/km from the base tariff so dips are immediately visible.
 *
 * Data: data.revenue_per_km[] from GET /api/analytics.
 * Each entry: { week_of, revenue_usd, revenue_per_km, modelled }
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

const MODELLED_BADGE = (
  <span style={{
    fontSize: 9,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(139,46,26,0.10)',
    color: 'var(--bauxite-rust)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    textTransform: 'uppercase',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

// Base tariff: $24/tonne at 300 km, ~12 laden trips/week at avg 22 t payload
// → approximate expected revenue/km per week from the schedule.
// We derive a reference from the series average so the line stays contextually
// meaningful regardless of actual run-rate.

function shortWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      minWidth: 180,
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        w/e {shortWeek(label)}
      </div>
      <Row label="Revenue/km"    value={`$${d.revenue_per_km?.toLocaleString()}`} color="var(--bauxite-rust)" />
      <Row label="Total revenue" value={`$${d.revenue_usd?.toLocaleString()}`}    color="var(--text)" />
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export default function RevenuePerKmChart({ revenuePerKm }) {
  if (!revenuePerKm?.length) return null;

  // Reference line: simple 12-week average
  const avg = Math.round(
    revenuePerKm.reduce((s, w) => s + (w.revenue_per_km ?? 0), 0) / revenuePerKm.length,
  );
  const latest = revenuePerKm[revenuePerKm.length - 1]?.revenue_per_km ?? 0;
  const delta  = revenuePerKm.length >= 2
    ? latest - revenuePerKm[revenuePerKm.length - 2].revenue_per_km
    : 0;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span className="eyebrow">Weekly revenue per corridor-km</span>
          {MODELLED_BADGE}
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="tabular" style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            ${latest.toLocaleString()}/km
          </span>
          {delta !== 0 && (
            <span style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: delta > 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)',
            }}>
              {delta > 0 ? '+' : ''}{delta.toLocaleString()} WoW
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={revenuePerKm}
            margin={{ top: 8, right: 24, bottom: 0, left: 12 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="week_of"
              tickFormatter={shortWeek}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              interval={1}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
              domain={['auto', 'auto']}
              width={56}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={avg}
              stroke="var(--signal-amber)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: '12w avg',
                position: 'right',
                fontSize: 9,
                fill: 'var(--signal-amber)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <Line
              type="monotone"
              dataKey="revenue_per_km"
              stroke="var(--bauxite-rust)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>

        <p style={{
          margin: 'var(--space-2) 0 0',
          fontSize: 10,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.02em',
        }}>
          Southbound laden trips only · 300 km Nyinahin–Takoradi corridor · data modelled
        </p>
      </div>
    </section>
  );
}
