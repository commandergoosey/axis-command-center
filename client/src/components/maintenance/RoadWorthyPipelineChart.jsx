/*
 * Phase 190 — Road-worthy certificate expiry pipeline.
 * Per-bucket count (expired / 1-30d / 31-60d / 61-90d / 91d+) with
 * per-hauler stacked bar breakdown. Uses road_worthy_pipeline from
 * /api/maintenance. Replaces the narrow 30d view with full planning horizon.
 */

const BUCKET_META = {
  critical: { label: 'Expired',  color: 'var(--bauxite-rust)',   bg: 'rgba(185,68,49,0.10)' },
  urgent:   { label: '1–30 d',   color: 'var(--signal-amber)',   bg: 'rgba(245,158,11,0.08)' },
  warning:  { label: '31–60 d',  color: 'rgba(245,158,11,0.6)',  bg: 'transparent' },
  watch:    { label: '61–90 d',  color: 'var(--text-secondary)', bg: 'transparent' },
  clear:    { label: '91+ d',    color: 'var(--signal-green)',   bg: 'transparent' },
};

const PALETTE = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

function BucketTile({ bucketKey, label, count }) {
  const meta = BUCKET_META[bucketKey] ?? { color: 'var(--text-tertiary)', bg: 'transparent' };
  const isAlert = (bucketKey === 'critical' || bucketKey === 'urgent') && count > 0;
  return (
    <div style={{
      flex: 1,
      padding: 'var(--space-3) var(--space-4)',
      background: isAlert ? meta.bg : 'transparent',
      border: `1px solid ${isAlert ? meta.color + '44' : 'var(--border-hairline)'}`,
      borderRadius: 'var(--radius-md)',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 'var(--ts-h2-size, 22px)',
        fontWeight: 'var(--fw-black)',
        fontVariantNumeric: 'tabular-nums',
        color: count > 0 ? meta.color : 'var(--text-tertiary)',
        lineHeight: 1.1,
        marginBottom: 4,
      }}>
        {count}
      </div>
      <div style={{
        fontSize: 9,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: count > 0 ? meta.color : 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {label}
      </div>
    </div>
  );
}

function HaulerRow({ hauler, color }) {
  const total = hauler.total || 1;
  const segs = ['critical', 'urgent', 'warning', 'watch', 'clear'];
  const widths = segs.map((k) => ((hauler[k] ?? 0) / total) * 100);

  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
          <span style={{ fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)' }}>{hauler.hauler_display}</span>
        </div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {hauler.total} rigs
          {(hauler.critical ?? 0) > 0 && <span style={{ color: 'var(--bauxite-rust)', marginLeft: 6, fontWeight: 'var(--fw-medium)' }}>· {hauler.critical} expired</span>}
          {(hauler.urgent ?? 0) > 0 && <span style={{ color: 'var(--signal-amber)', marginLeft: 6 }}>· {hauler.urgent} &lt;30d</span>}
        </span>
      </div>
      <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
        {segs.map((k, i) => widths[i] > 0 && (
          <div key={k} style={{
            width: `${widths[i]}%`,
            background: BUCKET_META[k]?.color ?? 'var(--text-tertiary)',
            borderRadius: 3,
            opacity: k === 'watch' || k === 'clear' ? 0.5 : 1,
          }} />
        ))}
      </div>
    </div>
  );
}

export default function RoadWorthyPipelineChart({ roadWorthyPipeline }) {
  if (!roadWorthyPipeline) return null;

  const { buckets = [], by_hauler = [] } = roadWorthyPipeline;
  const criticalCount = buckets.find((b) => b.key === 'critical')?.count ?? 0;
  const urgentCount   = buckets.find((b) => b.key === 'urgent')?.count   ?? 0;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{
          fontSize: 'var(--ts-micro-size)',
          letterSpacing: 'var(--ts-micro-tracking)',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          fontWeight: 'var(--fw-medium)',
          marginBottom: 4,
        }}>
          Road-worthy certificate pipeline
        </div>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          DVLA roadworthiness renewal horizon across the full fleet
        </div>
      </div>

      {(criticalCount > 0 || urgentCount > 0) && (
        <div style={{
          padding: '8px 12px',
          background: criticalCount > 0 ? 'rgba(185,68,49,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${criticalCount > 0 ? 'rgba(185,68,49,0.25)' : 'rgba(245,158,11,0.25)'}`,
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: criticalCount > 0 ? 'var(--bauxite-rust)' : 'var(--signal-amber)',
          marginBottom: 'var(--space-3)',
        }}>
          {criticalCount > 0
            ? `${criticalCount} rig${criticalCount !== 1 ? 's' : ''} with expired road-worthy cert — must not operate`
            : `${urgentCount} rig${urgentCount !== 1 ? 's' : ''} with cert expiring within 30 days`}
        </div>
      )}

      {/* Bucket tiles */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {buckets.map((b) => (
          <BucketTile key={b.key} bucketKey={b.key} label={b.label} count={b.count} />
        ))}
      </div>

      {/* Per-hauler */}
      {by_hauler.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 'var(--space-3)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Per hauler · bars: expired / &lt;30d / 31-60d / 61-90d / clear
          </div>
          {by_hauler.map((h, i) => (
            <HaulerRow key={h.hauler_id} hauler={h} color={PALETTE[i % PALETTE.length]} />
          ))}
        </div>
      )}
    </div>
  );
}
