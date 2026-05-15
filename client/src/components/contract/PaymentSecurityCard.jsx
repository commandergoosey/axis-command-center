/*
 * PaymentSecurityCard — SBLC + receivables posture.
 * Shows the SBLC face value and days-to-expiry (tints amber inside 90 days,
 * Bauxite Rust inside 30 days), then a compact ageing bar for receivables.
 */

const AGEING_BANDS = [
  { key: 'band_0_30',  label: '0–30',   color: 'var(--charcoal)' },
  { key: 'band_31_60', label: '31–60',  color: 'var(--iron)' },
  { key: 'band_61_90', label: '61–90',  color: 'var(--signal-amber)' },
  { key: 'band_90p',   label: '90+',    color: 'var(--bauxite-rust)' },
];

export default function PaymentSecurityCard({ paymentSecurity }) {
  if (!paymentSecurity) return null;
  const { sblc, receivables } = paymentSecurity;

  const expiryTone = sblc.days_to_expiry <= 30
    ? 'var(--bauxite-rust)'
    : sblc.days_to_expiry <= 90
      ? 'var(--signal-amber)'
      : 'var(--text)';

  const bandTotal = AGEING_BANDS.reduce((s, b) => s + (receivables.ageing[b.key] || 0), 0);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
    }}>
      <header>
        <div className="eyebrow">Payment security</div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
          Standby letter of credit and receivables posture.
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Tile
          eyebrow="SBLC face value"
          value={`$${(sblc.face_value_usd / 1_000_000).toFixed(1)}M`}
          footnote={`${sblc.issuer} · covers ${sblc.coverage_months.toFixed(1)} months`}
        />
        <Tile
          eyebrow="SBLC expiry"
          value={`${sblc.days_to_expiry} days`}
          valueColor={expiryTone}
          footnote={new Date(sblc.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
        />
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="eyebrow">Receivables ageing</span>
          <span className="tabular" style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
            ${Math.round(receivables.current_balance_usd / 1000).toLocaleString()}k outstanding · {receivables.overdue_pct}% overdue
          </span>
        </div>
        <div style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden', background: 'var(--surface-sunk)' }}>
          {AGEING_BANDS.map((b) => {
            const value = receivables.ageing[b.key] || 0;
            if (value <= 0) return null;
            return (
              <div
                key={b.key}
                style={{
                  flex: value,
                  background: b.color,
                }}
                title={`${b.label}: $${Math.round(value).toLocaleString()}`}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          {AGEING_BANDS.map((b) => {
            const value = receivables.ageing[b.key] || 0;
            const pct = bandTotal > 0 ? (value / bandTotal) * 100 : 0;
            return (
              <span key={b.key} style={{
                display: 'inline-flex',
                flexDirection: 'column',
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: b.color, display: 'inline-block' }} />
                  {b.label}
                </span>
                <span className="mono" style={{ color: 'var(--text)', marginTop: 2 }}>
                  {pct.toFixed(0)}%
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Tile({ eyebrow, value, valueColor, footnote }) {
  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'var(--surface-sunk)',
      borderRadius: 'var(--radius-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>{eyebrow}</div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-stat-size)',
        lineHeight: 'var(--ts-stat-lh)',
        color: valueColor ?? 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
        {footnote}
      </div>
    </div>
  );
}
