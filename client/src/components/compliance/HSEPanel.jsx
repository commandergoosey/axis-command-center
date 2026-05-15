/*
 * HSEPanel — events per million tonne-km with current vs target readout
 * and an event list (Category A/B, km marker, short note).
 *
 * Phase 34 — write path:
 *   • "Log incident" button opens an inline panel for axis_admin / axis_ops
 *     to capture a new event. POSTs to /api/compliance/incidents and the
 *     parent reloads the compliance feed (current_per_mtk recomputes live).
 *   • Each OPEN incident exposes "Close" — operator records the corrective
 *     action; the row flips to CLOSED and the open_count badge clears.
 *
 * Voice register: regulatory tone — say what the regulator counts, never
 * editorialise. Closed events keep their corrective-action snippet visible
 * so an audit can read the chain of custody without leaving the page.
 */

import { useEffect, useState } from 'react';
import { Plus, ShieldCheck, AlertOctagon } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const CAT_TONE = {
  A: { bg: 'rgba(162, 62, 35, 0.14)',  fg: 'var(--bauxite-rust)' },
  B: { bg: 'rgba(184, 134, 11, 0.14)', fg: 'var(--signal-amber)' },
};

const ROLES_THAT_WRITE = new Set(['axis_admin', 'axis_ops']);

const CAT_A_PRESETS = ['Rollover', 'Collision with injury', 'Cargo loss', 'Fatality', 'Near-miss with light vehicle'];
const CAT_B_PRESETS = ['Tyre burst', 'Minor off-corridor stop', 'Mechanical breakdown', 'Brake failure (no contact)'];

