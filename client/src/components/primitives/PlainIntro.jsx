/*
 * PlainIntro — a one- or two-sentence plain-language answer to "what am I
 * looking at, and why does it matter?" for a screen or a panel.
 *
 * Two visibility modes:
 *   • Default ("plainOnly", the norm) — shows only when plain mode is on. The
 *     expert view stays uncluttered; the plain reader gets the framing.
 *   • always — pass `always` to keep it visible in both modes (use for the
 *     densest screens where even experts benefit from the one-liner).
 *
 * Rendered as a quiet left-ruled note in Bauxite Rust — a margin annotation,
 * not a callout box. Honors the 7–9% accent-area rule.
 */

import { usePlainMode } from '../../lib/PlainModeContext';

export default function PlainIntro({ children, always = false }) {
  const { plain } = usePlainMode();
  if (!plain && !always) return null;

  return (
    <p
      style={{
        margin: '0 0 var(--space-4)',
        padding: '2px 0 2px var(--space-3)',
        borderLeft: '2px solid var(--accent-border-soft)',
        maxWidth: '68ch',
        fontSize: 'var(--ts-body-size)',
        lineHeight: 'var(--ts-body-lh)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </p>
  );
}
