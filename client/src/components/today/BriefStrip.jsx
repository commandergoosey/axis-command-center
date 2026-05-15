/*
 * BriefStrip — four small KPI cards.
 * Take-or-pay cushion · Axle-load breaches · Unresolved alerts · Receivables >30d.
 * Terse copy, tabular numerals, modelled tag on monetary/tonnage figures.
 */

export default function BriefStrip({ items }) {
  if (!items) return null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      {items.map((item) => <BriefCard key={item.key} item={item} />)}
    </div>
  );
}

function BriefCard({ item }) {
  const { label, sub } = item;
  const { value, unit, tone, modelled } = resolveValue(item);

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 96,
      }}
    >
      <div className="micro" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        color: tone === 'warn' ? 'var(--signal-red)' : 'var(--text)',
      }}>
        <span
          className="tabular"
          style={{
            fontSize: 'var(--ts-h2-size)',
            lineHeight: 1,
            fontWeight: 'var(--fw-black)',
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {unit}
          </span>
        )}
        {modelled && (
          <span
            className="mono"
            style={{
              marginLeft: 'auto',
              fontSize: 9,
              padding: '2px 6px',
              border: '1px solid var(--border-soft)',
              letterSpacing: '0.14em',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
            }}
          >
            MODELLED
          </span>
        )}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 2,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function resolveValue(item) {
  if (item.value_tonnes != null) {
    const v = item.value_tonnes;
    return {
      value: `${v >= 0 ? '+' : ''}${new Intl.NumberFormat('en-GB').format(v)}`,
      unit: 't',
      tone: v < 0 ? 'warn' : 'neutral',
      modelled: true,
    };
  }
  if (item.value_usd != null) {
    return {
      value: `$${new Intl.NumberFormat('en-GB').format(item.value_usd)}`,
      unit: null,
      tone: 'warn',
      modelled: true,
    };
  }
  return { value: item.value, unit: null, tone: 'neutral', modelled: false };
}
