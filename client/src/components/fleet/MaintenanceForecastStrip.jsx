/*
 * MaintenanceForecastStrip — Phase 164.
 * Lists trucks within 5,000 km of their next scheduled service
 * (or already overdue). At the corridor's ~150 km/day run rate
 * this is roughly a 33-day service look-ahead.
 *
 * Lets ops pre-book workshop slots before trucks cross the km
 * threshold and get flagged maintenance_flag = 'service_due'.
 *
 * Props:
 *   maintenanceForecast — maintenance_forecast array from /api/fleet
 */

const AVG_KM_PER_DAY = 150;

function urgencyMeta(t) {
  if (t.overdue)             return { color: 'var(--bauxite-rust)',  label: 'OVERDUE'  };
  if (t.km_to_service < 500) return { color: 'var(--bauxite-rust)',  label: 'IMMINENT' };
  if (t.km_to_service < 2000) return { color: 'var(--signal-amber)', label: 'SOON'     };
  return                            { color: 'var(--text-tertiary)',  label: 'UPCOMING' };
}

function fmtKm(km) {
  return Math.abs(km).toLocaleString() + ' km';
}

export default function MaintenanceForecastStrip({ maintenanceForecast }) {
  if (!maintenanceForecast || maintenanceForecast.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Maintenance look-ahead</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Trucks within 5,000 km of service · {maintenanceForecast.length} rig{maintenanceForecast.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {maintenanceForecast.map((t, i) => {
          const meta     = urgencyMeta(t);
          const barWidth = t.overdue
            ? 100
            : Math.min(100, Math.round((1 - t.km_to_service / 5000) * 100));
          const daysEst  = t.overdue
            ? null
            : Math.round(t.km_to_service / AVG_KM_PER_DAY);

          return (
            <div
              key={t.rig_id}
              style={{
                display:      'grid',
                gridTemplateColumns: '1fr auto',
                gap:          'var(--space-4)',
                alignItems:   'center',
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: i < maintenanceForecast.length - 1
                              ? '1px solid var(--border-hairline)'
                              : 'none',
                borderLeft:   `3px solid ${meta.color}`,
              }}
            >
              {/* Left: rig info + bar */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{
                    fontSize:   'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-medium)',
                    fontFamily: 'var(--font-mono)',
                    color:      'var(--text)',
                  }}>
                    {t.plate}
                  </span>
                  <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                    {t.hauler_display}
                  </span>
                  {t.maintenance_flag && (
                    <span style={{
                      fontSize:     8,
                      fontFamily:   'var(--font-mono)',
                      letterSpacing: '0.08em',
                      background:   'rgba(139,46,26,0.10)',
                      color:        'var(--bauxite-rust)',
                      borderRadius: 3,
                      padding:      '1px 5px',
                      textTransform: 'uppercase',
                    }}>
                      {t.maintenance_flag.replace('_', ' ')}
                    </span>
                  )}
                </div>

                {/* Progress bar: fill = proximity to service */}
                <div style={{ height: 5, borderRadius: 3, background: 'var(--border-soft)', overflow: 'hidden' }}>
                  <div style={{
                    width:        `${barWidth}%`,
                    height:       '100%',
                    background:   meta.color,
                    transition:   'width 0.4s',
                  }} />
                </div>

                <div style={{
                  marginTop:  4,
                  fontSize:   'var(--ts-caption-size)',
                  color:      'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {t.total_km?.toLocaleString()} km total
                  {' · '}
                  {t.overdue
                    ? `${fmtKm(t.km_to_service)} overdue`
                    : `${fmtKm(t.km_to_service)} to service`}
                </div>
              </div>

              {/* Right: badge */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily:   'var(--font-mono)',
                  fontSize:     'var(--ts-caption-size)',
                  fontWeight:   'var(--fw-medium)',
                  color:        meta.color,
                  marginBottom: 3,
                }}>
                  {meta.label}
                </div>
                {daysEst != null && (
                  <div style={{
                    fontSize:   'var(--ts-caption-size)',
                    color:      'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                  }}>
                    ~{daysEst}d
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