export default function HSEPanel({ hse, onMutate }) {
  const { user } = useAuth();
  const canWrite = user && ROLES_THAT_WRITE.has(user.role);

  const [showLog, setShowLog]   = useState(false);
  const [closeId, setCloseId]   = useState(null);

  if (!hse) return null;
  const pass = hse.current_per_mtk <= hse.target_per_mtk;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">HSE events per million tonne-km</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Target ≤ {hse.target_per_mtk.toFixed(1)}. Category A: injury or cargo loss. Category B: material incident without injury.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="tabular" style={{
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
              color: pass ? 'var(--signal-green)' : 'var(--bauxite-rust)',
            }}>
              {hse.current_per_mtk.toFixed(2)}
            </div>
            <div className="mono" style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.04em',
            }}>
              {hse.trailing_events_90d} events · last 90 d
              {hse.open_count > 0 && (
                <span style={{ color: 'var(--signal-amber)', marginLeft: 6 }}>
                  · {hse.open_count} OPEN
                </span>
              )}
            </div>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              style={{
                padding: '4px 10px',
                background: showLog ? 'var(--ash)' : 'var(--bauxite-rust)',
                color: showLog ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                letterSpacing: '0.04em',
                fontWeight: 'var(--fw-medium)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Plus size={11} />
              {showLog ? 'Cancel' : 'Log incident'}
            </button>
          )}
        </div>
      </header>

      {showLog && canWrite && (
        <LogIncidentPanel
          onCancel={() => setShowLog(false)}
          onDone={() => {
            setShowLog(false);
            onMutate?.();
          }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {hse.events.map((e) => {
          const tone = CAT_TONE[e.category] ?? CAT_TONE.B;
          const isOpen = e.status === 'OPEN';
          const isClosePanel = closeId === e.id;
          return (
            <div key={e.id}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '84px 60px 1fr auto',
                gap: 'var(--space-3)',
                alignItems: 'baseline',
                padding: '10px var(--space-3)',
                background: isOpen ? 'rgba(184, 134, 11, 0.05)' : 'var(--surface-sunk)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                borderLeft: isOpen ? '2px solid var(--signal-amber)' : '2px solid transparent',
              }}>
                <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
                  {formatDate(e.date || e.occurred_at)}
                </span>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  background: tone.bg,
                  color: tone.fg,
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.08em',
                  fontWeight: 'var(--fw-medium)',
                  textAlign: 'center',
                }}>
                  CAT {e.category}
                </span>
                <span style={{ color: 'var(--text)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)' }}>{e.type}</span>
                  <span className="mono" style={{ color: 'var(--text-tertiary)', marginLeft: 10 }}>
                    {e.km_marker != null ? `km ${e.km_marker} · ` : ''}{e.hauler_display_name}
                  </span>
                  {e.note && (
                    <div style={{ color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                      {e.note}
                    </div>
                  )}
                  {e.corrective_action && (
                    <div style={{
                      color: 'var(--signal-green)',
                      marginTop: 4,
                      fontSize: 'var(--ts-caption-size)',
                      lineHeight: 1.5,
                    }}>
                      <ShieldCheck size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                      {e.corrective_action}
                    </div>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
                  {isOpen && canWrite && (
                    <button
                      type="button"
                      onClick={() => setCloseId(isClosePanel ? null : e.id)}
                      style={{
                        padding: '3px 8px',
                        background: isClosePanel ? 'var(--ash)' : 'transparent',
                        color: isClosePanel ? 'var(--text-tertiary)' : 'var(--signal-amber)',
                        border: '1px solid var(--signal-amber)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 10,
                        letterSpacing: '0.06em',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 'var(--fw-medium)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isClosePanel ? 'CANCEL' : 'CLOSE'}
                    </button>
                  )}
                  {isOpen && (
                    <span className="mono" style={{
                      color: 'var(--signal-amber)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                    }}>
                      <AlertOctagon size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                      OPEN
                    </span>
                  )}
                </span>
              </div>

              {isClosePanel && canWrite && (
                <CloseIncidentPanel
                  incident={e}
                  onCancel={() => setCloseId(null)}
                  onDone={() => {
                    setCloseId(null);
                    onMutate?.();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Log incident ─────────────────────────────────────────────────

function LogIncidentPanel({ onCancel, onDone }) {
  const [haulers, setHaulers] = useState([]);
  const [haulerId, setHaulerId] = useState('');
  const [category, setCategory] = useState('B');
  const [type, setType]     = useState('');
  const [kmMarker, setKm]   = useState('');
  const [truck, setTruck]   = useState('');
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  // Hauler dropdown — fetched once on open.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await authFetch('/api/haulers');
        if (!res.ok) return;
        const data = await res.json();
        if (!live) return;
        const list = Array.isArray(data) ? data : (data.haulers || []);
        setHaulers(list);
        if (list[0]) setHaulerId(list[0].id);
      } catch { /* drop-down stays empty; the user can still submit if API surfaces ids */ }
    })();
    return () => { live = false; };
  }, []);

  const presets = category === 'A' ? CAT_A_PRESETS : CAT_B_PRESETS;

  const submit = async (e) => {
    e.preventDefault();
    if (!haulerId || !type) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/compliance/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hauler_id: haulerId,
          category,
          type,
          km_marker: kmMarker ? +kmMarker : undefined,
          truck: truck.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `incident ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        padding: 'var(--space-3) var(--space-4) var(--space-4)',
        marginBottom: 'var(--space-3)',
        background: 'var(--surface-sunk)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)', color: 'var(--text-secondary)' }}>
        Log HSE incident
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.6fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <label style={labelStyle}>
          <span>HAULER *</span>
          <select value={haulerId} onChange={(e) => setHaulerId(e.target.value)} required style={inputStyle}>
            {haulers.map((h) => (
              <option key={h.id} value={h.id}>{h.display_name}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          <span>CATEGORY *</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
            <option value="A">A — injury / cargo loss</option>
            <option value="B">B — material incident</option>
          </select>
        </label>
        <label style={labelStyle}>
          <span>TYPE *</span>
          <input
            type="text"
            list={`hse-presets-${category}`}
            placeholder={presets[0]}
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            style={inputStyle}
          />
          <datalist id={`hse-presets-${category}`}>
            {presets.map((p) => <option key={p} value={p} />)}
          </datalist>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 0.7fr 1.2fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <label style={labelStyle}>
          <span>KM MARKER</span>
          <input
            type="number"
            placeholder="0–300"
            min={0}
            max={300}
            value={kmMarker}
            onChange={(e) => setKm(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>TRUCK</span>
          <input
            type="text"
            placeholder="e.g. H02-0033"
            value={truck}
            onChange={(e) => setTruck(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>NARRATIVE</span>
          <input
            type="text"
            placeholder="What happened — facts only, no editorialising"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 'var(--space-3)',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-red)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
        <button
          type="submit"
          disabled={busy || !haulerId || !type}
          style={{
            ...primaryBtnStyle,
            background: busy ? 'var(--ash)' : 'var(--bauxite-rust)',
            color: busy ? 'var(--text-tertiary)' : '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Logging…' : 'Log incident'}
        </button>
      </div>
    </form>
  );
}

// ── Close incident ───────────────────────────────────────────────

function CloseIncidentPanel({ incident, onCancel, onDone }) {
  const [action, setAction] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!action.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/compliance/incidents/${incident.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrective_action: action.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `close ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        padding: 'var(--space-3) var(--space-4) var(--space-3)',
        marginTop: 6,
        background: 'var(--surface-sunk)',
        borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--signal-amber)',
      }}
    >
      <label style={{ ...labelStyle, marginBottom: 'var(--space-3)' }}>
        <span>CORRECTIVE ACTION *</span>
        <textarea
          rows={2}
          placeholder="What was done — driver debrief, route brief amended, parts ordered, coaching booked…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          required
          style={textareaStyle}
        />
      </label>

      {error && (
        <div style={{
          padding: '6px 10px',
          marginBottom: 'var(--space-2)',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-red)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
        <button
          type="submit"
          disabled={busy || !action.trim()}
          style={{
            ...primaryBtnStyle,
            background: busy ? 'var(--ash)' : 'var(--signal-green)',
            color: busy ? 'var(--text-tertiary)' : '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Closing…' : 'Close incident'}
        </button>
      </div>
    </form>
  );
}

// ── Style helpers ────────────────────────────────────────────────

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  letterSpacing: '0.08em',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
};

const inputStyle = {
  padding: '8px 10px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  textTransform: 'none',
  letterSpacing: 'normal',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  lineHeight: 1.4,
};

const primaryBtnStyle = {
  padding: '7px 14px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontWeight: 'var(--fw-medium)',
};

const ghostBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  padding: '7px 12px',
  color: 'var(--text-secondary)',
  fontSize: 'var(--ts-body-sm-size)',
  cursor: 'pointer',
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
