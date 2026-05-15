/*
 * DieselPriceTrend — Phase 159.
 * 12-week dual-axis chart: NPA diesel price (GHS/litre, left) with the
 * modelled corridor burn cost (USD/tonne, right) overlaid as a line.
 * Lets ops correlate pump-price movements with their operating cost per tonne.
 *
 * Props:
 *   priceHistory — price_history array from /api/diesel
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

function weekLabel(iso) {
  const d   = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${day} ${mon}`;
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
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6 }}>
        Week of {weekLabel(label)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
        <span style={{ color: 'var(--signal-amber)' }}>NPA price</span>
        <span className="tabular" style={{ color: 'var(--text)' }}>GHS {row.price_ghs_per_litre?.toFixed(2)}/L</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--bauxite-rust)' }}>Burn cost</span>
        <span className="tabular" style={{ color: 'var(--text)' }}>${row.burn_usd_per_tonne?.toFixed(2)}/t</span>
      </div>
    </div>
  );
}

export default function DieselPriceTrend({ priceHistory }) {
  if (!priceHistory || priceHistory.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Diesel price trend</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          12-week NPA pump price (GHS/L) · burn cost ($/t, right axis) · seeded
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={priceHistory} margin={{ top: 4, right: 44, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="week_of"
              tickFormatter={weekLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              interval={1}
            />
            {/* Left — GHS/litre */}
            <YAxis
              yAxisId="ghs"
              domain={['auto', 'auto']}
              tickFormatter={(v) => `GHS ${v.toFixed(1)}`}
              tick={{ fontSize: 9, fill: 'var(--signal-amber)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              width={68}
            />
            {/* Right — USD/tonne */}
            <YAxis
              yAxisId="usd"
              orientation="right"
              domain={['auto', 'auto']}
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              tick={{ fontSize: 9, fill: 'var(--bauxite-rust)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            {/* NPA price — amber bars */}
            <Bar
              yAxisId="ghs"
              dataKey="price_ghs_per_litre"
              name="NPA price"
              fill="var(--signal-amber)"
              fillOpacity={0.55}
              radius={[2, 2, 0, 0]}
            />
            {/* Burn cost — rust line overlay */}
            <Line
              yAxisId="usd"
              type="monotone"
              dataKey="burn_usd_per_tonne"
              name="Burn cost"
              stroke="var(--bauxite-rust)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legend + footnote */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span><span style={{ color: 'var(--signal-amber)' }}>■</span> NPA pump price (GHS/L)</span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--bauxite-rust)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Burn cost ($/t)
          </span>
          <span style={{ marginLeft: 'auto' }}>Prices seeded · §12.4</span>
        </div>
      </div>
    </section>
  );
}
