/*
 * ReconciliationGapStrip — Phase 166.
 * Per-period comparison of invoiced vs expected settlement amounts.
 * A gap > 0 means over-invoiced (invoiced > expected); < 0 means
 * under-invoiced. Flags periods that need pre-lender reconciliation.
 *
 * Props:
 *   reconciliation — reconciliation array from /api/settlements
 */

function periodLabel(iso) {
  const [yr, mo] = iso.split('-');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1];
  return `${mon} '${yr.slice(2)}`;
}

function fmtUSD(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)    return `$${(Math.abs(v) / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

const MAX_GAP_PCT = 4; // clamp bar at ±4 % for legibility

export default function ReconciliationGapStrip({ reconciliation }) {
  if (!reconciliation || reconciliation.length === 0) return null;

  const hasGap = reconciliation.some((r) => Math.abs(r.gap_pct) >= 0.5);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Settlement reconciliation</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Invoiced vs expected · gap by period · seeded variance
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow:     'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display:    'grid',
          gridTemplateColumns: '80px 1fr 1fr 90px 70px',
          gap:        'var(--space-3)',
          padding:    '8px var(--space-4)',
          borderBottom: '1px solid var(--border-hairline)',
          fontSize:   'var(--ts-caption-size)',
          fontFamily: 'var(--font-mono)',
          color:      'var(--text-tertiary)',
          fontWeight: 'var(--fw-medium)',
          letterSpacing: '0.06em',
        }}>
          <span>PERIOD</span>
          <span style={{ textAlign: 'right' }}>EXPECTED</span>
          <span style={{ textAlign: 'right' }}>INVOICED</span>
          <span style={{ textAlign: 'right' }}>GAP</span>
          <span style={{ textAlign: 'right' }}>GAP %</span>
        </div>

        {reconciliation.map((r, i) => {
          const isOver  = r.gap_usd > 0;
          const isUnder = r.gap_usd < 0;
          const gapColor = isOver   ? 'var(--signal-amber)'
                         : isUnder  ? 'var(--bauxite-rust)'
                         : 'var(--signal-green)';
          const barWidth = Math.min(100, (Math.abs(r.gap_pct) / MAX_GAP_PCT) * 100);
          const flagged  = Math.abs(r.gap_pct) >= 1.0;

          return (
            <div
              key={r.period}
              style={{
                display:      'grid',
                gridTemplateColumns: '80px 1fr 1fr 90px 70px',
                gap:          'var(--space-3)',
                alignItems:   'center',
                padding:      'var(--space-3) var(--space-4)',
                borderBottom: i < reconciliation.length - 1
                              ? '1px solid var(--border-hairline)'
                              : 'none',
                borderLeft:   flagged ? `3px solid ${gapColor}` : '3px solid transparent',
              }}
            >
              <span style={{
                fontSize:   'var(--ts-caption-size)',
                fontFamily: 'var(--font-mono)',
                color:      'var(--text-secondary)',
                fontWeight: 'var(--fw-medium)',
              }}>
                {periodLabel(r.period)}
              </span>

              <span className="tabular" style={{
                textAlign: 'right',
                fontSize:  'var(--ts-body-sm-size)',
                color:     'var(--text-secondary)',
              }}>
                {fmtUSD(r.expected_usd)}
              </span>

              <span className="tabular" style={{
                textAlign: 'right',
                fontSize:  'var(--ts-body-sm-size)',
                color:     'var(--text)',
              }}>
                {fmtUSD(r.invoiced_usd)}
              </span>

              <span className="tabular" style={{
                textAlign:  'right',
                fontSize:   'var(--ts-body-sm-size)',
                fontWeight: 'var(--fw-medium)',
                color:      gapColor,
              }}>
                {r.gap_usd > 0 ? '+' : ''}{fmtUSD(r.gap_usd)}
              </span>

              {/* Gap % bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                <span className="tabular" style={{
                  fontSize:   'var(--ts-caption-size)',
                  color:      gapColor,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 'var(--fw-medium)',
                  minWidth:   38,
                  textAlign:  'right',
                }}>
                  {r.gap_pct > 0 ? '+' : ''}{r.gap_pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!hasGap && (
        <div style={{
          marginTop:  'var(--space-2)',
          fontSize:   'var(--ts-caption-size)',
          color:      'var(--signal-green)',
          fontFamily: 'var(--font-mono)',
        }}>
          ✓ All periods within tolerance
        </div>
      )}
    </section>
  );
}
