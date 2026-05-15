/*
 * IntervalTrackerStrip — Phase 138.
 * Compact horizontal strip of the highest-urgency rigs across all three
 * maintenance buckets: critical, service_due, and road_worthy_expiring_30d.
 * Shows up to 10 rigs ordered by urgency so ops can see the fleet's
 * worst offenders at a glance without scrolling the full bucket tables.
 *
 * Props:
 *   data  — /api/maintenance response body (may be null during load)
 */

const FLAG_META = {
  critical:        { label: 'CRITICAL',   color: 'var(--bauxite-rust)',  bg: 'rgba(139,46,26,0.08)',  border: 'rgba(139,46,26,0.28)'  },
  service_due:     { label: 'SERVICE DUE', color: 'var(--signal-amber)', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.28)' },
  road_worthy_30d: { label: 'CERT <30D',   color: 'var(--signal-amber)', bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.22)' },
};

function urgencyOrder(flag, rig) {
  // Lower number = higher urgency for sorting.
  if (flag === 'critical')        return 0;
  if (flag === 'service_due')     return 100  + (rig.km_since_service ?? 0) * -1;
  if (flag === 'road_worthy_30d') return 200  + (rig.road_worthy_expiry_days ?? 30);
  return 999;
}

function subText(flag, rig) {
  if (flag === 'critical') {
    return 'Pulled — critical defect';
  }
  if (flag === 'service_due') {
    const over = (rig.km_since_service ?? 0) - 20000;
    return over > 0
      ? `${(over / 1000).toFixed(0)} k km over interval`
      : 'Service interval reached';
  }
  if (flag === 'road_worthy_30d') {
    const d = rig.road_worthy_expiry_days ?? 0;
    return `Cert expires in ${d}d`;
  }
  return '';
}

export default function IntervalTrackerStrip({ data }) {
  if (!data) return null;

  // Merge and tag all three buckets, then sort by urgency.
  const rows = [
    ...(data.critical                   ?? []).map((r) => ({ ...r, _flag: 'critical' })),
    ...(data.service_due                ?? []).map((r) => ({ ...r, _flag: 'service_due' })),
    ...(data.road_worthy_expiring_30d   ?? []).map((r) => ({ ...r, _flag: 'road_worthy_30d' })),
  ]
    .sort((a, b) => urgencyOrder(a._flag, a) - urgencyOrder(b._flag, b))
    .slice(0, 10);

  if (rows.length === 0) return null;

  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Interval tracker · {rows.length} rig{rows.length !== 1 ? 's' : ''} need attention
      </div>

      {/* Horizontal scroll strip */}
      <div style={{
        display:        'flex',
        gap:            'var(--space-3)',
        overflowX:      'auto',
        paddingBottom:  4,           // space for scrollbar on Windows
        // Hide scrollbar while keeping scroll functional
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--border-hairline) transparent',
      }}>
        {rows.map((rig) => (
          <IntervalCard key={rig.id} rig={rig} flag={rig._flag} />
        ))}
      </div>
    </section>
  );
}

function IntervalCard({ rig, flag }) {
  const meta = FLAG_META[flag] ?? FLAG_META.service_due;
  const sub  = subText(flag, rig);

  return (
    <div style={{
      flexShrink:   0,
      width:        164,
      background:   meta.bg,
      border:       `1px solid ${meta.border}`,
      borderRadius: 'var(--radius-md)',
      padding:      'var(--space-3)',
      display:      'flex',
      flexDirection:'column',
      gap:          6,
    }}>
      {/* Flag badge */}
      <span className="mono" style={{
        fontSize:       9,
        letterSpacing:  '0.09em',
        textTransform:  'uppercase',
        color:          meta.color,
        padding:        '1px 0',
        fontWeight:     'var(--fw-medium)',
      }}>
        {meta.label}
      </span>

      {/* Plate */}
      <div style={{
        fontSize:    'var(--ts-body-sm-size)',
        fontWeight:  'var(--fw-semibold)',
        color:       'var(--text)',
        fontFamily:  'var(--font-mono)',
        letterSpacing: '0.03em',
      }}>
        {rig.plate}
      </div>

      {/* Hauler */}
      {rig.hauler_display && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color:    'var(--text-tertiary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {rig.hauler_display}
        </div>
      )}

      {/* Sub-text — urgency reason */}
      <div style={{
        fontSize:  'var(--ts-caption-size)',
        color:     meta.color,
        marginTop: 2,
        lineHeight: 1.3,
      }}>
        {sub}
      </div>
    </div>
  );
}
