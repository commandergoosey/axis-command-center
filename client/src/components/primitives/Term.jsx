/*
 * Term — the explainer affordance for a piece of jargon.
 *
 * Wrap any acronym or specialist term:  <Term id="dscr" />  or
 * <Term id="take-or-pay">take-or-pay</Term>.
 *
 * Behaviour (both design goals, one component):
 *   • Always-on explainer layer — the term carries a hairline dotted underline
 *     and a small info dot; hover, focus, or tap reveals a plain-language
 *     definition drawn from glossary.js. Keyboard accessible, Escape to close.
 *   • Plain mode — when the global switch is on, an acronym is additionally
 *     spelled out inline the first time ("Debt Service Coverage Ratio (DSCR)"),
 *     so the reader never has to hover to follow the sentence.
 *
 * Register stays austere: no colour flood, no icon noise. Slate dotted rule,
 * 10px info glyph, Bone popover with a hairline border — a port-authority
 * footnote, not a tooltip bubble.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { termFor } from '../../lib/glossary';
import { usePlainMode } from '../../lib/PlainModeContext';

export default function Term({ id, children, expand: expandProp }) {
  const entry = termFor(id || (typeof children === 'string' ? children : ''));
  const { plain } = usePlainMode();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Unknown term — render the label plainly so a typo never breaks a sentence.
  if (!entry) return <>{children ?? id}</>;

  // In plain mode, spell an acronym out inline. Caller can force with expand.
  const wantsExpand = expandProp ?? plain;
  const label = children ?? entry.term;
  const inline =
    wantsExpand && entry.expand ? (
      <>
        {entry.expand} ({label})
      </>
    ) : (
      label
    );

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline' }}>
      <button
        type="button"
        className="term-affordance"
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          font: 'inherit',
          color: 'inherit',
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'help',
          borderBottom: '1px dotted var(--text-tertiary)',
          textAlign: 'left',
          lineHeight: 'inherit',
        }}
      >
        {inline}
        <span
          aria-hidden="true"
          className="term-dot"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 12,
            height: 12,
            marginLeft: 3,
            verticalAlign: 'text-top',
            border: '1px solid var(--border-soft)',
            borderRadius: '50%',
            fontSize: 8,
            fontWeight: 'var(--fw-medium)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-tertiary)',
            lineHeight: 1,
          }}
        >
          i
        </span>
      </button>

      {open && (
        <span
          id={popId}
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            width: 300,
            maxWidth: '80vw',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            padding: '12px 14px',
            textAlign: 'left',
            cursor: 'default',
            whiteSpace: 'normal',
          }}
        >
          <span
            className="mono"
            style={{
              display: 'block',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              marginBottom: 6,
            }}
          >
            {entry.expand || entry.term}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: 'var(--ts-body-sm-size)',
              lineHeight: 'var(--ts-body-sm-lh)',
              color: 'var(--text)',
              fontWeight: 'var(--fw-regular)',
            }}
          >
            {entry.plain}
          </span>
          {entry.matter && (
            <span
              style={{
                display: 'block',
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--border-hairline)',
                fontSize: 'var(--ts-caption-size)',
                lineHeight: 'var(--ts-caption-lh)',
                color: 'var(--text-secondary)',
              }}
            >
              {entry.matter}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
