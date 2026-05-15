/*
 * TripsTable — most-recent trip ledger. Sorted newest first by the server.
 * Columns: ID · Hauler · Route · Departed · Cycle h · Tonnes · Delay · Cost · Status.
 * Delay cell goes Bauxite Rust above 60 min (per the server's "delayed" threshold).
 */

export default function TripsTable({ trips, onRowClick }) {
  if (!trips?.length) {
    return (
      <div style={{
        padding: 'var(--space-5)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--ts-body-sm-size)',
        textAlign: 'center',
      }}>
        No trips in the selected window.
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <div className="eyebrow">Recent trips · {trips.length}</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
          <thead>
            <tr style={{ background: 'var(--surface-sunk)' }}>
              <Th>Trip</Th>
              <Th>Hauler</Th>
              <Th>Route</Th>
              <Th>Departed</Th>
              <Th align="right">Cycle h</Th>
              <Th align="right">Tonnes</Th>
              <Th align="right">Delay</Th>
              <Th align="right">Cost USD</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t, i) => (
              <tr
                key={t.id}
                onClick={() => onRowClick?.(t)}
                onMouseEnter={(e) => { if (onRowClick) e.currentTarget.style.background = 'var(--accent-tint)'; }}
                onMouseLeave={(e) => { if (onRowClick) e.currentTarget.style.background = 'transparent'; }}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background 100ms ease',
                }}
              >
                <Td mono>
                  {t.is_live && (
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 5px',
                      marginRight: 6,
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(22,163,74,0.12)',
                      color: 'var(--signal-green)',
                      fontSize: 9,
                      letterSpacing: '0.06em',
                      fontWeight: 'var(--fw-medium)',
                      textTransform: 'uppercase',
                      fontFamily: 'var(--font-mono)',
                      verticalAlign: 'middle',
                    }}>
                      LIVE
                    </span>
                  )}
                  {t.id}
                </Td>
                <Td>{t.hauler_display_name}</Td>
                <Td>
                  <span className="mono" style={{ color: 'var(--text)' }}>{t.route_id}</span>
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                    {t.direction === 'southbound' ? '↓' : '↑'}
                  </span>
                </Td>
                <Td muted>{formatDeparted(t.departed_at)}</Td>
                <Td align="right" mono>{t.cycle_h != null ? t.cycle_h.toFixed(1) : '—'}</Td>
                <Td align="right" mono>
                  {t.tonnage_t > 0 ? t.tonnage_t : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                </Td>
                <Td align="right" mono>
                  <span style={{
                    color: t.delay_min > 60 ? 'var(--bauxite-rust)' : 'var(--text)',
                    fontWeight: t.delay_min > 60 ? 'var(--fw-medium)' : 'normal',
                  }}>
                    {t.delay_min > 0 ? `${t.delay_min}` : '—'}
                  </span>
                </Td>
                <Td align="right" mono>
                  {t.cost?.total_usd != null
                    ? `$${t.cost.total_usd.toLocaleString()}`
                    : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                </Td>
                <Td>
                  <StatusPill status={t.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const tone = status === 'delayed'
    ? { bg: 'rgba(162, 62, 35, 0.10)', fg: 'var(--bauxite-rust)' }
    : { bg: 'var(--ash)', fg: 'var(--iron)' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-sm)',
      background: tone.bg,
      color: tone.fg,
      fontSize: 'var(--ts-micro-size)',
      letterSpacing: 'var(--ts-micro-tracking)',
      textTransform: 'uppercase',
      fontWeight: 'var(--fw-medium)',
    }}>
      {status}
    </span>
  );
}

function formatDeparted(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const hm  = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${hm}`;
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '10px var(--space-4)',
      fontSize: 'var(--ts-micro-size)',
      letterSpacing: 'var(--ts-micro-tracking)',
      textTransform: 'uppercase',
      fontWeight: 'var(--fw-medium)',
      color: 'var(--text-tertiary)',
      borderBottom: '1px solid var(--border-hairline)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', mono, muted }) {
  return (
    <td style={{
      textAlign: align,
      padding: '12px var(--space-4)',
      fontSize: 'var(--ts-body-sm-size)',
      color: muted ? 'var(--text-tertiary)' : 'var(--text)',
      fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </td>
  );
}
