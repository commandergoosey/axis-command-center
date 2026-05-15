/*
 * CashflowForecast — 90-day weekly buckets. Bar chart of net flow (positive
 * Bauxite Rust, negative Iron) with the closing-cash trend overlaid as a
 * line. Debt-service weeks are marked with a caption dot under the bar.
 */

import {
  ComposedChart, Bar, Cell, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import ModelledTag from '../primitives/ModelledTag';

export default function CashflowForecast({ weeks }) {
  if (!weeks?.length) return null;
  const data = weeks.map((w) => ({
    week: shortWeek(w.week),
    net: w.net_usd,
    cash: w.closing_cash_usd,
    note: w.note,
  }));

  const closingCash = weeks[weeks.length - 1].closing_cash_usd;
  const openingCash = weeks[0].closing_cash_usd - weeks[0].net_usd;
  const delta = closingCash - openingCash;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="eyebrow">90-day cashflow forecast</span>
            <ModelledTag />
          </div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Weekly bars show net flow; the line tracks closing cash balance. Debt-service weeks fall every four weeks.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h2-size)',
            lineHeight: 'var(--ts-h2-lh)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            ${(closingCash / 1_000_000).toFixed(2)}M
          </div>
          <div className="mono" style={{
            fontSize: 'var(--ts-caption-size)',
            color: delta >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)',
            letterSpacing: '0.04em',
          }}>
            {delta >= 0 ? '+' : '−'}${Math.abs(delta / 1_000_000).toFixed(2)}M over window
          </div>
        </div>
      </header>

      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="week"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-hairline)' }}
              interval={0}
            />
            <YAxis
              yAxisId="net"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
            />
            <YAxis
              yAxisId="cash"
              orientation="right"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
              }}
              formatter={(v, name) => [`$${(v / 1000).toFixed(0)}k`, name === 'net' ? 'Net flow' : 'Closing cash']}
            />
            <Bar yAxisId="net" dataKey="net" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.net >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)'}
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
            <Line
              yAxisId="cash"
              type="monotone"
              dataKey="cash"
              stroke="var(--charcoal)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: 'var(--charcoal)', strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function shortWeek(iso) {
  const match = /W(\d+)/.exec(iso);
  return match ? `W${match[1]}` : iso;
}
