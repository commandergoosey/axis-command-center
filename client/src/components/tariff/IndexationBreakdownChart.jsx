/*
 * IndexationBreakdownChart — Phase 152.
 * Stacked bar chart decomposing the effective tariff into its three
 * indexation components (fuel / CPI / fixed) for each month in the
 * history. Shows which driver has been moving the tariff — and by
 * how much — month over month.
 *
 * Legend colours:
 *   Fuel (NPA diesel) — bauxite-rust  (40% weight, most volatile)
 *   CPI (GSS)        — signal-amber  (30% weight)
 *   Fixed USD        — text-secondary (30% weight, always stable)
 *
 * Props:
 *   componentHistory — component_history from /api/tariff
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const COLOR_FUEL  = 'var(--bauxite-rust)';
const COLOR_CPI   = 'var(--signal-amber)';
const COLOR_FIXED = 'var(--text-secondary)';

function monthLabel(iso) {
  const d   = new Date(iso + '-01T00:00:00Z');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${mon} ${String(d.getUTCFullYear()).slice(2)}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const fuel  = payload.find((p) => p.dataKey === 'fuel_usd');
  const cpi   = payload.find((p) => p.dataKey === 'cpi_usd');
  const fixed = payload.find((p) => p.dataKey === 'fixed_usd');
  const total = (fuel?.value ?? 0) + (cpi?.value ?? 0) + (fixed?.value ?? 0);
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     130,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6 }}>
        {monthLabel(label)}
      </div>
      {[
        { label: 'Fuel (NPA)',  value: fuel?.value,  color: COLOR_FUEL  },
        { label: 'CPI (GSS)',   value: cpi?.value,   color: COLOR_CPI   },
        { label: 'Fixed',       value: fixed?.value, color: COLOR_FIXED },
      ].map((row) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: row.color }}>{row.label}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>
            ${(row.value ?? 0).toFixed(2)}/t
          </span>
        </div>
      ))}
      <div style={{
        borderTop:  '1px solid var(--border-hairline)',
        marginTop:  4,
        paddingTop: 4,
        display:    'flex',
        justifyContent: 'space-between',
        gap: 12,
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
      }}>
        <span>Effective</span>
        <span className="tabular">${total.toFixed(2)}/t</span>
      </div>
    </div>
  );
}

export default function IndexationBreakdownChart({ componentHistory }) {
  if (!componentHistory || componentHistory.length === 0) return null;

  // Last 12 months for readability
  const data = componentHistory.slice(-12);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Tariff component breakdown · monthly</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          effective $/t decomposed by indexation driver
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-hairline)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="fuel_usd"  stackId="comp" fill={COLOR_FUEL}  fillOpacity={0.80} name="Fuel (NPA)" />
            <Bar dataKey="cpi_usd"   stackId="comp" fill={COLOR_CPI}   fillOpacity={0.80} name="CPI (GSS)" />
            <Bar dataKey="fixed_usd" stackId="comp" fill={COLOR_FIXED} fillOpacity={0.55} name="Fixed" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display:    'flex',
          gap:        'var(--space-4)',
          marginTop:  8,
          paddingTop: 8,
          borderTop:  '1px solid var(--border-hairline)',
          fontSize:   'var(--ts-caption-size)',
          color:      'var(--text-tertiary)',
          flexWrap:   'wrap',
        }}>
          <span><span style={{ color: COLOR_FUEL  }}>■</span> Fuel 40%</span>
          <span><span style={{ color: COLOR_CPI   }}>■</span> CPI 30%</span>
          <span><span style={{ color: COLOR_FIXED }}>■</span> Fixed 30%</span>
        </div>
      </div>
    </section>
  );
}
