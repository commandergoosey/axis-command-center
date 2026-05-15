/*
 * FilingsTracker — regulatory filings surface for the Reports page.
 * Rows per filing (DVLA, GHA, EPA, Minerals Commission) with agency,
 * detail, due date + relative window, and a status chip. Sorted by
 * due date; overdue / imminent items float to the top tonally.
 */

import { ShieldCheck } from 'lucide-react';

const STATUS_TONE = {
  FILED:    { bg: 'rgba(46, 107, 63, 0.08)',  color: 'var(--signal-green)', border: 'rgba(46, 107, 63, 0.3)' },
  ON_TRACK: { bg: 'var(--accent-tint)',        color: 'var(--text-secondary)', border: 'var(--border-hairline)' },
  DUE:      { bg: 'rgba(217, 158, 55, 0.08)', color: 'var(--signal-amber)', border: 'rgba(217, 158, 55, 0.3)' },
  OVERDUE:  { bg: 'rgba(139, 46, 26, 0.08)',  color: 'var(--bauxite-rust)', border: 'rgba(139, 46, 26, 0.3)' },
};

function StatusChip({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.ON_TRACK;
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
      whiteSpace: 'nowrap',
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function daysBetween(iso, today) {
  const due = new Date(iso + 'T00:00:00Z').getTime();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - now) / 86_400_000);
}

function relativeDue(days) {
  if (days < 0)  return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `in ${days}d`;
}

function fmtDue(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
  });
}

export default function FilingsTracker({ filings = [], onSelect }) {
  const today = new Date();

  const enriched = filings
    .map((f) => {
      const days = daysBetween(f.due, today);
      let status = f.status;
      if (status !== 'FILED' && days < 0) status = 'OVERDUE';
      return { ...f, days, display_status: status };
    })
    .sort((a, b) => {
      // Unfiled first, soonest due first within each group.
      if ((a.display_status === 'FILED') !== (b.display_status === 'FILED')) {
        return a.display_status === 'FILED' ? 1 : -1;
      }
      return a.days - b.days;
    });

  const openCount = enriched.filter((f) => f.display_status !== 'FILED').length;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Filings tracker</span>
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {openCount} open · {enriched.length} total
        </span>
      </header>

      {enriched.length === 0 ? (
        <p style={{ margin: 0, padding: 'var(--space-4)', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          No filings on the tracker.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {enriched.map((f) => {
            const imminent = f.display_status === 'DUE' || f.display_status === 'OVERDUE';
            const clickable = Boolean(onSelect);
            return (
              <li
                key={f.id}
                onClick={clickable ? () => onSelect(f) : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(f); }
                } : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? 'button' : undefined}
                aria-label={clickable ? `Open ${f.agency} filing · ${f.detail}` : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 2.4fr) minmax(0, 1fr) auto',
                  gap: 'var(--space-3)',
                  alignItems: 'center',
                  padding: 'var(--space-3) var(--space-4)',
                  borderTop: '1px solid var(--border-hairline)',
                  cursor: clickable ? 'pointer' : 'default',
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={clickable ? (e) => { e.currentTarget.style.background = 'var(--accent-tint)'; } : undefined}
                onMouseLeave={clickable ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
              >
                <span className="mono" style={{
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {f.agency}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--ts-body-sm-size)',
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {f.detail}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {fmtDue(f.due)}
                  </span>
                  <span className="mono" style={{
                    fontSize: 10,
                    color: f.display_status === 'FILED'
                      ? 'var(--text-tertiary)'
                      : imminent ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
                  }}>
                    {f.display_status === 'FILED' ? 'submitted' : relativeDue(f.days)}
                  </span>
                </div>
                <StatusChip status={f.display_status} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
