/*
 * PillToggle — two-way (or N-way) toggle pill.
 * Active option: Charcoal fill, Bone text. Inactive: Ash fill, Iron text.
 * Used for the Schematic/Map toggle on the Corridor page, and hauler
 * filters on the Trips page.
 */

export default function PillToggle({ value, onChange, options }) {
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        padding: 2,
        background: 'var(--surface-sunk)',
        borderRadius: 999,
        border: '1px solid var(--border-hairline)',
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 'var(--ts-caption-size)',
              fontWeight: 'var(--fw-medium)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: active ? 'var(--text-inverse)' : 'var(--text-secondary)',
              background: active ? 'var(--charcoal)' : 'transparent',
              transition: 'color 120ms ease, background 120ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
