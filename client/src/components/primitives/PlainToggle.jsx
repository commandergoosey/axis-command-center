/*
 * PlainToggle — the topbar switch between the expert view and plain mode.
 *
 * Sits with the other Topbar affordances (Search, Week in review). Matches
 * their outline-button register: no colour flood off, a quiet Bauxite Rust
 * tint when engaged so the reader can see which level they are in at a glance.
 */

import { BookOpen } from 'lucide-react';
import { usePlainMode } from '../../lib/PlainModeContext';

export default function PlainToggle() {
  const { plain, toggle } = usePlainMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={plain}
      title={
        plain
          ? 'Plain language is on — acronyms are spelled out and screens carry a plain summary. Click for the expert view.'
          : 'Turn on plain language — spells out acronyms and adds a plain-English summary to each screen.'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 11,
        color: plain ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
        background: plain ? 'var(--accent-tint)' : 'transparent',
        border: `1px solid ${plain ? 'var(--accent-border-soft)' : 'var(--border-hairline)'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <BookOpen size={12} strokeWidth={1.6} />
      Plain language
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.08em',
          color: plain ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
        }}
      >
        {plain ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
