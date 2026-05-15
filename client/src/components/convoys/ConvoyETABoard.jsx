/*
 * ConvoyETABoard — Phase 140.
 * Live arrival countdown for southbound active convoys, sorted by ETA
 * ascending so the nearest arrivals sit at the top of the board.
 * Only shown when at least one convoy has a computable ETA.
 *
 * Props:
 *   convoys — full convoy list from /api/convoys
 */

const PHASE_LABEL = {
  loading: 'Loading',
  laden:   'En route',
  offload: 'Offloading',
};
const STATUS_META = {
  en_route: { label: 'En route',  color: 'var(--signal-green)' },
  imminent: { label: 'Arriving',  color: 'var(--signal-amber)' },
  overdue:  { label: 'Overdue',   color: 'var(--bauxite-rust)' },
};

function formatETA(minutesRemaining) {
  if (minutesRemaining == null) return '—';
  if (minutesRemaining <= 0) return 'Overdue';
  const h = Math.floor(minutesRemaining / 60);
  const m = minutesRemaining % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function ConvoyETABoard({ convoys }) {
  if (!convoys || !convoys.length) return null;

  const withETA = convoys
    .filter((c) => c.eta_iso != null && c.direction === 'southbound')
    .sort((a, b) => (a.eta_minutes_remaining ?? Infinity) - (b.eta_minutes_remaining ?? Infinity));

  if (!withETA.length) return null;

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Arrival countdown · {withETA.length} southbound
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
              {['Convoy', 'Hauler', 'Phase', 'Cargo', 'ETA', 'Arrives in'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    fontSize:    'var(--ts-caption-size)',
                    color:       'var(--text-tertiary)',
                    fontWeight:  'var(--fw-medium)',
                    padding:     '8px var(--space-3)',
                    textAlign:   i >= 4 ? 'right' : 'left',
                    paddingLeft: i === 0 ? 'var(--space-4)' : undefined,
                    letterSpacing: '0.02em',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {withETA.map((c, idx) => {
              const status = c.eta_status ?? 'en_route';
              const meta   = STATUS_META[status] ?? STATUS_META.en_route;
              const isOdd  = idx % 2 === 1;
              return (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: '1px solid var(--border-hairline)',
                    background: isOdd ? 'rgba(255,255,255,0.01)' : 'transparent',
                  }}
                >
                  {/* Convoy ref */}
                  <td style={{
                    padding:    '10px var(--space-3)',
                    paddingLeft:'var(--space-4)',
                    fontFamily: 'var(--font-mono)',
                    fontSize:   'var(--ts-caption-size)',
                    color:      'var(--text)',
                    letterSpacing: '0.03em',
                    fontWeight: 'var(--fw-medium)',
                  }}>
                    {c.convoy_ref}
                    {c.is_live && (
                      <span style={{
                        marginLeft:   5,
                        fontSize:     8,
                        padding:      '1px 4px',
                        background:   'rgba(74,222,128,0.1)',
                        border:       '1px solid rgba(74,222,128,0.3)',
                        color:        'var(--signal-green)',
                        borderRadius: 2,
                        letterSpacing:'0.08em',
                      }}>
                        LIVE
                      </span>
                    )}
                  </td>

                  {/* Hauler */}
                  <td style={{
                    padding:  '10px var(--space-3)',
                    fontSize: 'var(--ts-body-sm-size)',
                    color:    'var(--text-secondary)',
                  }}>
                    {c.hauler_display_name ?? c.hauler_id}
                  </td>

                  {/* Phase */}
                  <td style={{
                    padding:  '10px var(--space-3)',
                    fontSize: 'var(--ts-caption-size)',
                    color:    'var(--text-tertiary)',
                  }}>
                    {PHASE_LABEL[c.phase] ?? c.phase}
                  </td>

                  {/* Cargo */}
                  <td style={{
                    padding:  '10px var(--space-3)',
                    fontSize: 'var(--ts-body-sm-size)',
                    color:    'var(--text)',
                  }}>
                    {c.cargo_tonnes != null ? `${c.cargo_tonnes} t` : '—'}
                  </td>

                  {/* ETA time */}
                  <td style={{
                    padding:   '10px var(--space-3)',
                    textAlign: 'right',
                    fontSize:  'var(--ts-caption-size)',
                    color:     'var(--text-tertiary)',
                    fontFamily:'var(--font-mono)',
                  }}>
                    {c.eta_iso
                      ? new Date(c.eta_iso).toLocaleTimeString('en-GB', {
                          hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra',
                        })
                      : '—'}
                  </td>

                  {/* Arrives in (countdown) */}
                  <td style={{
                    padding:    '10px var(--space-3)',
                    textAlign:  'right',
                    paddingRight:'var(--space-4)',
                    fontWeight: 'var(--fw-medium)',
                    fontSize:   'var(--ts-body-sm-size)',
                    color:      meta.color,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.02em',
                  }}>
                    {formatETA(c.eta_minutes_remaining)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
