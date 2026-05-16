/*
 * Phase 185 — Driver licence expiry pipeline.
 * Bucketed view of how many drivers have licences expiring within
 * ≤2m (critical), 3–6m (warning), 7–12m (watch), 12m+ (clear).
 * Also surfaces PSV endorsement expiry counts. Per-hauler breakdown.
 * Uses licence_pipeline from /api/drivers.
 */

const BUCKET_META = {
  critical: { label: '≤ 2 mo',  color: 'var(--bauxite-rust)',   bg: 'rgba(185,68,49,0.08)' },
  warning:  { label: '3–6 mo',  color: 'var(--signal-amber)',   bg: 'rgba(245,158,11,0.08)' },
  watch:    { label: '7–12 mo', color: 'var(--text-secondary)', bg: 'transparent' },
  clear:    { label: '12+ mo',  color: 'var(--signal-green)',   bg: 'transparent' },
};

const PALETTE = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

function BucketTile({ bucketKey, count }) {
  const meta = BUCKET_META[bucketKey];
  if (!meta) return null;
  return (
    <div style={{
      flex: 1,
      padding: 'var(--space-3) var(--space-4)',
      background: count > 0 ? meta.bg : 'transparent',
      border: `1px solid ${count > 0 ? meta.color + '44' : 'var(--border-hairline)'}`,
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
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: count > 0 ? meta.color : 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {meta.label}
      </div>
    </div>
  );
}

function HaulerRow({ hauler, color }) {
  const total = hauler.total || 1;
  const critW = ((hauler.critical ?? 0) / total) * 100;
  const warnW = ((hauler.warning  ?? 0) / total) * 100;
  const watchW = ((hauler.watch  ?? 0) / total) * 100;
  const clearW = ((hauler.clear  ?? 0) / total) * 100;

  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
          <span style={{ fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)' }}>{hauler.hauler_display}</span>
        </div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {hauler.total} drivers
          {(hauler.critical ?? 0) > 0 && (
            <span style={{ marginLeft: 6, color: 'var(--bauxite-rust)', fontWeight: 'var(--fw-medium)' }}>
              · {hauler.critical} critical
            </span>
          )}
        </span>
      </div>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
        {critW > 0  && <div style={{ width: `${critW}%`,  background: 'var(--bauxite-rust)',   borderRadius: 2 }} />}
        {warnW > 0  && <div style={{ width: `${warnW}%`,  background: 'var(--signal-amber)',   borderRadius: 2 }} />}
        {watchW > 0 && <div style={{ width: `${watchW}%`, background: 'var(--text-tertiary)',  borderRadius: 2, opacity: 0.5 }} />}
        {clearW > 0 && <div style={{ width: `${clearW}%`, background: 'var(--signal-green)',   borderRadius: 2, opacity: 0.4 }} />}
      </div>
    </div>
  );
}

export default function LicenceExpiryPipeline({ licencePipeline }) {
  if (!licencePipeline) return null;

  const { buckets = [], psv_expiring_30d = 0, psv_expiring_60d = 0, by_hauler = [] } = licencePipeline;
  const criticalCount = buckets.find((b) => b.key === 'critical')?.count ?? 0;
  const warningCount  = buckets.find((b) => b.key === 'warning')?.count  ?? 0;

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
          Driver licence expiry pipeline
        </div>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          Ghana DVLA Class E licences · 5-year cycle · compliance cliff visibility
        </div>
      </div>

      {(criticalCount > 0 || warningCount > 0) && (
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
            ? `${criticalCount} driver${criticalCount !== 1 ? 's' : ''} with licence expiring within 2 months — action required`
            : `${warningCount} driver${warningCount !== 1 ? 's' : ''} with licence expiring within 6 months`}
        </div>
      )}

      {/* Bucket tiles */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {buckets.map((b) => (
          <BucketTile key={b.key} bucketKey={b.key} count={b.count} />
        ))}
      </div>

      {/* PSV callout */}
      {(psv_expiring_30d > 0 || psv_expiring_60d > 0) && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-amber)',
          marginBottom: 'var(--space-4)',
        }}>
          PSV endorsement: {psv_expiring_30d} expiring ≤ 30 d · {psv_expiring_60d} expiring ≤ 60 d
        </div>
      )}

      {/* Per-hauler breakdown */}
      {by_hauler.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9 }}>
            Per hauler
          </div>
          {by_hauler.map((h, i) => (
            <HaulerRow key={h.hauler_id} hauler={h} color={PALETTE[i % PALETTE.length]} />
          ))}
        </div>
      )}
    </div>
  );
}
