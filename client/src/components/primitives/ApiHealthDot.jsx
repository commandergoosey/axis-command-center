/*
 * ApiHealthDot — 8px dot reflecting hauler integration health.
 * Status vocabulary matches aggregator.apiStatusOf():
 *   connected (signal-green) · degraded (signal-amber) · manual (slate) ·
 *   pending (iron outline, unfilled)
 * The dot is decorative; always paired with text in a table cell.
 */

const DOT_MAP = {
  connected: { fill: 'var(--signal-green)', ring: 'var(--signal-green)' },
  degraded:  { fill: 'var(--signal-amber)', ring: 'var(--signal-amber)' },
  manual:    { fill: 'var(--slate)',        ring: 'var(--slate)' },
  pending:   { fill: 'transparent',         ring: 'var(--iron)' },
};

export default function ApiHealthDot({ status = 'pending', size = 8 }) {
  const token = DOT_MAP[status] ?? DOT_MAP.pending;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: token.fill,
        boxShadow: `inset 0 0 0 1.5px ${token.ring}`,
        flexShrink: 0,
      }}
    />
  );
}
