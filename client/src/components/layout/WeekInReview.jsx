/*
 * WeekInReview — Phase 68.
 *
 * Zoom-out from the daily cockpit. The morning briefing on Today
 * is the operator's "what just changed since yesterday" view; the
 * Day-in-Review is "what did I ship today." This modal answers
 * the longer arc: how did the week land?
 *
 * Composition is server-side via /api/today/week — a pure read
 * surface. All roles can open it (lender included; this is the
 * kind of summary they'd want for a Friday update).
 *
 * Sections:
 *   1. Tonnage — delivered this week + forecast trajectory bars
 *   2. Action item flow — opened / closed / escalated tiles
 *   3. Top themes — what entity types the operator spent time on
 *   4. Haulers — winners + strugglers, attainment-ranked
 */

import { useEffect, useState } from 'react';
import {
  X, TrendingUp, TrendingDown, Minus, ArrowUpRight,
  CheckCircle2, AlertTriangle, MessagesSquare,
} from 'lucide-react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { authFetch } from '../../lib/auth';

export default function WeekInReview({ open, onClose }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    let abort = false;
    authFetch('/api/today/week')
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
      .then((j) => { if (!abort) setData(j); })
      .catch((err) => { if (!abort) setError(err.message); });
    return () => { abort = true; };
  }, [open]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={760}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Week in review
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {data ? formatPeriod(data.period) : 'Composing weekly synthesis…'}
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              How the corridor moved across the last seven days.
            </p>
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
          <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-body-sm-size)' }}>
            {error}
          </p>
        )}

        {data && (
          <>
            <TonnageSection tonnage={data.tonnage} />
            <ActionsSection actions={data.actions} />
            <ThemesSection themes={data.themes} />
            <HaulersSection haulers={data.haulers} />
          </>
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

// ── Tonnage ───────────────────────────────────────────────────────

function TonnageSection({ tonnage }) {
  const points = tonnage.points || [];
  const delta = tonnage.forecast_delta;
  const tone = delta == null ? 'var(--text-tertiary)'
             : delta > 0 ? 'var(--signal-green)'
             : delta < 0 ? 'var(--bauxite-rust)'
             : 'var(--text)';
  const Icon = delta == null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  // Simple bar chart for projected EOM trajectory.
  const max = Math.max(...points.map((p) => p.eom_tonnes), 1);
  const min = Math.min(...points.map((p) => p.eom_tonnes), max);
  const range = Math.max(max - min, 1);

  return (
    <section style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      marginBottom: 'var(--space-4)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 'var(--space-4)', alignItems: 'center' }}>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Forecast moved
          </div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h2-size, 24px)',
            fontWeight: 'var(--fw-black)',
            color: tone,
            lineHeight: 1.05,
          }}>
            {delta == null
              ? '—'
              : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toLocaleString()} t`}
          </div>
        </div>
        <div style={{ textAlign: 'center', color: tone }}>
          <Icon size={24} strokeWidth={1.6} />
        </div>
        <div style={{ textAlign: 'right', fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          {tonnage.delivered_in_week != null && (
            <div>
              delivered this week{' '}
              <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)', fontSize: 14 }}>
                {(tonnage.delivered_in_week / 1000).toFixed(1)}kt
              </span>
            </div>
          )}
          <div>
            <span className="tabular" style={{ color: 'var(--text-tertiary)' }}>
              {(tonnage.forecast_start / 1000).toFixed(1)}kt
            </span>
            {' → '}
            <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
              {(tonnage.forecast_end / 1000).toFixed(1)}kt
            </span>
          </div>
        </div>
      </div>

      {points.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${points.length}, 1fr)`,
            alignItems: 'flex-end',
            gap: 4,
            height: 60,
          }}>
            {points.map((p) => {
              const heightPct = 25 + 70 * ((p.eom_tonnes - min) / range);
              const verdictTone = p.verdict === 'on_pace_or_above' ? 'var(--signal-green)'
                              : p.verdict === 'below_floor_at_pace' ? 'var(--signal-amber)'
                              : 'var(--bauxite-rust)';
              return (
                <div key={p.date} style={{
                  height: `${heightPct}%`,
                  background: verdictTone,
                  opacity: 0.85,
                  borderRadius: 1,
                }} title={`${p.date}: ${(p.eom_tonnes / 1000).toFixed(1)}kt EOM (${p.verdict.replace(/_/g, ' ')})`} />
              );
            })}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${points.length}, 1fr)`,
            gap: 4,
            marginTop: 4,
            fontSize: 9,
            color: 'var(--text-tertiary)',
          }} className="mono tabular">
            {points.map((p) => (
              <div key={p.date} style={{ textAlign: 'center' }}>
                {p.date.slice(5).replace('-', '/')}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Actions ───────────────────────────────────────────────────────

function ActionsSection({ actions }) {
  const tiles = [
    { label: 'Opened',    value: actions.opened,    icon: ArrowUpRight,   tone: 'text' },
    { label: 'Closed',    value: actions.closed,    icon: CheckCircle2,   tone: actions.closed > 0 ? 'green' : 'tertiary' },
    { label: 'Escalated', value: actions.escalated, icon: AlertTriangle,  tone: actions.escalated > 0 ? 'rust' : 'tertiary' },
    { label: 'Comments',  value: actions.commented, icon: MessagesSquare, tone: 'tertiary' },
  ];
  const netTone = actions.net > 0 ? 'var(--bauxite-rust)'
                : actions.net < 0 ? 'var(--signal-green)'
                : 'var(--text-tertiary)';
  const netLabel = actions.net > 0 ? `${actions.net} more opened than closed`
                 : actions.net < 0 ? `${Math.abs(actions.net)} more closed than opened`
                 : 'opens balanced closes';

  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 8,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          Action item flow
        </span>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: netTone }}>
          {netLabel}
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        {tiles.map((t) => (
          <ActionTile key={t.label} {...t} />
        ))}
      </div>
    </section>
  );
}

function ActionTile({ label, value, icon: Icon, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-hairline)',
      textAlign: 'center',
    }}>
      <div style={{ color, marginBottom: 4 }}>
        <Icon size={14} strokeWidth={1.6} />
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size, 24px)',
        fontWeight: 'var(--fw-black)',
        color: value === 0 ? 'var(--text-tertiary)' : color,
        lineHeight: 1.05,
      }}>
        {value}
      </div>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

// ── Themes ────────────────────────────────────────────────────────

function ThemesSection({ themes }) {
  if (!themes || themes.length === 0) return null;
  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Top themes this week
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {themes.map((t) => (
          <span key={t.entity_type} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            background: 'var(--surface)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 999,
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
          }}>
            <span className="tabular" style={{
              color: 'var(--text)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {t.count}
            </span>
            <span style={{ textTransform: 'lowercase' }}>{t.label}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

// ── Haulers ───────────────────────────────────────────────────────

function HaulersSection({ haulers }) {
  const empty = haulers.winners.length === 0 && haulers.strugglers.length === 0;
  return (
    <section style={{ marginBottom: 'var(--space-3)' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Haulers — month-to-date attainment
      </div>
      {empty ? (
        <p style={{
          margin: 0, fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)', fontStyle: 'italic',
        }}>
          No active hauler data this week.
        </p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-3)',
        }}>
          <HaulerColumn title="Winners" tone="green" haulers={haulers.winners} />
          <HaulerColumn title="Strugglers" tone="rust" haulers={haulers.strugglers} />
        </div>
      )}
    </section>
  );
}

function HaulerColumn({ title, tone, haulers }) {
  const color = tone === 'green' ? 'var(--signal-green)' : 'var(--bauxite-rust)';
  return (
    <div>
      <div className="micro" style={{ color, marginBottom: 6, letterSpacing: '0.06em' }}>
        {title.toUpperCase()}
      </div>
      {haulers.length === 0 ? (
        <p style={{
          margin: 0, padding: '8px 12px',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          {tone === 'green' ? 'No haulers above floor.' : 'No haulers below floor.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {haulers.map((h) => (
            <div key={h.hauler_id} style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              columnGap: 8,
              alignItems: 'center',
              padding: '6px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderLeft: `3px solid ${color}`,
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
            }}>
              <span style={{ color: 'var(--text)' }}>{h.display_name}</span>
              <span className="mono tabular" style={{
                fontSize: 10, color: 'var(--text-tertiary)',
              }}>
                {h.active_trucks}/{h.contracted_trucks}
              </span>
              <span className="tabular" style={{
                fontWeight: 'var(--fw-medium)', color,
              }}>
                {h.attainment_pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function formatPeriod(period) {
  const start = new Date(period.start);
  const end   = new Date(period.end);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return `${fmt(start)} → ${fmt(end)}`;
}
