/*
 * ConvoyTable — flat list of active convoys with hauler attribution.
 * Columns: ID · Hauler · Phase · Trucks · km · Cycle · Schedule · Notes.
 * A delayed row tints the Schedule cell Bauxite Rust; on-schedule stays Iron.
 */

const PHASE_TONE = {
  laden:   { fg: 'var(--bauxite-rust)', bg: 'rgba(162, 62, 35, 0.10)' },
  empty:   { fg: 'var(--iron)',         bg: 'var(--ash)' },
  loading: { fg: 'var(--signal-amber)', bg: 'rgba(184, 134, 11, 0.12)' },
  offload: { fg: 'var(--charcoal)',     bg: 'var(--ash)' },
};

export default function ConvoyTable({ convoys, onRowClick }) {
  if (!convoys?.length) {
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
        No convoys reported active.
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
        <div className="eyebrow">Active convoys · {convoys.length}</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface-sunk)' }}>
            <Th>Convoy</Th>
            <Th>Hauler</Th>
            <Th>Phase</Th>
            <Th align="right">Trucks</Th>
            <Th align="right">km</Th>
            <Th align="right">Cycle h</Th>
            <Th>Schedule</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        <tbody>
          {convoys.map((c, i) => {
            const tone = PHASE_TONE[c.phase] ?? PHASE_TONE.empty;
            return (
              <tr
                key={c.id}
                onClick={() => onRowClick?.(c)}
                onMouseEnter={(e) => { if (onRowClick) e.currentTarget.style.background = 'var(--accent-tint)'; }}
                onMouseLeave={(e) => { if (onRowClick) e.currentTarget.style.background = 'transparent'; }}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background 100ms ease',
                }}
              >
                <Td>
                  <span className="mono" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                    {c.id}
                  </span>
                </Td>
                <Td>{c.hauler_display_name}</Td>
                <Td>
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
                    {c.phase}
                  </span>
                </Td>
                <Td align="right" mono>{c.trucks}</Td>
                <Td align="right" mono>{c.km}</Td>
                <Td align="right" mono>{c.cycle_h != null ? c.cycle_h.toFixed(1) : '—'}</Td>
                <Td>
                  <span style={{
                    color: c.on_schedule ? 'var(--iron)' : 'var(--bauxite-rust)',
                    fontSize: 'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-medium)',
                  }}>
                    {c.on_schedule ? 'On time' : 'Delayed'}
                  </span>
                </Td>
                <Td muted>{c.notes ?? '—'}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
    }}>
      {children}
    </td>
  );
}
