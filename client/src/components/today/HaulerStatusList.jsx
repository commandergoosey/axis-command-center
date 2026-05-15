/*
 * HaulerStatusList — right column summary: one compact row per hauler.
 * Active trucks over contracted, projected month-end run-rate (Phase 44),
 * on-time % as a sub-caption, and API health dot. Row click deep-links to
 * /haulers for the full roster.
 *
 * Phase 44 — Each row now leads with the per-hauler projection. The
 * verdict tone (rust = severely lagging, amber = lagging, ink = drift,
 * green = on pace) makes it instantly readable which haulers are dragging
 * the corridor below the take-or-pay floor.
 */

import { useNavigate } from 'react-router-dom';
import ApiHealthDot from '../primitives/ApiHealthDot';

const VERDICT_TONE = {
  on_pace:           'var(--signal-green)',
  drift:             'var(--text)',
  lagging:           'var(--signal-amber)',
  severely_lagging:  'var(--bauxite-rust)',
  inactive:          'var(--text-tertiary)',
};

export default function HaulerStatusList({ haulers }) {
  const navigate = useNavigate();
  return (
    <section>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div className="eyebrow">Hauler status</div>
        <button
          onClick={() => navigate('/haulers')}
          style={{
            fontSize: 'var(--ts-caption-size)',
            letterSpacing: '0.04em',
            color: 'var(--bauxite-rust)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          Open roster →
        </button>
      </header>
      <div
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {haulers?.map((h, i) => {
          const tone = VERDICT_TONE[h.projection_verdict] ?? 'var(--text-tertiary)';
          const isActive = h.status === 'active';
          return (
            <div
              key={h.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'baseline',
                gap: 'var(--space-2)',
                padding: '10px 12px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
              }}
            >
              {/* Left: name, health, sub-line of trucks + on-time */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ApiHealthDot status={h.api_status} />
                  <span style={{
                    fontSize: 'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-medium)',
                    color: 'var(--text)',
                  }}>
                    {h.display_name}
                  </span>
                  {h.status === 'pending' && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--bauxite-rust)',
                      }}
                    >
                      Pending
                    </span>
                  )}
                </div>
                <div className="tabular" style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                  marginLeft: 18, // align with name (8px gap + 10px dot)
                }}>
                  {h.active_trucks}/{h.contracted_trucks} trucks
                  {isActive && (
                    <> · {Math.round(h.on_time_pct)}% on-time</>
                  )}
                </div>
              </div>

              {/* Right: projected EOM + verdict-toned pct */}
              <div style={{ textAlign: 'right' }}>
                {isActive ? (
                  <>
                    <div className="tabular" style={{
                      fontSize: 'var(--ts-body-sm-size)',
                      fontWeight: 'var(--fw-medium)',
                      color: tone,
                    }}>
                      {h.projected_pct_contracted.toFixed(0)}%
                    </div>
                    <div className="tabular" style={{
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                      marginTop: 2,
                    }}>
                      {(h.projected_eom_tonnes / 1000).toFixed(1)}kt EOM
                    </div>
                  </>
                ) : (
                  <span style={{
                    fontSize: 'var(--ts-body-sm-size)',
                    color: 'var(--text-tertiary)',
                  }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
