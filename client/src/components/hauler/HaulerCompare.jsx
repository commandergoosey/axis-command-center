/*
 * HaulerCompare — Phase 65.
 *
 * Side-by-side comparison modal for 2-4 haulers. Pulls a thin slice
 * of metrics per hauler in one round trip via /api/haulers/compare,
 * then renders columns that operators can scan vertically (forecast
 * row, lifecycle row, fleet row, audit row).
 *
 * Visual: each hauler is a column. Rows are categories. Cells render
 * with verdict-aware tone (rust for severely_lagging, amber for
 * lagging, green for on_pace, etc.) so the worst performer reads at
 * a glance.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { authFetch } from '../../lib/auth';

const VERDICT_TONE = {
  on_pace:           'var(--signal-green)',
  drift:             'var(--text)',
  lagging:           'var(--signal-amber)',
  severely_lagging:  'var(--bauxite-rust)',
  inactive:          'var(--text-tertiary)',
};
const VERDICT_LABEL = {
  on_pace:           'On pace',
  drift:             'Drift',
  lagging:           'Lagging',
  severely_lagging:  'Severely lagging',
  inactive:          'Inactive',
};

export default function HaulerCompare({ open, haulerIds, onClose }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !haulerIds || haulerIds.length < 2) return;
    setData(null); setError(null);
    let abort = false;
    const ids = haulerIds.join(',');
    authFetch(`/api/haulers/compare?ids=${encodeURIComponent(ids)}`)
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || `HTTP ${r.status}`))))
      .then((j) => { if (!abort) setData(j); })
      .catch((err) => { if (!abort) setError(err.message); });
    return () => { abort = true; };
  }, [open, haulerIds]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={Math.min(860, 280 + 200 * (haulerIds?.length ?? 2))}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Hauler comparison</div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {haulerIds.length} haulers · side by side
            </h2>
            {data?.horizon && (
              <p style={{
                margin: '4px 0 0',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text-secondary)',
              }}>
                {data.horizon.days_elapsed}/{data.horizon.days_in_month} days elapsed ·{' '}
                <span className="tabular">{data.horizon.days_remaining}</span> remaining
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: 4, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-tertiary)',
            }}
          >
            <X size={18} />
          </button>
        </header>

        {error && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(139, 46, 26, 0.08)',
            color: 'var(--bauxite-rust)',
            fontSize: 'var(--ts-caption-size)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-3)',
          }}>
            {error}
          </div>
        )}

        {!data ? (
          <p style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            Composing comparison…
          </p>
        ) : (
          <ComparisonGrid haulers={data.haulers} />
        )}

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function ComparisonGrid({ haulers }) {
  // Skip missing rows (defensive — server returns { id, missing } when
  // it can't resolve an ID).
  const valid = haulers.filter((h) => !h.missing);
  if (valid.length === 0) return null;

  // Identify the worst forecast verdict so we can highlight it.
  const verdictRank = { on_pace: 0, drift: 1, lagging: 2, severely_lagging: 3, inactive: 4 };
  const worst = [...valid].sort((a, b) => (verdictRank[b.forecast?.verdict] ?? 0) - (verdictRank[a.forecast?.verdict] ?? 0))[0];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `140px repeat(${valid.length}, minmax(0, 1fr))`,
      columnGap: 0,
      rowGap: 0,
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header row — empty corner + hauler names */}
      <div />
      {valid.map((h) => (
        <div key={h.id} style={{
          padding: 'var(--space-3) var(--space-4)',
          borderLeft: '1px solid var(--border-hairline)',
          borderBottom: '1px solid var(--border-hairline)',
          background: h.id === worst?.id ? 'rgba(162, 62, 35, 0.04)' : 'var(--surface)',
        }}>
          <div style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {h.display_name}
          </div>
          <div className="mono" style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
            marginTop: 2,
          }}>
            {h.id}
          </div>
        </div>
      ))}

      {/* Section: Fleet */}
      <SectionLabel>Fleet</SectionLabel>
      {valid.map((h) => (
        <Cell key={h.id} hauler={h}>
          <Tabular>{h.active_trucks}/{h.contracted_trucks}</Tabular>
          <Sub>active / contracted</Sub>
        </Cell>
      ))}

      {/* MTD tonnes */}
      <SectionLabel>Tonnes MTD</SectionLabel>
      {valid.map((h) => (
        <Cell key={h.id} hauler={h}>
          <Tabular>{h.tonnes_delivered_mtd.toLocaleString()}</Tabular>
          <Sub>of {h.tonnes_contracted_mtd.toLocaleString()} contracted</Sub>
        </Cell>
      ))}

      {/* On-time */}
      <SectionLabel>On-time</SectionLabel>
      {valid.map((h) => {
        const pct = h.on_time_pct;
        const tone = pct == null ? null : pct < 85 ? 'rust' : pct < 92 ? 'amber' : 'green';
        return (
          <Cell key={h.id} hauler={h}>
            <Tabular tone={tone}>{pct == null ? '—' : `${Math.round(pct)}%`}</Tabular>
          </Cell>
        );
      })}

      {/* Forecast verdict */}
      <SectionLabel>Forecast</SectionLabel>
      {valid.map((h) => {
        const v = h.forecast?.verdict;
        const tone = VERDICT_TONE[v] ?? 'var(--text)';
        return (
          <Cell key={h.id} hauler={h}>
            <div className="tabular" style={{
              fontSize: 'var(--ts-h3-size, 18px)',
              fontWeight: 'var(--fw-medium)',
              color: tone,
            }}>
              {h.forecast?.projected_pct_contracted != null
                ? `${h.forecast.projected_pct_contracted.toFixed(0)}%`
                : '—'}
            </div>
            <Sub style={{ color: tone }}>{VERDICT_LABEL[v] ?? '—'}</Sub>
          </Cell>
        );
      })}

      {/* Projected EOM */}
      <SectionLabel>Projected EOM</SectionLabel>
      {valid.map((h) => (
        <Cell key={h.id} hauler={h}>
          <Tabular>
            {h.forecast?.projected_eom != null
              ? `${(h.forecast.projected_eom / 1000).toFixed(1)} kt`
              : '—'}
          </Tabular>
        </Cell>
      ))}

      {/* HSE */}
      <SectionLabel>HSE · 30d</SectionLabel>
      {valid.map((h) => {
        const open = h.lifecycle.hse_open;
        return (
          <Cell key={h.id} hauler={h}>
            <Tabular tone={open > 0 ? 'amber' : null}>
              {open} open · {h.lifecycle.hse_closed_30d} closed
            </Tabular>
          </Cell>
        );
      })}

      {/* Coaching */}
      <SectionLabel>Coaching · 30d</SectionLabel>
      {valid.map((h) => (
        <Cell key={h.id} hauler={h}>
          <Tabular>{h.lifecycle.coaching_30d} session{h.lifecycle.coaching_30d === 1 ? '' : 's'}</Tabular>
        </Cell>
      ))}

      {/* Licences */}
      <SectionLabel>Licences</SectionLabel>
      {valid.map((h) => {
        const exp = h.lifecycle.licences_expiring_30d;
        return (
          <Cell key={h.id} hauler={h}>
            <Tabular tone={exp > 0 ? 'amber' : null}>
              {exp} expiring ≤30d
            </Tabular>
            <Sub>{h.lifecycle.licences_renewed_30d} renewed</Sub>
          </Cell>
        );
      })}

      {/* Open alerts */}
      <SectionLabel>Open alerts</SectionLabel>
      {valid.map((h) => (
        <Cell key={h.id} hauler={h} isLast>
          <Tabular tone={h.open_alerts > 0 ? 'amber' : null}>{h.open_alerts}</Tabular>
        </Cell>
      ))}

      {/* Audit (if available) */}
      {valid.every((h) => h.audit_count_30d != null) && (
        <>
          <SectionLabel isLast>Audit · 30d</SectionLabel>
          {valid.map((h, i) => (
            <Cell key={h.id} hauler={h} isLast lastCell={i === valid.length - 1}>
              <Tabular>{h.audit_count_30d} writes</Tabular>
            </Cell>
          ))}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children, isLast }) {
  return (
    <div className="micro" style={{
      padding: 'var(--space-3) var(--space-4)',
      color: 'var(--text-tertiary)',
      borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
      background: 'var(--surface)',
      display: 'flex',
      alignItems: 'center',
    }}>
      {children}
    </div>
  );
}

function Cell({ children, isLast, lastCell }) {
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      borderLeft: '1px solid var(--border-hairline)',
      borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
      borderRight: lastCell ? 'none' : 'none',
    }}>
      {children}
    </div>
  );
}

function Tabular({ children, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : 'var(--text)';
  return (
    <div className="tabular" style={{
      fontSize: 'var(--ts-body-size)',
      fontWeight: 'var(--fw-medium)',
      color,
    }}>
      {children}
    </div>
  );
}

function Sub({ children, style }) {
  return (
    <div style={{
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text-tertiary)',
      marginTop: 2,
      ...style,
    }}>
      {children}
    </div>
  );
}
