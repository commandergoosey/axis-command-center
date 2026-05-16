/*
 * ComponentShareChart — Phase 196.
 * Stacked area chart showing how each tariff component's *share* of the
 * effective rate has shifted over the historical window. Unlike
 * IndexationBreakdownChart which shows absolute USD per tonne, this view
 * normalises each month to 100% so shifts in exposure are immediately visible
 * — e.g. rising fuel share means the corridor is becoming more diesel-exposed.
 *
 * Data: component_history[] from GET /api/tariff.
 * Each entry: { month, fuel_usd, cpi_usd, fixed_usd, effective_usd_per_tonne }
 * Derived client-side: fuel%, cpi%, fixed% as share of effective rate.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const C_FUEL  = 'var(--bauxite-rust)';
const C_CPI   = 'var(--signal-amber)';
const C_FIXED = 'rgba(59,130,246,0.85)';

function shortMonth(m) {
  // "2025-11" → "Nov"
  const [y, mo] = m.split('-');
  return new Date(Date.UTC(+y, +mo - 1, 1))
    .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const fuel  = payload.find((p) => p.dataKey === 'fuel_pct')?.value;
  const cpi   = payload.find((p) => p.dataKey === 'cpi_pct')?.value;
  const fixed = payload.find((p) => p.dataKey === 'fixed_pct')?.value;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      minWidth: 160,
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        {shortMonth(label)} {label.slice(0, 4)}
      </div>
      {fuel  != null && <Row label="Fuel"  value={`${fuel}%`}  color={C_FUEL} />}
      {cpi   != null && <Row label="CPI"   value={`${cpi}%`}   color={C_CPI} />}
      {fixed != null && <Row label="Fixed" value={`${fixed}%`} color={C_FIXED} />}
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

export default function ComponentShareChart({ componentHistory }) {
  if (!componentHistory?.length) return null;

  // Derive percentage shares from absolute USD breakdown.
  const chartData = componentHistory.map((h) => {
    const total = (h.fuel_usd ?? 0) + (h.cpi_usd ?? 0) + (h.fixed_usd ?? 0);
    const fuel_pct  = total > 0 ? Math.round((h.fuel_usd  / total) * 100) : 0;
    const cpi_pct   = total > 0 ? Math.round((h.cpi_usd   / total) * 100) : 0;
    const fixed_pct = 100 - fuel_pct - cpi_pct;
    return { month: h.month, fuel_pct, cpi_pct, fixed_pct };
  });

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
        <span className="eyebrow">Component share of effective rate</span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          Fuel · CPI · Fixed — stacked to 100%
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            stackOffset="expand"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonth}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              domain={[0, 1]}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="fixed_pct"
              stackId="1"
              stroke={C_FIXED}
              fill={C_FIXED}
              fillOpacity={0.7}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="cpi_pct"
              stackId="1"
              stroke={C_CPI}
              fill={C_CPI}
              fillOpacity={0.75}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="fuel_pct"
              stackId="1"
              stroke={C_FUEL}
              fill={C_FUEL}
              fillOpacity={0.8}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-4)',
          marginTop: 'var(--space-2)',
          flexWrap: 'wrap',
        }}>
          {[
            { color: C_FUEL,  label: 'Fuel (NPA diesel · 40% contract weight)' },
            { color: C_CPI,   label: 'CPI (Ghana GSS · 30%)' },
            { color: C_FIXED, label: 'Fixed USD component (30%)' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.85 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
