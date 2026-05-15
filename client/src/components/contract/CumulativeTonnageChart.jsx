/*
 * CumulativeTonnageChart — 12-month monthly delivery view with the
 * take-or-pay floor as a dashed reference line. Partial current month
 * renders at reduced opacity so it's clearly a work-in-progress bar.
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import ModelledTag from '../primitives/ModelledTag';

export default function CumulativeTonnageChart({ history }) {
  if (!history?.length) return null;

  const data = history.map((r) => ({
    month:     formatMonth(r.month),
    delivered: r.delivered,
    floor:     r.floor,
    contracted: r.contracted,
    partial:   Boolean(r.partial),
  }));

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="eyebrow">Monthly tonnage vs floor</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Delivered tonnage per month · dashed line is the 80% take-or-pay floor
          </div>
        </div>
        <ModelledTag />
      </header>

      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-hairline)' }}
            />
            <YAxis
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
              }}
              formatter={(value, name) => [`${Number(value).toLocaleString()} t`, labelOf(name)]}
            />
            <Bar dataKey="delivered" fill="var(--charcoal)" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.partial ? 'var(--bauxite-rust)' : 'var(--charcoal)'} fillOpacity={d.partial ? 0.55 : 1} />
              ))}
            </Bar>
            <Line
              type="stepAfter"
              dataKey="floor"
              stroke="var(--bauxite-rust)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function labelOf(k) {
  if (k === 'delivered')  return 'Delivered';
  if (k === 'floor')      return 'Floor (80%)';
  if (k === 'contracted') return 'Contracted';
  return k;
}

function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}
