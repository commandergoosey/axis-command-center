/*
 * FormField — minimal labelled input wrapper.
 * Stacks label (eyebrow) over control, supports text, number, and select.
 * Label copy stays in the "port authority notice" register — short and literal.
 */

export function TextField({ label, value, onChange, type = 'text', placeholder, min, autoFocus }) {
  return (
    <label style={wrapperStyle}>
      <span style={eyebrowStyle}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        autoFocus={autoFocus}
        style={controlStyle}
      />
    </label>
  );
}

export function SelectField({ label, value, onChange, options }) {
  return (
    <label style={wrapperStyle}>
      <span style={eyebrowStyle}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...controlStyle, appearance: 'none', paddingRight: 32 }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const wrapperStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const eyebrowStyle = {
  fontSize: 'var(--ts-eyebrow-size)',
  lineHeight: 'var(--ts-eyebrow-lh)',
  letterSpacing: 'var(--ts-eyebrow-tracking)',
  textTransform: 'uppercase',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text-secondary)',
};

const controlStyle = {
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-size)',
  lineHeight: 'var(--ts-body-lh)',
  color: 'var(--text)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 12px',
  outline: 'none',
};
