/*
 * OperatingCostByHaulerChart — Phase 232.
 * Horizontal bar chart of total trip operating costs by hauler.
 * Pairs with the HaulerRevenueStrip (which shows revenue) to give a
 * margin-side view: the highest-revenue hauler isn't necessarily the
 * most cost-efficient one. Sorted highest cost first.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

function fmtUsd(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>{d.display_name}</div>
      <div style={{ color: 'var(--text-secondary)' }}>
        Total cost: <strong>{fmtUsd(d.cost_usd)}</strong>
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        {d.share_pct}% of corridor cost · {d.trips} trips
      </div>
    </div>
  );
};

// Assign an accent colour per hauler rank — the highest-cost hauler
// gets rust, the rest amber/green descending.
function barColor(idx, total) {
  if (idx === 0)                  return 'var(--bauxite-rust)';
  if (idx <= Math.floor(total / 3)) return 'var(--signal-amber)';
  return 'var(--signal-green)';
}

export default function OperatingCostByHaulerChart({ operatingCostByHauler }) {
  if (!operatingCostByHauler?.length) return null;

  const total = operatingCostByHauler.reduce((s, h) => s + h.cost_usd, 0);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <header style={{
        marginBottom: 'var(--space-3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            Operating cost by hauler
          </span>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            Total trip cost (fuel + driver + maintenance + tolls) per hauler.
            Cross-reference with revenue share to assess per-hauler margin contribution.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 2 }}>TOTAL</div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: 'var(--text)',
          }}>
            {fmtUsd(total)}
          </div>
        </div>
      </header>

      <ResponsiveContainer width="100%" height={operatingCostByHauler.length * 44 + 24}>
        <BarChart
          data={operatingCostByHauler}
          layout="vertical"
          margin={{ top: 4, right: 64, bottom: 4, left: 4 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tickFormatter={fmtUsd}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="display_name"
            width={120}
            tick={{ fontSize: 12, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="cost_usd" radius={[0, 3, 3, 0]} maxBarSize={22} label={{
            position: 'right',
            formatter: (v) => fmtUsd(v),
            fontSize: 11,
            fill: 'var(--text-secondary)',
          }}>
            {operatingCostByHauler.map((entry, idx) => (
              <Cell
                key={entry.hauler_id}
                fill={barColor(idx, operatingCostByHauler.length)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
