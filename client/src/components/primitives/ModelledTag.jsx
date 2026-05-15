/*
 * ModelledTag — 9px mono pill used beside every financial figure that
 * originates in the business-plan tables rather than live telemetry.
 * Exists because every such figure on Contract / Tariff / Tranches /
 * Financials pages needs the marker (BRIEF.md §12.4).
 */

export default function ModelledTag({ tone = 'light' }) {
  const fg = tone === 'dark' ? 'rgba(245, 241, 236, 0.7)' : 'var(--text-tertiary)';
  const ring = tone === 'dark' ? 'rgba(245, 241, 236, 0.18)' : 'var(--border-hairline)';
  return (
    <span
      className="mono"
      aria-label="modelled figure"
      style={{
        display: 'inline-block',
        fontSize: 9,
        padding: '2px 6px',
        border: `1px solid ${ring}`,
        borderRadius: 2,
        letterSpacing: '0.14em',
        color: fg,
        textTransform: 'uppercase',
        verticalAlign: 'middle',
      }}
    >
      MODELLED
    </span>
  );
}
