/*
 * Phase 186 — Diesel tariff sensitivity scenarios.
 * Diverging horizontal BarChart showing modelled EBITDA impact
 * at diesel price moves of ±5%, ±10%, ±15%. Uses sensitivity_scenarios
 * from /api/diesel. MODELLED (§12.4).
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';

function fmtDelta(v) {
  if (v === 0) return '—';
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : '−';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toLocaleString()}`;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const positive = (d.delta_ebitda_usd ?? 0) >= 0;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 190,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
        {d.label} diesel scenario
      </div>
      <Row label="Fuel Δ/tonne"   value={`${d.delta_fuel_usd_per_tonne > 0 ? '+' : ''}$${d.delta_fuel_usd_per_tonne}/t`} />
      <Row label="EBITDA impact"  value={fmtDelta(d.delta_ebitda_usd)} color={positive ? 'var(--signal-green)' : 'var(--bauxite-rust)'} />
      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Modelled (§12.4)
      </div>
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: color ?? 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

export default function TariffSensitivityChart({ sensitivityScenarios }) {
  if (!sensitivityScenarios?.length) return null;

  // Center domain symmetrically.
  const maxAbs = Math.max(...sensitivityScenarios.map((s) => Math.abs(s.delta_ebitda_usd ?? 0)), 1);
  const domain = [-(maxAbs * 1.1), maxAbs * 1.1];

  const baseScenario = sensitivityScenarios.find((s) => s.is_base);

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Diesel price sensitivity — EBITDA impact
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Monthly EBITDA Δ for ±5/10/15% diesel moves · fuel ≈ 44% of operating cost
          </div>
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--signal-amber)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontWeight: 'var(--fw-medium)',
          padding: '2px 8px',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 3,
          background: 'rgba(245,158,11,0.06)',
        }}>
          Modelled (§12.4)
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={sensitivityScenarios}
          layout="vertical"
          margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={domain}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v === 0 ? '$0' : `${v > 0 ? '+' : ''}$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine x={0} stroke="var(--text-tertiary)" strokeWidth={1.5} />
          <Bar dataKey="delta_ebitda_usd" barSize={18} radius={[0, 3, 3, 0]}>
            {sensitivityScenarios.map((s) => (
              <Cell
                key={s.pct_change}
                fill={s.is_base ? 'var(--text-tertiary)'
                    : (s.delta_ebitda_usd ?? 0) >= 0 ? 'var(--signal-green)'
                    : 'var(--bauxite-rust)'}
                fillOpacity={s.is_base ? 0.4 : 0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', textAlign: 'right' }}>
        Green = lower diesel → higher EBITDA · Rust = higher diesel → lower EBITDA
      </div>
    </div>
  );
}
