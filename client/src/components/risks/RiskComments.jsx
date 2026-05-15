/*
 * RiskComments — Phase 77.
 *
 * Append-only narrative thread for a risk. Mounted alongside
 * Phase 74's MitigationSteps inside the expanded risk row.
 * Comments are timestamped, authored, role-tagged, and kept
 * across shift changes — they're how a risk's evolution gets
 * captured in the cockpit.
 *
 * Read open to all roles; write restricted to axis_admin /
 * axis_ops (matches the parent risk's gate). Authors and admins
 * can delete their own comments.
 */

import { useCallback, useEffect, useState } from 'react';
import { Send, Trash2, MessageSquare } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function RiskComments({ riskId, summary, onChange }) {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const isAdmin  = user?.role === 'axis_admin';
  const [comments, setComments] = useState(null);
  const [error, setError]       = useState(null);
  const [draft, setDraft]       = useState('');
  const [posting, setPosting]   = useState(false);

  const load = useCallback(() => {
    setError(null);
    authFetch(`/api/risks/${riskId}/comments`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setComments(j.comments || []))
      .catch((err) => setError(err.message));
  }, [riskId]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); onChange?.(); };

  async function post() {
    if (!draft.trim() || posting) return;
    setPosting(true); setError(null);
    try {
      const r = await authFetch(`/api/risks/${riskId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: draft }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setDraft('');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally { setPosting(false); }
  }

  async function remove(c) {
    if (!confirm('Delete this comment?')) return;
    const r = await authFetch(`/api/risks/${riskId}/comments/${c.id}`, { method: 'DELETE' });
    if (r.ok) refresh();
  }

  return (
    <div style={{
      padding: 'var(--space-3) 0 var(--space-3) var(--space-4)',
      borderTop: '1px dashed var(--border-hairline)',
    }}>
      <div className="micro" style={{
        color: 'var(--text-tertiary)',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <MessageSquare size={11} strokeWidth={1.6} />
        DISCUSSION
        {summary?.count > 0 && (
          <span style={{ marginLeft: 4, color: 'var(--text-secondary)' }}>
            · {summary.count} comment{summary.count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-caption-size)' }}>{error}</p>
      )}

      {comments == null ? (
        <p style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : comments.length === 0 ? (
        <p style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
          margin: '0 var(--space-4) 8px 0',
        }}>
          No discussion yet. {canWrite ? 'Add the first update — what changed today?' : ''}
        </p>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginRight: 'var(--space-4)',
          marginBottom: 8,
        }}>
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              canDelete={isAdmin || c.author?.user_id === user?.id}
              onDelete={() => remove(c)}
            />
          ))}
        </div>
      )}

      {canWrite && (
        <div style={{
          marginRight: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 8,
          alignItems: 'flex-start',
        }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What changed? Who said what? Add an update…"
            rows={2}
            maxLength={2000}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={post}
            disabled={!draft.trim() || posting}
            style={{
              ...primaryBtnStyle,
              opacity: !draft.trim() || posting ? 0.55 : 1,
              cursor: !draft.trim() || posting ? 'not-allowed' : 'pointer',
            }}
          >
            <Send size={11} strokeWidth={1.8} />
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}
    </div>
  );
}

function CommentRow({ comment, canDelete, onDelete }) {
  const ts = relTime(comment.created_at);
  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderLeft: '3px solid var(--bauxite-rust)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 4,
        fontSize: 'var(--ts-caption-size)',
      }}>
        <span>
          <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
            {comment.author?.display_name ?? 'Unknown'}
          </span>
          <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
            <span className="mono">{ts}</span>
          </span>
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Delete comment"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              lineHeight: 0,
            }}
          >
            <Trash2 size={11} strokeWidth={1.6} />
          </button>
        )}
      </div>
      <p style={{
        margin: 0,
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}>
        {comment.body}
      </p>
    </div>
  );
}

function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60)  return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14)    return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

const inputStyle = {
  padding: '6px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  boxSizing: 'border-box',
  width: '100%',
  resize: 'vertical',
};
const primaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--bauxite-rust)',
  border: '1px solid var(--bauxite-rust)',
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'white',
  fontFamily: 'inherit',
};
