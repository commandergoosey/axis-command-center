/*
 * LiveExportsSection — Phase 87 / Phase 104.
 *
 * Catalogue of in-browser printable cockpit views — composed
 * live from current state. Each card has two actions:
 *   • "Open" — opens the browser-rendered view in a new tab
 *   • "Download PDF" — streams a server-rendered PDF directly
 *
 * Phase 104: replaced single <a> card with a <div> card +
 * two-button footer so users can get a PDF without the
 * browser-print two-step.
 */

import { ExternalLink, Download, Building2, Sun, Briefcase } from 'lucide-react';

const SURFACE_META = {
  lender: { icon: Briefcase,  tone: 'var(--bauxite-rust)' },
  ops:    { icon: Sun,        tone: 'var(--text-secondary)' },
  hauler: { icon: Building2,  tone: 'var(--text-secondary)' },
};

export default function LiveExportsSection({ exports: items }) {
  if (!items || items.length === 0) return null;
  return (
    <section>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div className="eyebrow">Live exports · {items.length}</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Composed-live cockpit views · open in browser or download as PDF
        </span>
      </header>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 'var(--space-4)',
      }}>
        {items.map((entry) => <ExportTile key={entry.id} entry={entry} />)}
      </div>
    </section>
  );
}

function ExportTile({ entry }) {
  const meta = SURFACE_META[entry.surface] || SURFACE_META.ops;
  const Icon = meta.icon;
  const downloadUrl = `/api/reports/download/live/${entry.id}`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bauxite-rust)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-hairline)'; }}
    >
      {/* Card heading */}
      <header style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <Icon size={14} strokeWidth={1.6} color={meta.tone} style={{ flexShrink: 0 }} />
          <span style={{
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {entry.title}
          </span>
        </span>
      </header>

      {/* Description */}
      <p style={{
        margin: 0,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-secondary)',
        lineHeight: 1.45,
        flex: 1,
      }}>
        {entry.description}
      </p>

      {/* Audience / cadence meta */}
      <div style={{
        paddingTop: 'var(--space-2)',
        borderTop: '1px dashed var(--border-hairline)',
        fontSize: 10,
        color: 'var(--text-tertiary)',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 6,
      }}>
        <span>{entry.audience}</span>
        <span style={{ textAlign: 'right' }}>{entry.cadence}</span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
        <a
          href={entry.path}
          target="_blank"
          rel="noreferrer"
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-primary)',
            fontSize: 11,
            textDecoration: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-hairline)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <ExternalLink size={11} strokeWidth={1.6} />
          Open
        </a>
        <a
          href={downloadUrl}
          download={`${entry.id}.pdf`}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            padding: '6px 10px',
            background: 'var(--bauxite-rust)',
            border: '1px solid var(--bauxite-rust)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--bone)',
            fontFamily: 'var(--font-primary)',
            fontSize: 11,
            fontWeight: 'var(--fw-medium)',
            textDecoration: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <Download size={11} strokeWidth={1.8} />
          Download PDF
        </a>
      </div>
    </div>
  );
}
