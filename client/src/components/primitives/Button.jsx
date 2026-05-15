/*
 * Button — three variants, 4px radius per design system §6.4.
 *   primary   — Charcoal fill, Bone text. Default call-to-action.
 *   secondary — Bone fill, 1px Iron border. Neutral action.
 *   ghost     — Transparent, Iron text, no border until hover.
 * Accent colour (Bauxite Rust) is reserved for navigation active state
 * and AXIS Intelligence chrome, not for buttons — see design system §4.5.
 */

const VARIANTS = {
  primary: {
    background: 'var(--charcoal)',
    color: 'var(--text-inverse)',
    border: '1px solid var(--charcoal)',
  },
  secondary: {
    background: 'var(--surface-raised)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid transparent',
  },
};

export default function Button({
  variant = 'secondary',
  type = 'button',
  disabled = false,
  onClick,
  children,
  ...rest
}) {
  const v = VARIANTS[variant] ?? VARIANTS.secondary;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...v,
        padding: '8px 16px',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        letterSpacing: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
