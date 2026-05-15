/*
 * CorridorConditions — side panel shared between Schematic and Map.
 * Weather line, advisories list, weighbridge queue state, and a compact
 * list of the active convoys on the line right now.
 *
 * Phase 98 — live advisory write path for axis_admin / axis_ops.
 *   POST /api/corridor/advisories        — post new advisory
 *   POST /api/corridor/advisories/:id/resolve — resolve live advisory
 * The "Advisories" panel gains a "Post advisory" button for write roles.
 * Live advisories carry an inline "Resolve" chip; mock advisories are read-only.
 */

import { useState } from 'react';
import { AlertTriangle, Info, AlertOctagon, Plus, X, CheckCircle, Loader } from 'lucide-react';
import ApiHealthDot from '../primitives/ApiHealthDot';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const WAYPOINT_NAMES = {
  'nyinahin-wb': 'Nyinahin',
  'mid-wb':      'Bekwai mid',
  'takoradi-wb': 'Takoradi',
};

const SEV_ICON  = { critical: AlertOctagon, warn: AlertTriangle, info: Info };
const SEV_COLOR = {
  critical: 'var(--bauxite-rust)',
  warn:     'var(--signal-amber)',
  info:     'var(--iron)',
};

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function CorridorConditions({ conditions, activeConvoys, onAdvisoryChange }) {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Panel title="Conditions">
        <p style={{
          margin: 0,
          fontSize: 'var(--ts-body-sm-size)',
          lineHeight: 'var(--ts-body-sm-lh)',
          color: 'var(--text)',
        }}>
          {conditions?.weather ?? '—'}
        </p>
      </Panel>

      <AdvisoriesPanel
        advisories={conditions?.advisories ?? []}
        canWrite={canWrite}
        onAdvisoryChange={onAdvisoryChange}
      />

      <Panel title="Weighbridges">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conditions?.weighbridges?.map((w) => (
            <li key={w.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}>
              <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                {WAYPOINT_NAMES[w.id] ?? w.id}
              </span>
              <span className="tabular" style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
                {w.queue_minutes} min
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`Active convoys · ${activeConvoys?.length ?? 0}`}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeConvoys?.map((c) => (
            <li key={c.id} style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center',
              gap: 6,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                  {c.id}
                </span>
                <span className="mono" style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                  {c.hauler_display_name} · {c.phase} · km {c.km}
                </span>
              </div>
              <ApiHealthDot status={c.on_schedule ? 'connected' : 'degraded'} />
            </li>
          ))}
        </ul>
      </Panel>
    </aside>
  );
}

/* ─── Advisories panel with write actions ───────────────────────── */

