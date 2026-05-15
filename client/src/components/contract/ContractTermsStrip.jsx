/*
 * ContractTermsStrip — four-tile strip of contract particulars at the top
 * of the Contract page. Read-only; sourced from the GIBDLC contract terms.
 */

export default function ContractTermsStrip({ terms, basis }) {
  if (!terms || !basis) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile eyebrow="Counterparty"   value={terms.counterparty} sub={`Oversight · ${terms.oversight}`} />
      <Tile eyebrow="Term"           value={`${terms.term_years} years`} sub={`From ${new Date(terms.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`} />
      <Tile eyebrow="Annual volume"  value={`${(basis.target_mtpa).toFixed(1)} Mtpa`} sub={`Tranche 1 · ${basis.monthly_tonnes_contracted.toLocaleString()} t / month`} />
      <Tile eyebrow="Base tariff"    value={`$${basis.base_tariff_usd_per_tonne.toFixed(2)} / t`} sub={`Take-or-pay floor · ${basis.take_or_pay_floor_pct}%`} />
    </div>
  );
}

function Tile({ eyebrow, value, sub }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>
      <div style={{
        fontSize: 'var(--ts-stat-size)',
        lineHeight: 'var(--ts-stat-lh)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        marginTop: 4,
      }}>
        {sub}
      </div>
    </div>
  );
}
