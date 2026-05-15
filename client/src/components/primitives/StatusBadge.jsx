/*
 * StatusBadge — terse status pill, uppercase micro type.
 * Neutral chrome: Ash fill with Iron text. Tone is "infrastructure notice",
 * not decorative. Four tones mapped to signal palette when the status
 * is operationally charged (pending/active/degraded/manual).
 */

const TONE_MAP = {
  active:    { bg: 'var(--ash)',   fg: 'var(--iron)' },
  pending:   { bg: 'rgba(162, 62, 35, 0.08)', fg: 'var(--bauxite-rust)' },
  connected: { bg: 'rgba(46, 107, 63, 0.10)', fg: 'var(--signal-green)' },
  degraded:  { bg: 'rgba(184, 134, 11, 0.12)', fg: 'var(--signal-amber)' },
  manual:    { bg: 'var(--ash)',   fg: 'var(--iron)' },
  neutral:   { bg: 'var(--ash)',   fg: 'var(--iron)' },
};

export default function StatusBadge({ tone = 'neutral', children }) {
  const t = TONE_MAP[tone] ?? TONE_MAP.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: t.bg,
        color: t.fg,
        fontSize: 'var(--ts-micro-size)',
        lineHeight: 'var(--ts-micro-lh)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        fontWeight: 'var(--fw-medium)',
      }}
    >
      {children}
    </span>
  );
}
