/*
 * Handovers — Phase 93.
 *
 * Dedicated shift-continuity log. Today shows only the latest
 * handover note; this page surfaces the full history and lets any
 * axis_admin or axis_ops operator compose a note at any time —
 * not just at end-of-day via DayInReview.
 *
 * Routes (today.js):
 *   GET    /api/today/handover?limit=50   — recent list (newest first)
 *   POST   /api/today/handover            — create (axis_admin, axis_ops)
 *   DELETE /api/today/handover/:id        — delete (axis_admin only)
 *
 * Role access: axis_admin (wildcard) + axis_ops. Hauler admins and
 * lenders don't see this page — it's internal AXIS shift continuity.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Trash2, ScrollText, PenLine } from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import HandoverActivityChart from '../components/handovers/HandoverActivityChart';

/* ── Role display ────────────────────────────────────────────────── */

const ROLE_META = {
  axis_admin: { label: 'AXIS Admin', color: 'var(--bauxite-rust)' },
  axis_ops:   { label: 'AXIS Ops',   color: 'var(--bauxite-rust)' },
};

/* ── Time helpers ────────────────────────────────────────────────── */

function formatRelative(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatFull(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Africa/Accra',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

/* ── Stat helpers ────────────────────────────────────────────────── */

function countThisWeek(notes) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  return notes.filter((n) => new Date(n.created_at) > cutoff).length;
}

function lastPostedLabel(notes) {
  if (notes.length === 0) return '—';
  return formatRelative(notes[0].created_at);
}

function hoursSinceLast(notes) {
  if (notes.length === 0) return null;
  const diff = Date.now() - new Date(notes[0].created_at).getTime();
  return Math.round(diff / 3_600_000);
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Page                                                             */
/* ══════════════════════════════════════════════════════════════════ */

export default function Handovers() {
  const { user } = useAuth();
  const canWrite  = user?.role === 'axis_admin' || user?.role === 'axis_ops';
  const canDelete = user?.role === 'axis_admin';

  const [notes,   setNotes]   = useState([]);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const [body,        setBody]        = useState('');
  const [posting,     setPosting]     = useState(false);
  const [postErr,     setPostErr]     = useState(null);
  const [deleteId,    setDeleteId]    = useState(null);
  const [prefilling,  setPrefilling]  = useState(false); // Phase 121
  const [aiDrafted,   setAiDrafted]   = useState(false); // Phase 137

  const textareaRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/today/handover?limit=50');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setNotes(j.handovers ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Compose ───────────────────────────────────────────────────── */

  async function handlePost() {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 4000) return;
    setPosting(true);
    setPostErr(null);
    try {
      const r = await authFetch('/api/today/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setBody('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      await load();
    } catch (err) {
      setPostErr(err.message);
    } finally {
      setPosting(false);
    }
  }

  /* ── Delete ────────────────────────────────────────────────────── */

  async function handleDelete(id) {
    try {
      const r = await authFetch(`/api/today/handover/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      /* Swallow — reload will reconcile */
    } finally {
      setDeleteId(null);
      await load();
    }
  }

  /* ── Phase 121 — pre-fill from live convoy data ───────────────── */

  async function handlePrefill() {
    setPrefilling(true);
    try {
      const r = await authFetch('/api/today/handover-brief');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.ai_drafted) setAiDrafted(true);
      setBody((prev) => {
        const prefix = j.brief ?? '';
        return prev.trim() ? `${prefix}\n\n${prev}` : prefix;
      });
      // Trigger auto-grow on the textarea.
      setTimeout(() => {
        const t = textareaRef.current;
        if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
      }, 0);
    } catch { /* silent */ }
    finally { setPrefilling(false); }
  }

  /* ── Auto-grow textarea ────────────────────────────────────────── */

  function onBodyChange(e) {
    setBody(e.target.value);
    if (!e.target.value.trim()) setAiDrafted(false);
    const t = e.target;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }

  /* ── KPI strip ─────────────────────────────────────────────────── */

  const thisWeek   = countThisWeek(notes);
  const lastPosted = lastPostedLabel(notes);
  const sinceH     = hoursSinceLast(notes);
  const stale      = sinceH !== null && sinceH > 12;

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <PageShell
      eyebrow="Operations"
      title="Handovers"
      description="Shift-continuity log. Each outgoing operator posts a brief for the incoming shift — what's outstanding, what's been escalated, what lands tomorrow. The incoming shift sees the latest note on Today; the full history lives here."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {/* ── KPI strip ─────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--space-3)',
        }}>
          <KpiTile
            label="This week"
            value={loading ? '—' : String(thisWeek)}
            sub="handovers posted"
          />
          <KpiTile
            label="Last handover"
            value={loading ? '—' : lastPosted}
            sub={notes.length > 0 ? formatFull(notes[0]?.created_at) : 'None yet'}
            warn={stale}
          />
          <KpiTile
            label="Total in log"
            value={loading ? '—' : String(notes.length)}
            sub="(cap 50 shown)"
          />
          <KpiTile
            label="Gap since last"
            value={sinceH === null ? '—' : `${sinceH}h`}
            sub={stale ? 'Shift continuity gap' : 'Within shift window'}
            warn={stale}
          />
        </div>

        {/* Phase 181 — handover posting frequency (8-week) */}
        <HandoverActivityChart notes={notes} />

        {/* ── Composer ──────────────────────────────────────────── */}
        {canWrite && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="eyebrow">Post handover</div>
                {/* Phase 137 — AI-drafted badge */}
                {aiDrafted && (
                  <span className="mono" style={{
                    fontSize: 9,
                    padding: '2px 7px',
                    background: 'rgba(74,222,128,0.08)',
                    border: '1px solid rgba(74,222,128,0.3)',
                    borderRadius: 3,
                    color: 'var(--signal-green)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}>
                    AI DRAFTED
                  </span>
                )}
              </div>
              {/* Phase 121 / Phase 137 — pre-fill from live data */}
              <button
                type="button"
                onClick={handlePrefill}
                disabled={prefilling}
                style={{
                  fontSize: 'var(--ts-caption-size)',
                  padding: '3px 10px',
                  background: 'none',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                  cursor: prefilling ? 'wait' : 'pointer',
                }}
              >
                {prefilling ? 'Drafting…' : 'AI draft from live data'}
              </button>
            </div>
            <div style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
            }}>
              <textarea
                ref={textareaRef}
                value={body}
                onChange={onBodyChange}
                placeholder={
                  'What\'s outstanding? What did you escalate? What lands on the next shift?\n\n' +
                  'Keep it to the facts — this is the first thing the incoming operator reads.'
                }
                rows={4}
                style={{
                  width: '100%',
                  resize: 'none',
                  background: 'var(--surface)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)',
                  fontSize: 'var(--ts-body-sm-size)',
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                  lineHeight: 1.7,
                  minHeight: 96,
                  boxSizing: 'border-box',
                  outline: 'none',
                  overflow: 'hidden',
                }}
              />

              {postErr && (
                <div style={{
                  marginTop: 'var(--space-2)',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--bauxite-rust)',
                }}>
                  {postErr}
                </div>
              )}

              <div style={{
                marginTop: 'var(--space-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: body.length > 3800 ? 'var(--signal-amber)' : 'var(--text-tertiary)',
                }}>
                  {body.length}/4,000 · Posted as {user?.display_name}
                </span>
                <button
                  type="button"
                  onClick={handlePost}
                  disabled={posting || !body.trim() || body.length > 4000}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    background: (posting || !body.trim() || body.length > 4000)
                      ? 'var(--surface)'
                      : 'var(--bauxite-rust)',
                    color: (posting || !body.trim() || body.length > 4000)
                      ? 'var(--text-tertiary)'
                      : '#fff',
                    border: '1px solid var(--border-hairline)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--ts-body-sm-size)',
                    fontWeight: 'var(--fw-medium)',
                    cursor: (posting || !body.trim() || body.length > 4000)
                      ? 'not-allowed'
                      : 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 120ms ease, color 120ms ease',
                  }}
                >
                  <PenLine size={12} strokeWidth={1.6} />
                  {posting ? 'Posting…' : 'Post handover'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Log ───────────────────────────────────────────────── */}
        <section>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
            Handover log · {loading ? '…' : notes.length}
          </div>

          {error && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--surface-raised)',
              border: '1px solid var(--signal-amber)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text)',
              fontSize: 'var(--ts-body-sm-size)',
              marginBottom: 'var(--space-3)',
            }}>
              Handover feed unavailable — {error}
            </div>
          )}

          {!loading && !error && notes.length === 0 && (
            <EmptyState canWrite={canWrite} />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {notes.map((note, idx) => (
              <HandoverCard
                key={note.id}
                note={note}
                isLatest={idx === 0}
                canDelete={canDelete}
                confirmId={deleteId}
                onDeleteRequest={(id) => setDeleteId(id)}
                onDeleteConfirm={handleDelete}
                onDeleteCancel={() => setDeleteId(null)}
              />
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────────── */

function KpiTile({ label, value, sub, warn }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: `1px solid ${warn ? 'var(--signal-amber)' : 'var(--border-hairline)'}`,
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div className="eyebrow" style={{
        color: warn ? 'var(--signal-amber)' : 'var(--text-tertiary)',
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--ts-h3-size)',
        fontWeight: 'var(--fw-semibold)',
        color: warn ? 'var(--signal-amber)' : 'var(--text)',
        letterSpacing: '-0.01em',
        lineHeight: 1.1,
        marginBottom: 4,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── HandoverCard ─────────────────────────────────────────────────── */

function HandoverCard({
  note, isLatest,
  canDelete, confirmId,
  onDeleteRequest, onDeleteConfirm, onDeleteCancel,
}) {
  const isConfirming = confirmId === note.id;
  const role = note.author?.role;
  const meta = ROLE_META[role] || { label: role || 'Unknown', color: 'var(--text-secondary)' };

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderLeft: `3px solid ${isLatest ? 'var(--bauxite-rust)' : 'var(--border-soft)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginBottom: 'var(--space-3)',
        flexWrap: 'wrap',
        rowGap: 6,
      }}>
        {isLatest && (
          <span className="mono" style={{
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'var(--bauxite-rust)',
            padding: '2px 6px',
            background: 'rgba(139,46,26,0.08)',
            borderRadius: 3,
          }}>
            LATEST
          </span>
        )}

        <span style={{
          fontSize: 'var(--ts-body-sm-size)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          {note.author?.display_name || 'Unknown'}
        </span>

        <span className="mono" style={{
          fontSize: 9,
          letterSpacing: '0.08em',
          color: meta.color,
          padding: '2px 6px',
          background: `${meta.color}1a`,
          borderRadius: 3,
        }}>
          {meta.label}
        </span>

        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          color: 'var(--text-tertiary)',
          fontSize: 'var(--ts-caption-size)',
          flexShrink: 0,
        }}>
          <Clock size={10} strokeWidth={1.5} />
          <span>{formatRelative(note.created_at)}</span>
          <span aria-hidden="true" style={{ color: 'var(--border-soft)' }}>·</span>
          <span title={formatFull(note.created_at)}>{formatFull(note.created_at)}</span>
        </div>

        {canDelete && !isConfirming && (
          <button
            type="button"
            onClick={() => onDeleteRequest(note.id)}
            title="Delete this handover"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        lineHeight: 1.75,
        whiteSpace: 'pre-wrap',
      }}>
        {note.body}
      </div>

      {/* Delete confirmation */}
      {isConfirming && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'rgba(139,46,26,0.04)',
          border: '1px solid rgba(139,46,26,0.2)',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}>
          <span style={{
            flex: 1,
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
            minWidth: 220,
          }}>
            Delete this handover note? This cannot be undone.
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={() => onDeleteConfirm(note.id)}
              style={{
                padding: '6px 14px',
                background: 'var(--bauxite-rust)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              style={{
                padding: '6px 14px',
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────── */

function EmptyState({ canWrite }) {
  return (
    <div style={{
      padding: 'var(--space-6) var(--space-5)',
      textAlign: 'center',
      background: 'var(--surface-raised)',
      border: '1px dashed var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
    }}>
      <ScrollText
        size={24}
        strokeWidth={1.2}
        color="var(--text-tertiary)"
        style={{ marginBottom: 'var(--space-3)' }}
      />
      <div className="eyebrow" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
        No handovers yet
      </div>
      <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
        {canWrite
          ? 'Post the first shift handover above. Incoming operators see the latest note on Today.'
          : 'No shift handovers have been posted yet.'}
      </div>
    </div>
  );
}
