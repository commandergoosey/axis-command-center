/*
 * CommentsThread — Phase 57.
 *
 * Inline comment thread for an action item. Operators add progress
 * notes, see prior comments by author + timestamp. The author or an
 * axis_admin can delete a comment.
 *
 * Loaded lazily — the parent only mounts this when the operator
 * expands the toggle, so the Today page doesn't fetch threads it
 * isn't going to show.
 */

import { useEffect, useRef, useState } from 'react';
import { Trash2, Send } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

export default function CommentsThread({ itemId, initialCount, onChange }) {
  const { user } = useAuth();
  const [comments, setComments] = useState(null);  // null = loading
  const [draft, setDraft]       = useState('');
  const [error, setError]       = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  const load = async () => {
    try {
      const r = await authFetch(`/api/today/action-items/${itemId}/comments`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setComments(j.comments ?? []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [itemId]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    const body = draft.trim();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await authFetch(`/api/today/action-items/${itemId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setDraft('');
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (commentId) => {
    try {
      const r = await authFetch(`/api/today/action-items/${itemId}/comments/${commentId}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      style={{
        marginTop: 6,
        paddingTop: 6,
        borderTop: '1px dashed var(--border-hairline)',
        background: 'var(--surface)',
        margin: '6px -4px -4px',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-sm)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Existing comments */}
      {comments === null ? (
        <p style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', margin: 0 }}>
          Loading thread…
        </p>
      ) : comments.length === 0 ? (
        <p style={{
          margin: '0 0 var(--space-3)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          No comments yet — log progress so the next person on the desk has context.
        </p>
      ) : (
        <ul style={{
          margin: '0 0 var(--space-3)',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {comments.map((c) => (
            <li
              key={c.id}
              style={{
                fontSize: 'var(--ts-caption-size)',
                lineHeight: 1.45,
                paddingBottom: 6,
                borderBottom: '1px solid var(--border-hairline)',
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 8,
              }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 'var(--fw-medium)' }}>
                  {c.author.display_name}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono tabular" style={{
                    fontSize: 10, color: 'var(--text-tertiary)',
                  }}>
                    {fmtTime(c.created_at)}
                  </span>
                  {(user?.role === 'axis_admin' || c.author.user_id === user?.id) && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      title="Delete comment"
                      style={{
                        padding: 2, background: 'transparent', border: 'none',
                        cursor: 'pointer', color: 'var(--text-tertiary)',
                      }}
                    >
                      <Trash2 size={11} strokeWidth={1.6} />
                    </button>
                  )}
                </span>
              </div>
              <div style={{ color: 'var(--text)', marginTop: 2 }}>{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      {/* Compose */}
      <form onSubmit={submit} style={{ display: 'flex', gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a progress note…"
          maxLength={2000}
          style={{
            flex: 1,
            padding: '4px 8px',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={submitting || !draft.trim()}
          title="Post"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: draft.trim() ? 'var(--bauxite-rust)' : 'var(--surface-raised)',
            color: draft.trim() ? 'var(--bone)' : 'var(--text-tertiary)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            cursor: draft.trim() ? 'pointer' : 'default',
            fontSize: 'var(--ts-caption-size)',
            fontFamily: 'inherit',
          }}
        >
          <Send size={11} strokeWidth={1.8} />
          Post
        </button>
      </form>

      {error && (
        <div style={{
          marginTop: 6,
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--bauxite-rust)',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day:    '2-digit',
    month:  'short',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';
}
