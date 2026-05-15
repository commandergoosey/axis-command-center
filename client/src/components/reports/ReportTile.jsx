/*
 * ReportTile — one entry in the Reports library. Title + audience + cadence,
 * with a "Generate" button that opens the drawer and a "Preview" button
 * that streams the PDF inline in a new tab.
 */

import { FileText, Download, Clock } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { can } from '../../lib/auth';

export default function ReportTile({ entry, onGenerate, onSchedule }) {
  const { user } = useAuth();
  const mayGenerate = can(user?.role, 'generateReport');
  const previewUrl = `/api/reports/download/${entry.id}?label=${encodeURIComponent(entry.title + ' preview')}`;

  return (
    <article style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      minHeight: 260,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
        <span className="eyebrow">{entry.audience}</span>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3 style={{
          margin: 0,
          fontSize: 'var(--ts-h4-size)',
          lineHeight: 'var(--ts-h4-lh)',
          color: 'var(--text)',
        }}>
          {entry.title}
        </h3>
        <span className="mono" style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
        }}>
          {entry.cadence}
        </span>
      </div>

      <p style={{
        margin: 0,
        fontSize: 'var(--ts-body-sm-size)',
        lineHeight: 'var(--ts-body-sm-lh)',
        color: 'var(--text-secondary)',
        flex: 1,
      }}>
        {entry.description}
      </p>

      <footer style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span>Next due · <span className="mono" style={{ color: 'var(--text)' }}>{new Date(entry.next_due_iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></span>
        <div style={{ display: 'flex', gap: 6 }}>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 10px',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              textDecoration: 'none',
              fontSize: 'var(--ts-caption-size)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Download size={12} strokeWidth={1.6} /> Preview
          </a>
          {mayGenerate && (
            <>
              <button
                type="button"
                onClick={() => onSchedule?.(entry)}
                title="Schedule recurring delivery"
                style={{
                  padding: '6px 8px',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-primary)',
                  fontSize: 'var(--ts-caption-size)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-hairline)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              >
                <Clock size={12} strokeWidth={1.6} />
              </button>
              <button
                type="button"
                onClick={() => onGenerate(entry)}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--charcoal)',
                  color: 'var(--bone)',
                  fontFamily: 'var(--font-primary)',
                  fontSize: 'var(--ts-caption-size)',
                  cursor: 'pointer',
                }}
              >
                Generate
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}
