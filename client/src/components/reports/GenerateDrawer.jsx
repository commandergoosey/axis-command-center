/*
 * GenerateDrawer — right-anchored form for generating a report.
 * Period label, from/to dates, optional recipients.
 *
 * Flow:
 *   1. Fill period + optional recipients → "Generate"
 *   2. POST /api/reports/generate → server renders PDF, returns download_url
 *   3. Success state shows download button immediately
 *   4. Optional delivery is separate from generation
 */

import { authFetch } from '../../lib/auth';
import { useState, useEffect } from 'react';
import { X, Download, Send, CheckCircle } from 'lucide-react';

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function defaultLabel(entry) {
  if (!entry) return '';
  const now = new Date();
  const monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  if (entry.id === 'lender_quarterly') {
    const q = Math.floor(now.getMonth() / 3) + 1;
    return `Q${q} ${now.getFullYear()}`;
  }
  if (entry.id === 'filings_pack') {
    const q = Math.floor(now.getMonth() / 3) + 1;
    return `Q${q} ${now.getFullYear()}`;
  }
  return monthName;
}

export default function GenerateDrawer({ entry, onClose, onGenerated }) {
  const [label,      setLabel]      = useState('');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState('');
  const [recipients, setRecipients] = useState('');
  const [deliver,    setDeliver]    = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState(null);
  // Generated state: { instance, download_url }
  const [result,     setResult]     = useState(null);

  useEffect(() => {
    if (!entry) return;
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setLabel(defaultLabel(entry));
    setFromDate(first.toISOString().slice(0, 10));
    setToDate(last.toISOString().slice(0, 10));
    setRecipients((entry.recipients_default || []).join(', '));
    setDeliver(false);
    setError(null);
    setResult(null);
  }, [entry]);

  if (!entry) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type_id:      entry.id,
          label,
          period_from:  fromDate,
          period_to:    toDate,
          // Only include recipients if delivery is requested
          recipients:   deliver
            ? recipients.split(',').map((s) => s.trim()).filter(Boolean)
            : [],
        }),
      });
      if (!res.ok) throw new Error(`generate ${res.status}`);
      const body = await res.json();
      setResult(body);
      onGenerated?.(body.instance);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 31, 31, 0.38)',
        zIndex: 40,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: 440,
          background: 'var(--bone)',
          borderLeft: '1px solid var(--border-hairline)',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          overflow: 'auto',
          animation: 'fade-up 200ms ease-out',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="eyebrow">Generate</span>
            <h2 style={{ margin: 0, fontSize: 'var(--ts-h3-size)', lineHeight: 'var(--ts-h3-lh)' }}>
              {entry.title}
            </h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--ts-body-sm-size)' }}>
              {entry.audience} · {entry.cadence}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}>
            <X size={18} strokeWidth={1.6} />
          </button>
        </header>

        {/* Success state */}
        {result ? (
          <SuccessState result={result} deliver={deliver} onClose={onClose} />
        ) : (
          <>
            <Field label="Period label">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="April 2026"
                required
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Field label="From">
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </Field>
            </div>

            {/* Optional delivery */}
            <div>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={deliver}
                  onChange={(e) => setDeliver(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--bauxite-rust)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                  Deliver to recipients after generation
                </span>
              </label>
              {deliver && (
                <div style={{ marginTop: 8 }}>
                  <Field label="Recipients · comma separated">
                    <input
                      type="text"
                      value={recipients}
                      onChange={(e) => setRecipients(e.target.value)}
                      placeholder="operations@gibdlc.com, logistics@gibdlc.com"
                    />
                  </Field>
                </div>
              )}
            </div>

            {error && (
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'rgba(139, 46, 26, 0.06)',
                border: '1px solid rgba(139, 46, 26, 0.2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--bauxite-rust)',
              }}>
                Generation failed — {error}
              </div>
            )}

            <footer style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              marginTop: 'auto',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--border-hairline)',
            }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-primary)',
                  fontSize: 'var(--ts-body-sm-size)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !label}
                style={{
                  padding: '10px 20px',
                  background: 'var(--bauxite-rust)',
                  color: 'var(--bone)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-primary)',
                  fontSize: 'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: busy ? 0.7 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {deliver ? <Send size={12} strokeWidth={1.8} /> : <Download size={12} strokeWidth={1.8} />}
                {busy ? 'Generating…' : deliver ? 'Generate + deliver' : 'Generate'}
              </button>
            </footer>
          </>
        )}
      </form>
    </div>
  );
}

function SuccessState({ result, deliver, onClose }) {
  const downloadUrl = result.download_url;
  const instance = result.instance;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1 }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-5)',
        background: 'rgba(139, 46, 26, 0.04)',
        border: '1px solid rgba(139, 46, 26, 0.12)',
        borderRadius: 'var(--radius-md)',
        textAlign: 'center',
      }}>
        <CheckCircle size={32} strokeWidth={1.2} color="var(--bauxite-rust)" />
        <div>
          <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4 }}>
            Report generated
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            {instance.title}
          </div>
          {deliver && (
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
              Delivering to {instance.recipients?.join(', ') || 'recipients'}
            </div>
          )}
        </div>
      </div>

      <a
        href={downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        download={instance.filename || 'report.pdf'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 20px',
          background: 'var(--bauxite-rust)',
          color: 'var(--bone)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-primary)',
          fontSize: 'var(--ts-body-sm-size)',
          fontWeight: 'var(--fw-medium)',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        <Download size={14} strokeWidth={1.8} />
        Download PDF
      </a>

      <div style={{
        display: 'flex',
        gap: 'var(--space-2)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        justifyContent: 'center',
      }}>
        <span>{instance.pages} pages</span>
        <span>·</span>
        <span>{instance.size_kb} KB</span>
        <span>·</span>
        <span>{new Date(instance.generated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 'auto',
          padding: '10px 16px',
          background: 'transparent',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text)',
          fontFamily: 'var(--font-primary)',
          fontSize: 'var(--ts-body-sm-size)',
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
      <span className="gen-field" style={{ display: 'block' }}>
        {children}
      </span>
      <style>{`
        .gen-field input {
          width: 100%;
          padding: 8px 10px;
          background: var(--surface-raised);
          border: 1px solid var(--border-hairline);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: var(--font-primary);
          font-size: var(--ts-body-sm-size);
          outline: none;
          box-sizing: border-box;
        }
        .gen-field input:focus {
          border-color: var(--bauxite-rust);
        }
      `}</style>
    </label>
  );
}
