/*
 * RecentReports — list of historical instances with status pill, period,
 * recipients, and a download link. The shift-handover artefact.
 */

import { Download, FileText } from 'lucide-react';

const STATUS_TONE = {
  DELIVERED: { bg: 'rgba(46, 107, 63, 0.08)', color: 'var(--signal-green)', border: 'rgba(46, 107, 63, 0.3)' },
  PENDING:   { bg: 'rgba(217, 158, 55, 0.08)', color: 'var(--signal-amber)', border: 'rgba(217, 158, 55, 0.3)' },
  FAILED:    { bg: 'rgba(139, 46, 26, 0.08)', color: 'var(--bauxite-rust)', border: 'rgba(139, 46, 26, 0.3)' },
};

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.PENDING;
  return (
    <span className="mono" style={{
      fontSize: 10,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '2px 8px',
      background: tone.bg,
      color:  tone.color,
      border: `1px solid ${tone.border}`,
      borderRadius: 2,
    }}>
      {status}
    </span>
  );
}

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function RecentReports({ items = [] }) {
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <span className="eyebrow">Recent reports</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p style={{ margin: 0, padding: 'var(--space-4)', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          No reports generated yet.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((r) => (
            <li key={r.id} style={{
              display: 'grid',
              gridTemplateColumns: '20px minmax(0, 2.2fr) minmax(0, 1.2fr) minmax(0, 1.5fr) auto auto',
              gap: 'var(--space-3)',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--border-hairline)',
            }}>
              <FileText size={12} strokeWidth={1.6} color="var(--iron)" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                  {r.pages} pages · {r.size_kb} KB · {r.generated_by}
                </div>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {fmtWhen(r.generated_at)}
              </span>
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.recipients.join(', ')}
              </span>
              <StatusPill status={r.status} />
              <a
                href={`/api/reports/download/${r.type_id}?label=${encodeURIComponent(r.period_label)}${r.period_from ? `&period_from=${r.period_from}` : ''}${r.period_to ? `&period_to=${r.period_to}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Download ${r.title}`}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                }}
              >
                <Download size={12} strokeWidth={1.6} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
