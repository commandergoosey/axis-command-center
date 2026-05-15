/*
 * IntelligenceInput — Charcoal chrome, Bauxite Rust accent at the left edge.
 * Phase 7: hits /api/intelligence/chat and displays the model reply, with
 * per-page suggestion chips fetched from /api/intelligence/observe. When
 * the server reports demonstration mode (no API key), the input still
 * works against the fallback fixtures.
 *
 * No gradient avatars. No "Powered by Claude". Per BRIEF.md §12.3.
 */

import { authFetch } from '../../lib/auth';

import { useState, useRef, useEffect } from 'react';
import { Sparkle, X } from 'lucide-react';

export default function IntelligenceInput({ page = 'today', chips = [], mode }) {
  const [query,   setQuery]   = useState('');
  const [thread,  setThread]  = useState([]);
  const [loading, setLoading] = useState(false);
  const threadEndRef = useRef(null);

  useEffect(() => {
    if (thread.length > 0) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [thread.length]);

  async function ask(q) {
    if (!q.trim() || loading) return;
    const question = q.trim();
    setLoading(true);
    try {
      const res = await authFetch('/api/intelligence/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question, page }),
      });
      const body = await res.json();
      setThread((prev) => [...prev, {
        question,
        reply:  body.reply,
        source: body.source ?? (body.live ? 'live' : 'demo'),
        ts:     new Date().toISOString(),
      }]);
    } catch (err) {
      setThread((prev) => [...prev, {
        question,
        reply: `Live AXIS Intelligence is unreachable — ${err.message}`,
        source: 'error',
        ts: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      setQuery('');
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    ask(query);
  }

  return (
    <section style={{
      background: 'var(--charcoal)',
      color: 'var(--bone)',
      borderRadius: 'var(--radius-md)',
      borderLeft: '3px solid var(--bauxite-rust)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkle size={14} strokeWidth={1.5} color="var(--bauxite-rust)" />
        <span style={{
          fontSize: 'var(--ts-micro-size)',
          letterSpacing: 'var(--ts-micro-tracking)',
          textTransform: 'uppercase',
          color: 'rgba(245, 241, 236, 0.55)',
          fontWeight: 'var(--fw-medium)',
        }}>
          AXIS Intelligence
        </span>
        {mode && (
          <span className="mono" style={{
            marginLeft: 'auto',
            fontSize: 9,
            letterSpacing: '0.08em',
            color: mode === 'live' ? 'var(--signal-green)' : 'rgba(245, 241, 236, 0.45)',
            border: `1px solid ${mode === 'live' ? 'rgba(46, 107, 63, 0.4)' : 'rgba(245, 241, 236, 0.18)'}`,
            padding: '2px 6px',
            borderRadius: 2,
            textTransform: 'uppercase',
          }}>
            {mode}
          </span>
        )}
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about the corridor — hauler, tonnage, tariff…"
          style={{
            flex: 1,
            padding: '10px 12px',
            background: 'rgba(245, 241, 236, 0.06)',
            border: '1px solid rgba(245, 241, 236, 0.12)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--bone)',
            fontFamily: 'var(--font-primary)',
            fontSize: 'var(--ts-body-sm-size)',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 16px',
            background: 'var(--bauxite-rust)',
            color: 'var(--bone)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-primary)',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '…' : 'Ask'}
        </button>
      </form>

      {chips?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => ask(c)}
              disabled={loading}
              style={{
                padding: '5px 10px',
                background: 'rgba(245, 241, 236, 0.06)',
                border: '1px solid rgba(245, 241, 236, 0.12)',
                color: 'rgba(245, 241, 236, 0.78)',
                borderRadius: 999,
                fontSize: 11,
                cursor: loading ? 'wait' : 'pointer',
                fontFamily: 'var(--font-primary)',
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {thread.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          maxHeight: 360,
          overflowY: 'auto',
          borderTop: '1px solid rgba(245, 241, 236, 0.12)',
          paddingTop: 'var(--space-3)',
        }}>
          {thread.map((t, i) => {
            const sourceLabel = t.source === 'curated'
              ? 'CURATED'
              : t.source === 'live'
                ? 'LIVE'
                : t.source === 'error'
                  ? 'UNREACHABLE'
                  : 'DEMO';
            const sourceColor = t.source === 'live'
              ? 'var(--signal-green)'
              : t.source === 'error'
                ? 'var(--bauxite-rust)'
                : 'rgba(245, 241, 236, 0.45)';
            return (
              <article key={`${t.ts}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                  fontSize: 11,
                  color: 'rgba(245, 241, 236, 0.5)',
                  fontFamily: 'var(--font-primary)',
                  letterSpacing: '0.02em',
                }}>
                  — {t.question}
                </div>
                <p style={{
                  margin: 0,
                  fontSize: 'var(--ts-body-sm-size)',
                  lineHeight: 'var(--ts-body-sm-lh)',
                  color: 'rgba(245, 241, 236, 0.9)',
                }}>
                  {t.reply}
                </p>
                <span className="mono" style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  color: sourceColor,
                  textTransform: 'uppercase',
                }}>
                  {sourceLabel}
                </span>
              </article>
            );
          })}
          <div ref={threadEndRef} />
          <button
            type="button"
            onClick={() => setThread([])}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: '1px solid rgba(245, 241, 236, 0.14)',
              color: 'rgba(245, 241, 236, 0.55)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={10} strokeWidth={1.8} /> Clear transcript
          </button>
        </div>
      )}
    </section>
  );
}