function AdvisoriesPanel({ advisories, canWrite, onAdvisoryChange }) {
  const [composing, setComposing] = useState(false);
  const [resolving, setResolving] = useState(null); // dbId being resolved
  const [err, setErr] = useState(null);

  async function handleResolve(advisory) {
    // advisory.id is "live-{dbId}"; extract the numeric part
    if (!advisory.is_live) return; // mock advisories can't be resolved
    const dbId = advisory._db_id;
    setResolving(dbId);
    setErr(null);
    try {
      const res = await authFetch(`/api/corridor/advisories/${dbId}/resolve`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr(b.error || 'Could not resolve advisory');
      } else {
        onAdvisoryChange?.();
      }
    } catch {
      setErr('Network error');
    } finally {
      setResolving(null);
    }
  }

  return (
    <Panel
      title="Advisories"
      action={canWrite && !composing && (
        <button
          type="button"
          onClick={() => { setComposing(true); setErr(null); }}
          style={addBtnStyle}
          title="Post a new corridor advisory"
        >
          <Plus size={11} strokeWidth={2} />
          Post
        </button>
      )}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {advisories.length === 0 && !composing && (
          <li style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            No active advisories.
          </li>
        )}
        {advisories.map((a) => {
          const Icon = SEV_ICON[a.severity] ?? Info;
          const color = SEV_COLOR[a.severity] ?? 'var(--iron)';
          const isBeingResolved = a.is_live && resolving === a._db_id;
          return (
            <li key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon size={14} strokeWidth={1.5} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  margin: 0,
                  fontSize: 'var(--ts-body-sm-size)',
                  lineHeight: 'var(--ts-body-sm-lh)',
                  color: 'var(--text)',
                }}>
                  {a.body}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  {a.is_live && a.posted_by_name && (
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
                      {a.posted_by_name} · {formatTime(a.posted_at)}
                    </span>
                  )}
                  {a.km_from != null && (
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      km {a.km_from}{a.km_to != null ? `–${a.km_to}` : ''}
                    </span>
                  )}
                  {canWrite && a.is_live && (
                    <button
                      type="button"
                      onClick={() => handleResolve(a)}
                      disabled={isBeingResolved}
                      style={resolveBtnStyle}
                      title="Mark this advisory as resolved"
                    >
                      {isBeingResolved
                        ? <Loader size={10} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
                        : <CheckCircle size={10} strokeWidth={2} />
                      }
                      {isBeingResolved ? 'Resolving…' : 'Resolve'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {err && (
        <div style={{ marginTop: 8, fontSize: 'var(--ts-caption-size)', color: 'var(--signal-red)' }}>
          {err}
        </div>
      )}

      {composing && (
        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-hairline)' }}>
          <ComposeForm
            onCancel={() => { setComposing(false); setErr(null); }}
            onPosted={() => { setComposing(false); onAdvisoryChange?.(); }}
            onErr={setErr}
          />
        </div>
      )}
    </Panel>
  );
}

/* ─── Compose form ──────────────────────────────────────────────── */

const SEV_OPTIONS = [
  ['info',     'Info — FYI, no action needed'],
  ['warn',     'Warn — action recommended'],
  ['critical', 'Critical — convoy impact'],
];

function ComposeForm({ onCancel, onPosted, onErr }) {
  const [severity,  setSeverity]  = useState('warn');
  const [body,      setBody]      = useState('');
  const [kmFrom,    setKmFrom]    = useState('');
  const [kmTo,      setKmTo]      = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy,      setBusy]      = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!body.trim()) { onErr('Advisory text is required.'); return; }
    onErr(null);
    setBusy(true);
    try {
      const payload = {
        severity,
        body: body.trim(),
        km_from:    kmFrom    ? Number(kmFrom)    : null,
        km_to:      kmTo      ? Number(kmTo)      : null,
        expires_at: expiresAt ? expiresAt + 'T23:59:59Z' : null,
      };
      const res = await authFetch('/api/corridor/advisories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { onErr(data.error || 'Post failed'); return; }
      onPosted();
    } catch {
      onErr('Network error — advisory not posted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {/* Severity */}
      <div style={{ display: 'flex', gap: 6 }}>
        {SEV_OPTIONS.map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setSeverity(val)}
            style={{
              flex: 1,
              padding: '4px 0',
              background: severity === val ? `${SEV_COLOR[val]}18` : 'var(--surface)',
              border: `1px solid ${severity === val ? SEV_COLOR[val] : 'var(--border-hairline)'}`,
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              color: severity === val ? SEV_COLOR[val] : 'var(--text-tertiary)',
              fontFamily: 'inherit',
              fontWeight: severity === val ? 'var(--fw-medium)' : 'normal',
              cursor: 'pointer',
              letterSpacing: '0.02em',
              textTransform: 'capitalize',
            }}
          >
            {val}
          </button>
        ))}
      </div>

      {/* Body text */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Describe the advisory — location, impact, expected duration…"
        style={inputStyle}
        required
      />

      {/* Corridor position (optional) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={labelStyle}>
          <span style={labelTextStyle}>From km</span>
          <input
            type="number"
            min={0} max={300}
            value={kmFrom}
            onChange={(e) => setKmFrom(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>To km</span>
          <input
            type="number"
            min={0} max={300}
            value={kmTo}
            onChange={(e) => setKmTo(e.target.value)}
            placeholder="300"
            style={inputStyle}
          />
        </label>
      </div>

      {/* Expiry date (optional) */}
      <label style={labelStyle}>
        <span style={labelTextStyle}>Auto-expire <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></span>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          style={inputStyle}
        />
      </label>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          type="submit"
          disabled={busy || !body.trim()}
          style={{
            flex: 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 0',
            background: busy || !body.trim() ? 'var(--surface-sunk)' : 'var(--bauxite-rust)',
            color: busy || !body.trim() ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            fontWeight: 'var(--fw-medium)',
            fontFamily: 'inherit',
            cursor: busy || !body.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {busy
            ? <><Loader size={12} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />Posting…</>
            : 'Post advisory'
          }
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '7px 12px',
            background: 'transparent',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </form>
  );
}

/* ─── Panel wrapper ─────────────────────────────────────────────── */

function Panel({ title, action, children }) {
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div className="eyebrow" style={{ flex: 1 }}>{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────── */

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Accra',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/* ─── Shared style tokens ───────────────────────────────────────── */

const addBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 999,
  fontSize: 10,
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  letterSpacing: '0.02em',
};

const resolveBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 7px',
  background: 'rgba(46,107,63,0.08)',
  border: '1px solid rgba(46,107,63,0.3)',
  borderRadius: 999,
  fontSize: 10,
  color: 'var(--signal-green)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  letterSpacing: '0.02em',
};

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  resize: 'vertical',
  lineHeight: 1.5,
};

const labelStyle  = { display: 'flex', flexDirection: 'column', gap: 3 };
const labelTextStyle = { fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em' };
