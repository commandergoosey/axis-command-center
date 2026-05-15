/*
 * AXIS wordmark.
 * v0.1: temporary — rendered as Inter Black (900) type with locked tracking.
 * v1 replaces this with a path-outlined SVG wordmark per DESIGN_SYSTEM §3.
 */

export default function AxisWordmark({ size = 14, color = 'var(--charcoal)' }) {
  return (
    <span
      aria-label="AXIS"
      style={{
        fontFamily: 'var(--font-primary)',
        fontWeight: 'var(--fw-black)',
        fontSize: size,
        letterSpacing: '0.04em',
        color,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      AXIS
    </span>
  );
}
