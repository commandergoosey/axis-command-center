/*
 * ScheduleDrawer — right-anchored form for scheduling a recurring report.
 *
 * Props:
 *   entry       — report library entry being scheduled (null = hidden)
 *   onClose     — () => void
 *   onScheduled — (schedule) => void  (called after successful creation)
 */

import { useState, useEffect } from 'react';
import { X, Clock } from 'lucide-react';
import { authFetch } from '../../lib/auth';

const FREQ_OPTIONS = [
  { value: 'daily',     label: 'Daily' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00 UTC`,
}));

export default function ScheduleDrawer({ entry, onClose, onScheduled }) {
  const [frequency,   setFrequency]   = useState('monthly');
  const [dayOfWeek,   setDayOfWeek]   = useState(1);
  const [dayOfMonth,  setDayOfMonth]  = useState(1);
  const [hour,        setHour]        = useState(8);
  const [recipients,  setRecipients]  = useState('');
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    if (!entry) return;
    setFrequency('monthly');
    setDayOfWeek(1);
    setDayOfMonth(1);
    setHour(8);
    setRecipients((entry.recipients_default || []).join(', '));
    setError(null);
  }, [entry]);

  if (!entry) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type_id:     entry.id,
          frequency,
          day_of_week:  frequency === 'weekly'  ? dayOfWeek  : null,
          day_of_month: (frequency === 'monthly' || frequency === 'quarterly') ? dayOfMonth : null,
          hour,
          recipients: recipients.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(`schedule ${res.status}`);
      const body = await res.json();
      onScheduled?.(body.schedule);
      onClose();
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
            <span className="eyebrow">Schedule</span>
            <h2 style={{ margin: 0, fontSize: 'var(--ts-h3-size)', lineHeight: 'var(--ts-h3-lh)' }}>
              {entry.title}
            </h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--ts-body-sm-size)' }}>
              {entry.audience} · {entry.cadence}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', padding: 4,
            cursor: 'pointer', color: 'var(--text-secondary)',
          }}>
            <X size={18} strokeWidth={1.6} />
          </button>
        </header>

        <Field label="Frequency">
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            style={selectStyle}
          >
            {FREQ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        {frequency === 'weekly' && (
          <Field label="Day of week">
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              style={selectStyle}
            >
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        )}

        {(frequency === 'monthly' || frequency === 'quarterly') && (
          <Field label="Day of month">
            <select
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
              style={selectStyle}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>Day {d}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Send time (UTC)">
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            style={selectStyle}
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Recipients · comma separated">
          <input
            type="text"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="ops@gibdlc.com, lender@gibdlc.com"
          />
        </Field>

        {error && (
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'rgba(139, 46, 26, 0.06)',
            border: '1px solid rgba(139, 46, 26, 0.2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--bauxite-rust)',
          }}>
            Schedule failed — {error}
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
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button type="submit" disabled={busy} style={{
            ...submitBtnStyle,
            opacity: busy ? 0.7 : 1,
            cursor:  busy ? 'wait' : 'pointer',
          }}>
            <Clock size={12} strokeWidth={1.8} />
            {busy ? 'Scheduling…' : 'Create schedule'}
          </button>
        </footer>
      </form>
    </div>
  );
}

const selectStyle = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-sm-size)',
  outline: 'none',
  boxSizing: 'border-box',
};

const cancelBtnStyle = {
  padding: '10px 16px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-sm-size)',
  cursor: 'pointer',
};

const submitBtnStyle = {
  padding: '10px 20px',
  background: 'var(--bauxite-rust)',
  color: 'var(--bone)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-sm-size)',
  fontWeight: 'var(--fw-medium)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
      <span className="sch-field" style={{ display: 'block' }}>
        {children}
      </span>
      <style>{`
        .sch-field input {
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
        .sch-field input:focus, .sch-field select:focus {
          border-color: var(--bauxite-rust);
        }
      `}</style>
    </label>
  );
}
