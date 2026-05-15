/*
 * ClaimsExposureChart — Phase 146.
 * Horizontal bar chart of open claims exposure broken down by type.
 * Covers filed + under_review + approved-pending-payout claims.
 *
 * Props:
 *   exposureByType — exposure_by_type from /api/claims
 */

const TYPE_LABELS = {
  third_party_liability: 'Third-party liability',
  rig_damage:            'Rig damage',
  cargo_loss:            'Cargo loss',
  medical:               'Medical',
};

const TYPE_COLOR = {
  third_party_liability: 'var(--bauxite-rust)',
  rig_damage:            'var(--signal-amber)',
  cargo_loss:            'rgba(251,146,60,1)',
  medical:               'var(--text-secondary)',
};

function fmt(usd) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${Math.round(usd / 1_000)}k`;
  return `$${usd}`;
}

export default function ClaimsExposureChart({ exposureByType }) {
  if (!exposureByType || exposureByType.every((r) => r.count === 0)) return null;

  const maxExposure = Math.max(...exposureByType.map((r) => r.exposure_usd), 1);
  const totalExposure = exposureByType.reduce((s, r) => s + r.exposure_usd, 0);
  const totalCount    = exposureByType.reduce((s, r) => s + r.count, 0);

  if (totalCount === 0) return null;

  return (
    <section>
      <div style={{
        display:        'flex',
        alignItems:     'baseline',
        gap:            10,
        marginBottom:   'var(--space-3)',
        flexWrap:       'wrap',
      }}>
        <div className="eyebrow">Open claims exposure by type</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {totalCount} claim{totalCount !== 1 ? 's' : ''} · {fmt(totalExposure)} total open exposure
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
        display:      'flex',
        flexDirection:'column',
        gap:          'var(--space-4)',
      }}>
        {exposureByType.map((r) => {
          const color  = TYPE_COLOR[r.type] ?? 'var(--text-secondary)';
          const barPct = maxExposure > 0 ? (r.exposure_usd / maxExposure) * 100 : 0;
          return (
            <div key={r.type}>
              <div style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'baseline',
                marginBottom:   6,
                gap:            8,
              }}>
                <span style={{
                  fontSize:  'var(--ts-body-sm-size)',
                  color:     r.count > 0 ? 'var(--text)' : 'var(--text-tertiary)',
                  fontWeight:r.count > 0 ? 'var(--fw-medium)' : 'var(--fw-normal)',
                }}>
                  {TYPE_LABELS[r.type] ?? r.type}
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 'var(--ts-caption-size)',
                    color:    'var(--text-tertiary)',
                  }}>
                    {r.count} claim{r.count !== 1 ? 's' : ''}
                  </span>
                  <span
                    className="tabular"
                    style={{
                      fontSize:   'var(--ts-body-sm-size)',
                      fontWeight: 'var(--fw-semibold)',
                      color:      r.count > 0 ? color : 'var(--text-tertiary)',
                      minWidth:   48,
                      textAlign:  'right',
                    }}
                  >
                    {r.exposure_usd > 0 ? fmt(r.exposure_usd) : '—'}
                  </span>
                </div>
              </div>

              <div style={{
                height:       6,
                background:   'var(--border-hairline)',
                borderRadius: 3,
                overflow:     'hidden',
              }}>
                <div style={{
                  height:     '100%',
                  width:      `${barPct}%`,
                  background: r.count > 0 ? color : 'transparent',
                  borderRadius: 3,
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
