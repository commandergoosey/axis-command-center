/*
 * Phase 182 — Per-hauler settlement breakdown.
 * Horizontal stacked progress bars: invoiced vs paid per hauler.
 * Uses hauler_breakdown from /api/settlements.
 */

const PALETTE = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

function fmtUsd(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

function HaulerRow({ hauler, color, maxInvoiced }) {
  const invoiced    = hauler.invoiced_usd    ?? 0;
  const paid        = hauler.paid_usd        ?? 0;
  const outstanding = hauler.outstanding_usd ?? 0;
  const paidPct     = hauler.paid_pct        ?? 0;
  const trackPct    = maxInvoiced > 0 ? (invoiced / maxInvoiced) * 100 : 0;

  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      {/* Label row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
          <span style={{ fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
            {hauler.hauler_display}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 'var(--ts-caption-size)' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>
            Invoiced <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{fmtUsd(invoiced)}</span>
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            Paid <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--signal-green)' }}>{fmtUsd(paid)}</span>
          </span>
          {outstanding > 0 && (
            <span style={{ color: 'var(--text-tertiary)' }}>
              Outstdg <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--signal-amber)' }}>{fmtUsd(outstanding)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Track */}
      <div style={{
        height: 8,
        background: 'var(--border-hairline)',
        borderRadius: 4,
        overflow: 'hidden',
        width: '100%',
      }}>
        {/* Full invoiced track (proportional to max) */}
        <div style={{
          position: 'relative',
          height: '100%',
          width: `${trackPct}%`,
          background: `${color}22`,
          borderRadius: 4,
          overflow: 'hidden',
        }}>
          {/* Paid fill */}
          <div style={{
            position: 'absolute',
            inset: 0,
            width: `${paidPct}%`,
            background: color,
            borderRadius: 4,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* % label */}
      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 3, textAlign: 'right' }}>
        {paidPct.toFixed(1)}% settled
      </div>
    </div>
  );
}

export default function HaulerSettlementShare({ haulerBreakdown }) {
  if (!haulerBreakdown?.length) return null;

  const maxInvoiced = Math.max(...haulerBreakdown.map((h) => h.invoiced_usd ?? 0), 1);
  const totalInvoiced    = haulerBreakdown.reduce((s, h) => s + (h.invoiced_usd    ?? 0), 0);
  const totalPaid        = haulerBreakdown.reduce((s, h) => s + (h.paid_usd        ?? 0), 0);
  const totalOutstanding = haulerBreakdown.reduce((s, h) => s + (h.outstanding_usd ?? 0), 0);
  const overallPct = totalInvoiced > 0 ? (totalPaid / totalInvoiced * 100).toFixed(1) : '0.0';

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Per-hauler settlement breakdown
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Invoiced vs paid across all periods · bar width proportional to invoiced total
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: 'var(--ts-h2-size, 22px)',
            fontWeight: 'var(--fw-black)',
            fontVariantNumeric: 'tabular-nums',
            color: Number(overallPct) < 80 ? 'var(--signal-amber)' : 'var(--signal-green)',
            lineHeight: 1.1,
          }}>
            {overallPct}%
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>corridor settled</div>
        </div>
      </div>

      {/* Rows */}
      {haulerBreakdown.map((h, i) => (
        <HaulerRow
          key={h.hauler_id}
          hauler={h}
          color={PALETTE[i % PALETTE.length]}
          maxInvoiced={maxInvoiced}
        />
      ))}

      {/* Footer totals */}
      <div style={{
        borderTop: '1px solid var(--border-hairline)',
        paddingTop: 'var(--space-3)',
        marginTop: 'var(--space-2)',
        display: 'flex',
        gap: 24,
        fontSize: 'var(--ts-caption-size)',
      }}>
        <span style={{ color: 'var(--text-tertiary)' }}>
          Total invoiced <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{fmtUsd(totalInvoiced)}</span>
        </span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          Total paid <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--signal-green)', fontWeight: 'var(--fw-medium)' }}>{fmtUsd(totalPaid)}</span>
        </span>
        {totalOutstanding > 0 && (
          <span style={{ color: 'var(--text-tertiary)' }}>
            Outstanding <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--signal-amber)', fontWeight: 'var(--fw-medium)' }}>{fmtUsd(totalOutstanding)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
