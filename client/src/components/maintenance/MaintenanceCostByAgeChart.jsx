/*
 * Phase 204 — Maintenance cost breakdown by vehicle age bracket.
 * Grouped bar: workshop vs parts cost, per age cohort.
 * Older cohorts reveal the rising cost of ageing fleet composition.
 * All values MODELLED (seeded from fleet roster).
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';

const MODELLED = (
  <span style={{
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--signal-amber)',
    background: 'rgba(217,158,45,0.12)',
    borderRadius: 3,
    padding: '1px 5px',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function fmtUsd(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const workshop = payload.find((p) => p.dataKey === 'workshop_usd');
  const parts    = payload.find((p) => p.dataKey === 'parts_usd');
  const total    = (workshop?.value ?? 0) + (parts?.value ?? 0);
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>{label}</div>
      {workshop && (
        <div style={{ color: 'var(--bauxite-rust)' }}>
          Workshop: {fmtUsd(workshop.value)}
        </div>
      )}
      {parts && (
        <div style={{ color: 'var(--signal-amber)' }}>
          Parts: {fmtUsd(parts.value)}
        </div>
      )}
      <div style={{
        borderTop: '1px solid var(--border-hairline)',
        marginTop: 6,
        paddingTop: 6,
        fontWeight: 'var(--fw-semibold)',
      }}>
        Total: {fmtUsd(total)}
      </div>
    </div>
  );
}

export default function MaintenanceCostByAgeChart({ costByAge }) {
  if (!costByAge?.length) return null;

  // Annotate each bracket with avg_per_rig for the sub-label.
  const data = costByAge.map((b) => ({
    ...b,
    label: `${b.label}\n(${b.count} rig${b.count !== 1 ? 's' : ''})`,
  }));

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 4,
        }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
          }}>
            Maintenance cost by vehicle age
          </span>
          {MODELLED}
        </div>
        <p style={{
          margin: 0,
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
        }}>
          Workshop labour + parts cost grouped by manufacture year cohort.
          Avg per rig shown below each bracket.
        </p>
      </div>

      {/* Avg per rig tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${costByAge.length}, minmax(0, 1fr))`,
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}>
        {costByAge.map((b) => (
          <div key={b.key} style={{
            background: 'var(--surface-page)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 'var(--ts-micro-size)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}>
              {b.label} · {b.count} rig{b.count !== 1 ? 's' : ''}
            </div>
            <div style={{
              fontVariantNumeric: 'tabular-nums lining-nums',
              fontWeight: 'var(--fw-semibold)',
              color: 'var(--text)',
            }}>
              {fmtUsd(b.avg_per_rig_usd)}<span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 11 }}>/rig</span>
            </div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => fmtUsd(v)}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconSize={8}
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
          <Bar dataKey="workshop_usd" name="Workshop" stackId="a" fill="var(--bauxite-rust)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="parts_usd"    name="Parts"    stackId="a" fill="var(--signal-amber)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
