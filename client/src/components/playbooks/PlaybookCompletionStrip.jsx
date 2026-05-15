/*
 * PlaybookCompletionStrip — Phase 145.
 * Per-template completion rate computed across recent runs.
 * Sorted worst-first so operators immediately see which playbooks
 * aren't being fully executed.
 *
 * Props:
 *   rates — completion_rates from /api/playbooks
 */

function rateColor(pct) {
  if (pct == null) return 'var(--text-tertiary)';
  if (pct >= 90) return 'var(--signal-green)';
  if (pct >= 70) return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

export default function PlaybookCompletionStrip({ rates }) {
  if (!rates || rates.length === 0) return null;

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Playbook completion · recent runs
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {rates.map((r, idx) => {
          const color  = rateColor(r.completion_pct);
          const isLast = idx === rates.length - 1;
          return (
            <div
              key={r.playbook_id}
              style={{
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
              }}
            >
              <div style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                marginBottom:   8,
                gap:            8,
                flexWrap:       'wrap',
              }}>
                {/* Playbook name */}
                <div style={{
                  fontSize:   'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color:      'var(--text)',
                  flex:       '1 1 180px',
                }}>
                  {r.playbook_name}
                </div>

                {/* Metadata */}
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color:    'var(--text-tertiary)',
                  flexShrink: 0,
                }}>
                  {r.run_count} run{r.run_count !== 1 ? 's' : ''} · {r.done_items}/{r.total_items} items
                </span>

                {/* Completion pct */}
                <span
                  className="tabular"
                  style={{
                    fontSize:   'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-semibold)',
                    color,
                    flexShrink: 0,
                    minWidth:   36,
                    textAlign:  'right',
                  }}
                >
                  {r.completion_pct != null ? `${r.completion_pct}%` : '—'}
                </span>
              </div>

              {/* Progress bar */}
              <div style={{
                height:       4,
                background:   'var(--border-hairline)',
                borderRadius: 2,
                overflow:     'hidden',
              }}>
                <div style={{
                  height:     '100%',
                  width:      `${r.completion_pct ?? 0}%`,
                  background: color,
                  borderRadius: 2,
                  transition: 'width 600ms ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
