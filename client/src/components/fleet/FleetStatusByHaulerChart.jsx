/*
 * Phase 218 — FleetStatusByHaulerChart
 * Stacked horizontal BarChart showing each hauler's fleet split across
 * operational status: active (green) / idle (amber) / garage (rust).
 * Reads from the existing `availability_by_hauler` field — no server change.
 * Sorted by total fleet size descending so the largest haulers lead.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';

function shortName(display) {
  return display?.replace(/\s+(Haulage|Transport|Logistics|Ltd\.?|Limited)$/i, '') ?? display;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6, color: 'var(--text)' }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          color: 'var(--text-secondary)', marginBottom: 2,
        }}>
          <span>{p.name}</span>
          <span className="mono">{p.value} trucks</span>
        </div>
      ))}
      <div style={{
        borderTop: '1px solid var(--border-hairline)', marginTop: 6, paddingTop: 6,
        display: 'flex', justifyContent: 'space-between', gap: 16,
        fontWeight: 'var(--fw-medium)', color: 'var(--text)',
      }}>
        <span>Total</span>
        <span className="mono">{total} trucks</span>
      </div>
    </div>
  );
};

export default function FleetStatusByHaulerChart({ availabilityByHauler }) {
  if (!availabilityByHauler?.length) return null;

  // Sort largest fleet first; trim display name for axis labels.
  const data = [...availabilityByHauler]
    .sort((a, b) => b.total - a.total)
    .map((h) => ({
      ...h,
      name: shortName(h.display_name),
    }));

  const totalActive = data.reduce((s, h) => s + (h.active ?? 0), 0);
  const totalAll    = data.reduce((s, h) => s + (h.total  ?? 0), 0);
  const utilPct     = totalAll > 0 ? Math.round((totalActive / totalAll) * 100) : 0;

  const axisTick = {
    fontSize: 'var(--ts-caption-size)',
    fill: 'var(--text-tertiary)',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
            marginBottom: 2,
          }}>
            Fleet status by hauler
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Active · idle · in garage · current counts
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: utilPct >= 70 ? 'var(--signal-green)' : utilPct >= 50 ? 'var(--signal-amber)' : 'var(--bauxite-rust)',
            lineHeight: 1,
          }}>
            {utilPct}%
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            fleet active
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 48)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
          barSize={20}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            label={null}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={axisTick}
            width={100}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}
          />
          <Bar dataKey="active" name="Active"  stackId="a" fill="var(--signal-green)"  radius={0} />
          <Bar dataKey="idle"   name="Idle"    stackId="a" fill="var(--signal-amber)"  radius={0} />
          <Bar dataKey="garage" name="Garage"  stackId="a" fill="var(--bauxite-rust)"  radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
