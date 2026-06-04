/*
 * EffectiveRateHistoryCard — Phase 86.
 *
 * Shows the corridor's effective tariff rate over the last 10
 * months as a bar chart. Complements the existing component-level
 * history (NPA diesel + GSS CPI) by surfacing the *resulting*
 * indexed rate — the single number lenders and operators
 * actually transact on.
 *
 * Each bar is tinted by sign of the month-over-month delta:
 * green if rate went up (in operator-favour, MOM increase),
 * rust if down. Hover/title carries the exact value + delta.
 * The "Next review" pill on the right shows the days-until
 * countdown.
 */

import { Calendar } from 'lucide-react';

export default function EffectiveRateHistoryCard({ history, nextReview, current }) {
  if (!history || history.length === 0) return null;

  const max = Math.max(...history.map((r) => r.effective_usd_per_tonne));
  const min = Math.min(...history.map((r) => r.effective_usd_per_tonne));
  const range = Math.max(max - min, 0.01);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
        gap: 'var(--space-3)',
      }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-medium)', color: 'var(--text)',
          }}>
            Effective rate · last {history.length} months
          </h2>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            What the corridor's been billing per tonne after indexation. The single number lenders track.
          </p>
        </div>
        {nextReview && (
          <NextReviewPill nextReview={nextReview} />
        )}
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${history.length}, 1fr)`,
        alignItems: 'flex-end',
        gap: 6,
        height: 80,
        padding: '0 4px',
      }}>
        {history.map((r) => {
          const heightPct = 25 + 70 * ((r.effective_usd_per_tonne - min) / range);
          const tone = r.delta_usd_per_tonne == null ? 'var(--text-tertiary)'
                     : r.delta_usd_per_tonne > 0 ? 'var(--signal-green)'
                     : r.delta_usd_per_tonne < 0 ? 'var(--bauxite-rust)'
                     : 'var(--text-tertiary)';
          const isCurrent = current && Math.abs(r.effective_usd_per_tonne - current) < 0.01;
          return (
            <div
              key={r.month}
              title={`${r.month}: $${r.effective_usd_per_tonne}/t${r.delta_usd_per_tonne != null ? ` (${r.delta_usd_per_tonne > 0 ? '+' : ''}$${r.delta_usd_per_tonne.toFixed(2)} mom)` : ''}`}
              style={{
                height: `${heightPct}%`,
                background: tone,
                opacity: 0.85,
                borderRadius: 1,
                outline: isCurrent ? '1.5px solid var(--text)' : 'none',
                outlineOffset: isCurrent ? 1 : 0,
              }}
            />
          );
        })}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${history.length}, 1fr)`,
        gap: 6,
        marginTop: 6,
      }} className="mono tabular">
        {history.map((r, i) => (
          <div key={r.month} style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-tertiary)' }}>
            {i % 2 === 0 ? r.month.slice(2) : ''}
          </div>
        ))}
      </div>

      <footer style={{
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px dashed var(--border-hairline)',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Stat
          label="Period low"
          value={`$${min.toFixed(2)}/t`}
          sub={history.find((r) => r.effective_usd_per_tonne === min)?.month}
        />
        <Stat
          label="Period high"
          value={`$${max.toFixed(2)}/t`}
          sub={history.find((r) => r.effective_usd_per_tonne === max)?.month}
        />
        <Stat
          label="Cumulative shift"
          value={`${(history[history.length - 1].adjustment_pct).toFixed(2)}%`}
          sub="vs base (2026-01)"
          tone={history[history.length - 1].adjustment_pct > 0 ? 'green' : 'rust'}
        />
      </footer>
    </section>
  );
}

function NextReviewPill({ nextReview }) {
  const tone = nextReview.days_until <= 5 ? 'var(--signal-amber)' : 'var(--text-secondary)';
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      background: 'var(--surface)',
      border: `1px solid color-mix(in srgb, ${tone} 30%, var(--border-hairline))`,
      borderRadius: 999,
      fontSize: 'var(--ts-caption-size)',
    }}>
      <Calendar size={11} strokeWidth={1.6} color={tone} />
      <span style={{ color: 'var(--text-tertiary)' }}>Next review</span>
      <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
        {nextReview.iso.slice(0, 10)}
      </span>
      <span className="mono" style={{ fontSize: 10, color: tone, marginLeft: 4 }}>
        · {nextReview.days_until}d
      </span>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'green' ? 'var(--signal-green)'
              : tone === 'rust'  ? 'var(--bauxite-rust)'
              : 'var(--text)';
  return (
    <div>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-body-size)',
        fontWeight: 'var(--fw-medium)',
        color,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }} className="mono tabular">
          {sub}
        </div>
      )}
    </div>
  );
}
