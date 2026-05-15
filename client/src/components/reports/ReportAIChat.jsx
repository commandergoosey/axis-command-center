/*
 * ReportAIChat — natural-language report request interface.
 *
 * Replaces the IntelligencePanel on the Reports page. Users describe
 * what report they need; the AI generates a structured PDF and provides
 * an immediate download link.
 *
 * Phase 104: Claude Haiku reads live corridor data + user prompt,
 * produces a JSON spec, server renders it as a PDF, client provides
 * a one-click download.
 */

import { useState, useRef, useCallback } from 'react';
import { Send, Download, Sparkles, AlertCircle } from 'lucide-react';
import { authFetch } from '../../lib/auth';

const SUGGESTIONS = [
  "Today's corridor performance summary",
  "Hauler ranking by SLA this month",
  "Fleet status and active alerts",
  "DSCR and covenant compliance overview",
];

export default function ReportAIChat() {
  const [prompt,   setPrompt]   = useState('');
  const [busy,     setBusy]     = useState(false);
  const [result,   setResult]   = useState(null);   // { title, download_url }
  const [error,    setError]    = useState(null);
  const inputRef = useRef(null);

  const submit = useCallback(async (text) => {
    const q = (text ?? prompt).trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch('/api/reports/ai/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt: q }),
      });
      if (!res.ok) throw new Error(`AI generate ${res.status}`);
      const body = await res.json();
      setResult({ title: body.title, download_url: body.download_url });
      setPrompt('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [prompt, busy]);

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

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
        alignItems: 'center',
        gap: 8,
      }}>
        <Sparkles size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
        <span className="eyebrow" style={{ marginBottom: 0 }}>AI Report Builder</span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.04em',
        }}>
          Describe any report · Claude generates a PDF from live data
        </span>
      </div>

      <div style={{ padding: 'var(--space-4)' }}>
        {/* Suggestions */}
        {!result && !busy && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-3)',
          }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setPrompt(s); inputRef.current?.focus(); }}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 100,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-primary)',
                  fontSize: 11,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'border-color 100ms ease, color 100ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bauxite-rust)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-hairline)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Describe the report you need — e.g. 'Weekly tonnage summary for all haulers'"
            disabled={busy}
            rows={2}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              fontFamily: 'var(--font-primary)',
              fontSize: 'var(--ts-body-sm-size)',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              transition: 'border-color 120ms ease',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--bauxite-rust)'; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border-hairline)'; }}
          />
          <button
            type="button"
            onClick={() => submit()}
            disabled={busy || !prompt.trim()}
            style={{
              padding: '10px 16px',
              background: 'var(--bauxite-rust)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--bone)',
              fontFamily: 'var(--font-primary)',
              fontSize: 'var(--ts-body-sm-size)',
              fontWeight: 'var(--fw-medium)',
              cursor: busy || !prompt.trim() ? 'not-allowed' : 'pointer',
              opacity: busy || !prompt.trim() ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
              transition: 'opacity 150ms ease',
              alignSelf: 'stretch',
            }}
          >
            <Send size={13} strokeWidth={1.8} />
            {busy ? 'Building…' : 'Generate'}
          </button>
        </div>

        {/* Generating state */}
        {busy && (
          <div style={{
            marginTop: 'var(--space-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
          }}>
            <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>◌</span>
            Claude is composing your report from live data…
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'rgba(139, 46, 26, 0.06)',
            border: '1px solid rgba(139, 46, 26, 0.2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--bauxite-rust)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <AlertCircle size={12} strokeWidth={1.6} />
            Generation failed — {error}
          </div>
        )}

        {/* Success result */}
        {result && (
          <div style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3)',
            background: 'rgba(139, 46, 26, 0.04)',
            border: '1px solid rgba(139, 46, 26, 0.12)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <div>
              <div style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
                {result.title}
              </div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                PDF ready · available for 10 minutes
              </div>
            </div>
            <a
              href={result.download_url}
              download
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                background: 'var(--bauxite-rust)',
                color: 'var(--bone)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-primary)',
                fontSize: 'var(--ts-body-sm-size)',
                fontWeight: 'var(--fw-medium)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <Download size={13} strokeWidth={1.8} />
              Download PDF
            </a>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 1; }
        }
      `}</style>
    </section>
  );
}
