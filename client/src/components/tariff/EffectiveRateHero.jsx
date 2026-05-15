/*
 * EffectiveRateHero — Charcoal panel showing the base rate, effective rate,
 * and adjustment since contract start. Effective rate is the number GIBDLC
 * pays per tonne delivered this month.
 */

import ModelledTag from '../primitives/ModelledTag';

export default function EffectiveRateHero({ data }) {
  if (!data) return null;
  const { base, effective_rate_usd_per_tonne, adjustment_pct } = data;
  const adjustmentColor = adjustment_pct >= 0 ? 'var(--bauxite-rust)' : 'var(--signal-green)';

  return (
    <section style={{
      background: 'var(--charcoal)',
      color: 'var(--bone)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-6)',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 'var(--space-4)',
    }}>
      <Stat
        label="Base tariff"
        value={`$${base.rate_usd_per_tonne.toFixed(2)}`}
        unit="/ tonne"
        sub={`$${base.rate_usd_per_tonne_km.toFixed(2)} per t·km · ${base.corridor_km} km corridor`}
      />
      <Divider />
      <Stat
        label="Effective tariff"
        value={`$${effective_rate_usd_per_tonne.toFixed(2)}`}
        unit="/ tonne"
        sub="Current month, billed to GIBDLC"
        highlight
      />
      <Divider />
      <Stat
        label="Adjustment vs base"
        value={`${adjustment_pct >= 0 ? '+' : ''}${adjustment_pct.toFixed(2)}%`}
        sub="Fuel + CPI + fixed blend"
        valueColor={adjustmentColor}
      />
    </section>
  );
}

function Stat({ label, value, unit, sub, valueColor, highlight }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'rgba(245, 241, 236, 0.55)',
      }}>
        <span>{label}</span>
        <ModelledTag tone="dark" />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          className="tabular"
          style={{
            fontFamily: 'var(--font-primary)',
            fontWeight: 'var(--fw-black)',
            fontSize: highlight ? 'var(--ts-display-size)' : 'var(--ts-h1-size)',
            lineHeight: 1,
            color: valueColor ?? (highlight ? 'var(--bauxite-rust)' : 'var(--bone)'),
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="mono" style={{
            fontSize: 14,
            opacity: 0.55,
            color: 'var(--bone)',
            letterSpacing: '0.02em',
          }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'rgba(245, 241, 236, 0.55)',
          lineHeight: 1.4,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, background: 'rgba(245, 241, 236, 0.08)' }} aria-hidden />;
}
