/*
 * DayInReview — Phase 51.
 *
 * End-of-day close-out modal. Bookend to the morning briefing on
 * Today. Shows the operator their queue health, what they shipped,
 * what's coming back from snooze, and whether the day moved the
 * forecast.
 *
 * Composition is server-side via /api/today/closeout — this is a
 * read-only surface, no writes. Lender persona is gated out at the
 * endpoint and at the Topbar mount point.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Minus, X, Clock,
  ScrollText,
} from 'lucide-react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const HANDOVER_WRITE_ROLES = ['axis_admin', 'axis_ops'];

export default function DayInReview({ open, onClose }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWriteHandover = HANDOVER_WRITE_ROLES.includes(user?.role);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    let abort = false;
    authFetch('/api/today/closeout')
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
      .then((j) => { if (!abort) setData(j); })
      .catch((err) => { if (!abort) setError(err.message); });
    return () => { abort = true; };
  }, [open]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={680}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Day in review
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {data ? `Wrap-up for ${data.user.display_name}` : 'Composing close-out…'}
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              Where you stand before logging off.
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
            <ForecastDeltaStrip forecast={data.forecast} />
            <QueueSection queue={data.queue} navigate={navigate} onClose={onClose} />
            <ShippedSection shipped={data.shipped_today} />
            {canWriteHandover && <HandoverComposer />}
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

// ── Sections ──────────────────────────────────────────────────────

function ForecastDeltaStrip({ forecast }) {
  const delta = forecast.delta;
  const Icon = delta == null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone = delta == null ? 'var(--text-tertiary)'
             : delta > 0 ? 'var(--signal-green)'
             : delta < 0 ? 'var(--bauxite-rust)'
             : 'var(--text)';
  const todayKt    = (forecast.today_eom / 1000).toFixed(1);
  const yesterdayKt = forecast.yesterday_eom != null ? (forecast.yesterday_eom / 1000).toFixed(1) : null;

  return (
    <section style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      marginBottom: 'var(--space-4)',
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 'var(--space-4)',
      alignItems: 'center',
    }}>
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
        {yesterdayKt != null && (
          <div>yesterday <span className="tabular" style={{ color: 'var(--text-tertiary)' }}>{yesterdayKt}kt</span></div>
        )}
        <div className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)', fontSize: 14 }}>
          today {todayKt}kt
        </div>
      </div>
    </section>
  );
}

function QueueSection({ queue, navigate, onClose }) {
  const c = queue.counts;
  const total = c.overdue + c.due_next_48h + c.active + c.waking_soon;
  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Your queue
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}>
        <CountTile label="Overdue" count={c.overdue} tone="rust" />
        <CountTile label="Due ≤48h" count={c.due_next_48h} tone="amber" />
        <CountTile label="Active" count={c.active} tone="text" />
        <CountTile label="Waking soon" count={c.waking_soon} tone="amber-soft" />
      </div>

      {total === 0 ? (
        <p style={{
          margin: 0, padding: 'var(--space-3) 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          Nothing on your plate. Clean close-out.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queue.overdue.map((it) => (
            <QueueItemRow key={it.action_item_id} item={it} tone="rust" badge="Overdue" navigate={navigate} onClose={onClose} />
          ))}
          {queue.due_next_48h.map((it) => (
            <QueueItemRow key={it.action_item_id} item={it} tone="amber" badge={`Due ${formatShort(it.due_date)}`} navigate={navigate} onClose={onClose} />
          ))}
          {queue.active.map((it) => (
            <QueueItemRow key={it.action_item_id} item={it} tone="text" badge={it.due_date ? `Due ${formatShort(it.due_date)}` : 'Active'} navigate={navigate} onClose={onClose} />
          ))}
          {queue.waking_soon.map((it) => (
            <QueueItemRow key={it.action_item_id} item={it} tone="amber-soft" badge={`Wakes ${formatShort(it.snooze.until)}`} navigate={navigate} onClose={onClose} />
          ))}
        </div>
      )}
    </section>
  );
}

function CountTile({ label, count, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'amber-soft' ? 'var(--signal-amber)'
              : count === 0 ? 'var(--text-tertiary)' : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-hairline)',
      textAlign: 'center',
    }}>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size, 24px)',
        fontWeight: 'var(--fw-black)',
        color,
        lineHeight: 1.05,
      }}>
        {count}
      </div>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

function QueueItemRow({ item, tone, badge, navigate, onClose }) {
  const ai = item.action_item;
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'amber-soft' ? 'var(--signal-amber)'
              : 'var(--text-secondary)';
  const path = ai?.link?.path;
  return (
    <div
      onClick={path ? () => { onClose?.(); navigate(path); } : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        columnGap: 'var(--space-3)',
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        border: '1px solid var(--border-hairline)',
        borderLeft: `3px solid ${color}`,
        cursor: path ? 'pointer' : 'default',
        fontSize: 'var(--ts-body-sm-size)',
      }}
    >
      <span style={{
        color: 'var(--text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {ai?.body ?? '(item resolved)'}
      </span>
      <span className="mono" style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color,
        whiteSpace: 'nowrap',
      }}>
        {badge}
      </span>
    </div>
  );
}

function ShippedSection({ shipped }) {
  const types = Object.entries(shipped.by_type || {}).sort((a, b) => b[1] - a[1]);
  return (
    <section style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          What you shipped today
        </span>
        <span className="tabular" style={{
          fontSize: 'var(--ts-h3-size, 18px)',
          fontWeight: 'var(--fw-medium)',
          color: shipped.writes > 0 ? 'var(--text)' : 'var(--text-tertiary)',
        }}>
          {shipped.writes} write{shipped.writes === 1 ? '' : 's'}
        </span>
      </div>
      {shipped.writes === 0 ? (
        <p style={{
          margin: 0,
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          No writes from you today. Quiet shift.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {types.map(([type, n]) => (
              <span key={type} style={{
                padding: '3px 8px',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 999,
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-secondary)',
              }}>
                <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{n}</span>
                {' '}{type.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          {shipped.first_at && shipped.last_at && (
            <div style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
            }}>
              <Clock size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              first <span className="mono">{shipped.first_at.slice(11, 16)}</span>
              {' · '}
              last <span className="mono">{shipped.last_at.slice(11, 16)}</span>
              {' UTC'}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── Handover composer ────────────────────────────────────────────
//
// The bridge between shifts. Outgoing operator types a brief
// narrative — what's outstanding, what's been escalated, what's
// expected to land tomorrow — and the incoming shift sees it
// prominently on Today. Posted via /api/today/handover (axis_admin
// or axis_ops only). Rendered at the bottom of Day-in-Review so the
// review acts as a natural prompt to leave a note before logging
// off.
function HandoverComposer() {
  const [body, setBody]       = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted]   = useState(null);
  const [error, setError]     = useState(null);

  async function post() {
    if (!body.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const r = await authFetch('/api/today/handover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setPosted(j.handover);
      setBody('');
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <section style={{
      marginTop: 'var(--space-4)',
      paddingTop: 'var(--space-4)',
      borderTop: '1px solid var(--border-hairline)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
      }}>
        <ScrollText size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          Handover for next shift
        </span>
      </div>

      {posted ? (
        <p style={{
          margin: 0,
          padding: 'var(--space-3)',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-hairline)',
          borderLeft: '3px solid var(--signal-green)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
        }}>
          Posted. The incoming shift will see this on Today.
        </p>
      ) : (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What's outstanding? What's escalated? What lands tomorrow?"
            rows={4}
            maxLength={4000}
            disabled={posting}
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
              fontFamily: 'inherit',
              color: 'var(--text)',
              resize: 'vertical',
              lineHeight: 1.45,
              boxSizing: 'border-box',
            }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
          }}>
            <span style={{
              fontSize: 'var(--ts-caption-size)',
              color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
            }}>
              {error
                ? error
                : body.trim()
                  ? `${body.length} / 4000 — notifies the team`
                  : 'Optional. Skip if there’s nothing to hand over.'}
            </span>
            <Button
              variant="primary"
              onClick={post}
              disabled={!body.trim() || posting}
            >
              {posting ? 'Posting…' : 'Post handover'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
