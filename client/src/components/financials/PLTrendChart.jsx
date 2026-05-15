/*
 * PLTrendChart — Phase 156.
 * Monthly P&L trend (Nov 2025 – current MTD) as a grouped bar chart.
 * Revenue (green outline) and operating costs (rust fill) as grouped
 * bars; EBITDA as an overlay line on the right axis.
 *
 * Months marked modelled: true carry a §12.4 MODELLED label.
 * The current MTD entry is marked partial: true and rendered with
 * reduced opacity to signal the period isn't closed.
 *
 * Props:
 *   pnlTrend — pnl_trend array from /api/financials
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

function monthLabel(iso) {
  // "2026-04" → "Apr '26"
  const [yr, mo] = iso.split('-');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1];
  return `${mon} '${yr.slice(2)}`;
}

function fmtUSD(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)    return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {monthLabel(label)}
        {row.partial && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(217,158,55,0.15)', color: 'var(--signal-amber)',
            borderRadius: 3, padding: '1px 5px',
          }}>MTD</span>
        )}
        {row.modelled && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(0,0,0,0.06)', color: 'var(--text-tertiary)',
            borderRadius: 3, padding: '1px 5px',
          }}>MODELLED</span>
        )}
      </div>
      {[
        { label: 'Revenue',        value: row.revenue_usd,          color: 'var(--signal-green)'  },
        { label: 'Operating costs', value: row.operating_costs_usd, color: 'var(--bauxite-rust)'  },
        { label: 'EBITDA',         value: row.ebitda_usd,           color: 'rgba(59,130,246,0.9)' },
      ].map(({ label: l, value, color }) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color }}>{l}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{fmtUSD(value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function PLTrendChart({ pnlTrend }) {
  if (!pnlTrend || pnlTrend.length === 0) return null;

  const hasModelled = pnlTrend.some((r) => r.modelled);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Monthly P&amp;L trend</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Nov 2025 – current MTD · EBITDA line (right axis)
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={pnlTrend} margin={{ top: 4, right: 40, left: -8, bottom: 0 }} barCategoryGap="24%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            {/* Left axis — USD */}
            <YAxis
              yAxisId="usd"
              tickFormatter={(v) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            {/* Right axis — EBITDA */}
            <YAxis
              yAxisId="ebitda"
              orientation="right"
              tickFormatter={(v) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
              tick={{ fontSize: 9, fill: 'rgba(59,130,246,0.8)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            {/* Revenue — green, semi-transparent for modelled months */}
            <Bar
              yAxisId="usd"
              dataKey="revenue_usd"
              name="Revenue"
              fill="var(--signal-green)"
              fillOpacity={0.18}
              stroke="var(--signal-green)"
              strokeWidth={1.5}
              radius={[2, 2, 0, 0]}
            />
            {/* Costs — rust, full fill */}
            <Bar
              yAxisId="usd"
              dataKey="operating_costs_usd"
              name="Operating costs"
              fill="var(--bauxite-rust)"
              fillOpacity={0.65}
              radius={[2, 2, 0, 0]}
            />
            {/* EBITDA — blue line overlay */}
            <Line
              yAxisId="ebitda"
              type="monotone"
              dataKey="ebitda_usd"
              name="EBITDA"
              stroke="rgba(59,130,246,0.9)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'rgba(59,130,246,0.9)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span><span style={{ color: 'var(--signal-green)' }}>■</span> Revenue</span>
          <span><span style={{ color: 'var(--bauxite-rust)' }}>■</span> Operating costs</span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'rgba(59,130,246,0.9)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            EBITDA
          </span>
          {hasModelled && (
            <span style={{ marginLeft: 'auto' }}>Prior months modelled · §12.4</span>
          )}
        </div>
      </div>
    </section>
  );
}
