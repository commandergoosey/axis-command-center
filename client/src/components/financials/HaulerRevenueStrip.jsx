/*
 * HaulerRevenueStrip — Phase 129.
 *
 * Per-hauler revenue contribution table on the Financials page.
 * Shows each active hauler's: MTD tonnage vs contracted, revenue earned,
 * corridor share %, SLA attainment, and outstanding receivable.
 *
 * This is the multi-hauler P&L breakdown that distinguishes AXIS as an
 * aggregator — the total line is already in PnLSnapshot; this strips
 * it by hauler so lenders can see individual counterparty exposure.
 *
 * MODELLED tag applies per BRIEF §12.4 — figures are computed from
 * the aggregator's proportional model, not live FMS billing data.
 */

const fmt  = (n) => n?.toLocaleString('en-US') ?? '—';
const fmtK = (n) => n == null ? '—' : n >= 1_000_000
  ? `$${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000
    ? `$${Math.round(n / 1_000)}K`
    : `$${n}`;

const SLA_COLOR = (pct) =>
  pct >= 90 ? 'var(--signal-green)'
  : pct >= 75 ? 'var(--signal-amber)'
  : 'var(--bauxite-rust)';

export default function HaulerRevenueStrip({ haulers }) {
  if (!haulers?.length) return null;

  const totalRevenue = haulers.reduce((s, h) => s + (h.revenue_usd ?? 0), 0);
  const totalTonnes  = haulers.reduce((s, h) => s + (h.tonnes_mtd ?? 0), 0);
  const totalReceivable = haulers.reduce((s, h) => s + (h.receivable_usd ?? 0), 0);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <span className="eyebrow">Hauler revenue contribution</span>
        <span className="mono" style={{
          marginLeft: 'auto',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          background: 'rgba(139,46,26,0.06)',
          border: '1px solid rgba(139,46,26,0.2)',
          padding: '1px 6px',
          borderRadius: 2,
        }}>MODELLED</span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--ts-body-sm-size)',
        }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
              {['Hauler', 'Tonnes MTD', 'Contracted', 'Revenue MTD', 'Corridor share', 'SLA', 'Receivable'].map((h) => (
                <th key={h} style={{
                  padding: '8px 12px',
                  textAlign: h === 'Hauler' ? 'left' : 'right',
                  fontSize: 10,
                  fontWeight: 'var(--fw-medium)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-tertiary)',
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {haulers.map((h, i) => {
              const attainment = h.tonnes_contracted > 0
                ? Math.round((h.tonnes_mtd / h.tonnes_contracted) * 100)
                : null;
              return (
                <tr key={h.hauler_id} style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                    {h.display_name}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span className="tabular">{fmt(h.tonnes_mtd)} t</span>
                    {attainment != null && (
                      <span style={{
                        marginLeft: 6,
                        fontSize: 10,
                        color: attainment >= 90 ? 'var(--signal-green)' : attainment >= 70 ? 'var(--signal-amber)' : 'var(--bauxite-rust)',
                      }}>
                        {attainment}%
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    <span className="tabular">{fmt(h.tonnes_contracted)} t</span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 'var(--fw-medium)' }}>
                    <span className="tabular">{fmtK(h.revenue_usd)}</span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {/* Mini bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      <div style={{ width: 60, height: 4, background: 'var(--border-hairline)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, h.corridor_share_pct ?? 0)}%`,
                          background: 'var(--bauxite-rust)',
                          borderRadius: 2,
                        }} />
                      </div>
                      <span className="tabular" style={{ fontSize: 11, minWidth: 36, textAlign: 'right' }}>
                        {h.corridor_share_pct?.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span className="mono" style={{
                      fontSize: 11,
                      color: SLA_COLOR(h.sla_attainment_pct),
                      fontWeight: 'var(--fw-medium)',
                    }}>
                      {h.sla_attainment_pct?.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    <span className="tabular">{fmtK(h.receivable_usd)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Totals row */}
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--surface)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 'var(--fw-semibold)', color: 'var(--text)' }}>
                Corridor total
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 'var(--fw-semibold)' }}>
                <span className="tabular">{fmt(totalTonnes)} t</span>
              </td>
              <td />
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 'var(--fw-semibold)' }}>
                <span className="tabular">{fmtK(totalRevenue)}</span>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11 }}>
                100%
              </td>
              <td />
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 'var(--fw-semibold)' }}>
                <span className="tabular">{fmtK(totalReceivable)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
