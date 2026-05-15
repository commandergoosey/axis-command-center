/*
 * AXIS mark — the X.
 * 80×80 grid, 16-unit stroke, corner-to-corner, unified geometry.
 * Per ../Bauxite Project/DESIGN_SYSTEM.md §3.
 * Colour is driven by `fill` on the root (defaults to Bauxite Rust).
 */

export default function AxisMark({ size = 24, fill = 'var(--bauxite-rust)', title = 'AXIS' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill={fill}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <g transform="translate(40 40)">
        <rect x="-40" y="-8" width="80" height="16" transform="rotate(45)" />
        <rect x="-40" y="-8" width="80" height="16" transform="rotate(-45)" />
      </g>
    </svg>
  );
}
