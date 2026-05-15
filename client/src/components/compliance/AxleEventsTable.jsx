/*
 * AxleEventsTable — recent weighbridge events. Phase 116 adds a
 * "Log hold" write path for axis_admin / axis_ops.
 *
 * HOLD rows get a Bauxite Rust indicator; WARNING → Amber; CLEARED → Iron.
 * Live events (is_live: true) carry a LIVE pill in the action column.
 */

import { useState } from 'react';
import { useAuth }  from '../../lib/AuthContext';
import { authFetch } from '../../lib/auth';

const ACTION_TONE = {
  HOLD:    { fg: 'var(--bauxite-rust)', label: 'HOLD'    },
  WARNING: { fg: 'var(--signal-amber)', label: 'WARN'    },
  CLEARED: { fg: 'var(--iron)',         label: 'CLEARED' },
};

const LOG_ROLES = ['axis_admin', 'axis_ops'];

export default function AxleEventsTable({ events, onHoldLogged }) {
  const { user } = useAuth();
  const canLog = LOG_ROLES.includes(user?.role);

  const [showForm, setShowForm] = useState(false);

  if (!events?.length && !canLog) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">Weighbridge events · latest 30 days</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Axle-load holds and warnings. LI 2180 limit: 60 t GVW.
          </div>
        </div>
        {canLog && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              fontSize: 'var(--ts-caption-size)',
              padding: '4px 12px',
              background: 'none',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            + Log hold
          </button>
        )}
      </header>

      {showForm && (
        <LogHoldForm
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); onHoldLogged?.(); }}
        />
      )}

      {events?.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px 110px 90px 100px 90px 1fr',
          columnGap: 'var(--space-3)',
          rowGap: 0,
        }}>
          {['When', 'Hauler', 'Plate', 'GVW', 'Overload', 'Action / note'].map((h) => (
            <div key={h} className="mono" style={{
              fontSize: 10,
              color: 'var(--text-tertiary)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              paddingBottom: 'var(--space-2)',
              borderBottom: '1px solid var(--border-hairline)',
            }}>
              {h}
            </div>
          ))}
          {events.map((e) => {
            const tone = ACTION_TONE[e.action] ?? ACTION_TONE.CLEARED;
            return <Row key={e.id} event={e} tone={tone} />;
          })}
        </div>
      )}

      {!events?.length && (
        <p style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)', margin: 0 }}>
          No events in the last 30 days.
        </p>
      )}
    </section>
  );
}

/* ── Inline log-hold form ──────────────────────────────────────── */

function LogHoldForm({ onCancel, onSaved }) {
  const [plate,   setPlate]   = useState('');
  const [gvw,     setGvw]     = useState('');
  const [holdMin, setHoldMin] = useState('');
  const [wb,      setWb]      = useState('');
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch('/api/compliance/weighbridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate:         plate.trim().toUpperCase(),
          gross_weight_t: parseFloat(gvw),
          hold_minutes:  holdMin !== '' ? parseInt(holdMin, 10) : undefined,
          weighbridge:   wb.trim() || undefined,
          notes:         notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved(data.event);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  const inp = {
    padding: '4px 8px',
    background: 'var(--surface)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    fontSize: 'var(--ts-body-sm-size)',
  };
  const lbl = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 'var(--ts-caption-size)',
    color: 'var(--text-secondary)',
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--surface)',
      border: '1px solid var(--bauxite-rust)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-3) var(--space-4)',
      marginBottom: 'var(--space-3)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 100px 1fr',
        gap: 'var(--space-3)',
      }}>
        <label style={lbl}>
          Plate *
          <input value={plate} onChange={(e) => setPlate(e.target.value)}
            required placeholder="e.g. GW 1234-21" style={inp} />
        </label>
        <label style={lbl}>
          GVW recorded (tonnes) *
          <input type="number" step="0.1" min="0.1" value={gvw}
            onChange={(e) => setGvw(e.target.value)} required placeholder="e.g. 63.2" style={inp} />
        </label>
        <label style={lbl}>
          Hold (min)
          <input type="number" step="1" min="0" value={holdMin}
            onChange={(e) => setHoldMin(e.target.value)} placeholder="—" style={inp} />
        </label>
        <label style={lbl}>
          Weighbridge
          <input value={wb} onChange={(e) => setWb(e.target.value)}
            placeholder="e.g. Nyinahin GHA" style={inp} />
        </label>
      </div>
      <label style={lbl}>
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Off-loaded, coaching issued, etc." style={{ ...inp, width: '100%' }} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button type="submit" disabled={saving} style={{
          padding: '4px 14px',
          background: 'var(--bauxite-rust)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          fontWeight: 'var(--fw-semibold)',
          cursor: saving ? 'wait' : 'pointer',
        }}>
          {saving ? 'Saving…' : 'Log hold'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '4px 10px',
          background: 'none',
          border: '1px solid var(--border-soft)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}>Cancel</button>
        {err && <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>{err}</span>}
      </div>
    </form>
  );
}

/* ── Table row ─────────────────────────────────────────────────── */

function Row({ event, tone }) {
  const cell = {
    padding: '12px 0',
    borderBottom: '1px solid var(--border-hairline)',
    fontSize: 'var(--ts-body-sm-size)',
    color: 'var(--text)',
  };
  return (
    <>
      <span className="mono" style={{ ...cell, color: 'var(--text-secondary)' }}>
        {formatDate(event.timestamp)}
      </span>
      <span style={{ ...cell }}>{event.hauler_display_name}</span>
      <span className="mono" style={{ ...cell, color: 'var(--text-secondary)' }}>
        {event.truck}
        {event.is_live && (
          <span className="mono" style={{
            marginLeft: 6, fontSize: 8, padding: '1px 4px',
            background: 'rgba(162,62,35,0.10)', color: 'var(--bauxite-rust)',
            borderRadius: 2, letterSpacing: '0.10em', textTransform: 'uppercase',
          }}>LIVE</span>
        )}
      </span>
      <span className="tabular" style={{
        ...cell,
        color: event.gvw_tonnes > 60 ? 'var(--bauxite-rust)' : 'var(--text)',
      }}>
        {event.gvw_tonnes.toFixed(1)} t
      </span>
      <span className="tabular" style={{
        ...cell,
        color: event.overload_kg > 0 ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
      }}>
        {event.overload_kg > 0 ? `+${event.overload_kg.toLocaleString()} kg` : '—'}
      </span>
      <span style={{ ...cell }}>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          background: `${tone.fg}15`,
          color: tone.fg,
          borderRadius: 'var(--radius-sm)',
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.08em',
          fontWeight: 'var(--fw-medium)',
          marginRight: 8,
        }}>
          {tone.label}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {event.delay_min ? `${event.delay_min} min` : '—'}
          {event.note ? ` · ${event.note}` : ''}
        </span>
      </span>
    </>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const day  = d.toLocaleDateString('en-GB',  { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}
