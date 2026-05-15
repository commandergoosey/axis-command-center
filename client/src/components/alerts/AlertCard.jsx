/*
 * AlertCard — Phase 13 triage card.
 *
 * Structure:
 *   severity stripe | body column
 *     header: icon + type badge + status pill + assignee + opened-at
 *     title + hauler line
 *     body + impact
 *     notes (reverse-chrono)
 *     action row: Open link · Resolve · Snooze · Assign · Note
 *
 * Triage actions are gated: lenders see a read-only card; hauler admins only
 * see actions for alerts that belong to their hauler. The `canTriage` prop
 * carries the decision down from the page.
 */

import { useRef, useState, useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, ArrowUpRight, Check, Clock, UserPlus, MessageSquarePlus, RotateCcw, GraduationCap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/auth';

const SEVERITY_META = {
  CRITICAL: { icon: AlertTriangle, color: 'var(--bauxite-rust)', label: 'CRITICAL' },
  WARNING:  { icon: AlertCircle,   color: 'var(--signal-amber)', label: 'WARNING'  },
  INFO:     { icon: Info,          color: 'var(--iron)',         label: 'INFO'     },
};

const TYPE_LABEL = {
  axle_load_breach:    'Axle load',
  sla_breach:          'SLA',
  licence_expiry:      'Licence',
  payment_ageing:      'Receivables',
  hse_event:           'HSE',
  convoy_delay:        'Convoy',
  payload_variance:    'Payload',
  weighbridge_hold:    'Weighbridge',
  integration_failure: 'Integration',
  filing_overdue:      'Filing',
  maintenance_cluster: 'Maintenance',
};

const STATUS_META = {
  NEEDS_ACTION: { label: 'NEEDS ACTION', bg: 'rgba(139, 46, 26, 0.10)', fg: 'var(--bauxite-rust)' },
  MONITORING:   { label: 'MONITORING',   bg: 'var(--ash)',              fg: 'var(--iron)' },
  SNOOZED:      { label: 'SNOOZED',      bg: 'rgba(184, 134, 11, 0.12)', fg: 'var(--signal-amber)' },
  RESOLVED:     { label: 'RESOLVED',     bg: 'rgba(46, 107, 63, 0.12)', fg: 'var(--signal-green)' },
};

export default function AlertCard({ alert, canTriage, users, onChange, isFocused = false }) {
  const meta = SEVERITY_META[alert.severity] ?? SEVERITY_META.INFO;
  const Icon = meta.icon;
  const statusMeta = STATUS_META[alert.status] ?? STATUS_META.MONITORING;
  const navigate = useNavigate();

  const [openPanel, setOpenPanel] = useState(null); // 'snooze' | 'assign' | 'note' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/alerts/${alert.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`${path} failed (${res.status})`);
      setOpenPanel(null);
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Coaching sessions — POST to /api/coaching/sessions with this alert
  // linked. The backend auto-closes the alert with a note referencing the
  // session; onChange() refreshes the board so the RESOLVED state + note
  // appear without a further round-trip from the card.
  const logCoaching = async (payload) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/coaching/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          hauler_id: alert.hauler_id,
          topic: payload.topic || 'Pre-departure axle verification',
          linked_alert_ids: [alert.id],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `coach failed (${res.status})`);
      }
      setOpenPanel(null);
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isResolved = alert.status === 'RESOLVED';
  const isSnoozed  = alert.status === 'SNOOZED';

  return (
    <article id={`alert-${alert.id}`} style={{
      display: 'grid',
      gridTemplateColumns: '4px 1fr',
      background: 'var(--surface-raised)',
      border: `1px solid ${isFocused ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      opacity: isResolved ? 0.75 : 1,
      boxShadow: isFocused ? '0 0 0 3px rgba(162, 62, 35, 0.22)' : 'none',
      transition: 'box-shadow 220ms ease, border-color 220ms ease',
      scrollMarginTop: 80,
    }}>
      <div style={{ background: meta.color }} />
      <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-2)',
        }}>
          <Icon size={18} strokeWidth={1.8} color={meta.color} />
          <span className="mono" style={{
            fontSize: 10,
            color: meta.color,
            letterSpacing: '0.08em',
            fontWeight: 'var(--fw-medium)',
          }}>
            {meta.label} · {TYPE_LABEL[alert.type] ?? alert.type}
          </span>
          <StatusPill meta={statusMeta} />
          {alert.is_live && (
            <span className="mono" style={{
              fontSize: 9,
              letterSpacing: '0.06em',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(22,163,74,0.12)',
              color: 'var(--signal-green)',
              fontWeight: 'var(--fw-medium)',
            }}>
              LIVE
            </span>
          )}
          {alert.generated && !alert.is_live && (
            <span className="mono" style={{
              fontSize: 9,
              letterSpacing: '0.06em',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--ash)',
              color: 'var(--iron)',
              fontWeight: 'var(--fw-medium)',
            }}>
              AUTO
            </span>
          )}
          {alert.assignee && (
            <AssigneeChip assignee={alert.assignee} />
          )}
          {!alert.assignee && !isResolved && (
            <span className="mono" style={{
              fontSize: 10,
              color: 'var(--text-tertiary)',
              letterSpacing: '0.06em',
              padding: '2px 8px',
              border: '1px dashed var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
            }}>
              UNASSIGNED
            </span>
          )}
          <span className="mono" style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
          }}>
            OPENED {formatRelative(alert.opened_at)}
          </span>
        </header>

        <h3 style={{
          margin: 0,
          fontSize: 'var(--ts-h3-size)',
          lineHeight: 'var(--ts-h3-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          {alert.title}
        </h3>

        {alert.hauler_display_name && (
          <div className="mono" style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            marginTop: 4,
            letterSpacing: '0.04em',
          }}>
            {alert.hauler_display_name}{alert.asset_ref ? ` · ${alert.asset_ref}` : ''}
          </div>
        )}

        <p style={{
          margin: 'var(--space-3) 0 var(--space-2) 0',
          fontSize: 'var(--ts-body-size)',
          lineHeight: 'var(--ts-body-lh)',
          color: 'var(--text-secondary)',
        }}>
          {alert.body}
        </p>

        {alert.impact && (
          <p style={{
            margin: '0 0 var(--space-3) 0',
            fontSize: 'var(--ts-body-sm-size)',
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
            borderLeft: '2px solid var(--border-hairline)',
            paddingLeft: 'var(--space-3)',
          }}>
            {alert.impact}
          </p>
        )}

        {isSnoozed && alert.snooze_until_iso && (
          <MetaLine>Snoozed until {formatAbsolute(alert.snooze_until_iso)}</MetaLine>
        )}
        {isResolved && (
          <MetaLine>
            Resolved {alert.resolved_at_iso ? formatAbsolute(alert.resolved_at_iso) : ''}
            {alert.resolved_by_display ? ` · by ${alert.resolved_by_display}` : ''}
            {alert.resolution_note ? ` — "${alert.resolution_note}"` : ''}
          </MetaLine>
        )}

        {alert.notes?.length > 0 && (
          <NotesList notes={alert.notes} />
        )}

        {error && (
          <div style={{
            marginTop: 'var(--space-3)',
            padding: '8px 12px',
            background: 'rgba(139, 46, 26, 0.06)',
            border: '1px solid rgba(139, 46, 26, 0.22)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--signal-red)',
          }}>
            {error}
          </div>
        )}

        <footer style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          {alert.link && (
            <ActionBtn
              icon={ArrowUpRight}
              label={alert.link.label}
              variant="primary"
              onClick={() => navigate(alert.link.path)}
            />
          )}
          {canTriage && !isResolved && (
            <>
              <ActionBtn icon={Check} label="Resolve" onClick={() => setOpenPanel('resolve')} disabled={busy} />
              {alert.type === 'axle_load_breach' && alert.hauler_id && (
                <ActionBtn icon={GraduationCap} label="Coach dispatcher" onClick={() => setOpenPanel('coach')} disabled={busy} />
              )}
              <ActionBtn icon={Clock} label="Snooze" onClick={() => setOpenPanel('snooze')} disabled={busy} />
              <ActionBtn icon={UserPlus} label={alert.assignee ? 'Reassign' : 'Assign'} onClick={() => setOpenPanel('assign')} disabled={busy} />
              <ActionBtn icon={MessageSquarePlus} label="Note" onClick={() => setOpenPanel('note')} disabled={busy} />
            </>
          )}
          {canTriage && isResolved && (
            <ActionBtn icon={RotateCcw} label="Reopen" onClick={() => act('reopen')} disabled={busy} />
          )}
        </footer>

        {openPanel === 'snooze' && (
          <SnoozePanel
            busy={busy}
            onCancel={() => setOpenPanel(null)}
            onSubmit={(until_iso) => act('snooze', { until_iso })}
          />
        )}
        {openPanel === 'assign' && (
          <AssignPanel
            users={users}
            current={alert.assignee}
            busy={busy}
            onCancel={() => setOpenPanel(null)}
            onSubmit={(user_id) => act('assign', { user_id })}
          />
        )}
        {openPanel === 'note' && (
          <NotePanel
            busy={busy}
            onCancel={() => setOpenPanel(null)}
            onSubmit={(body) => act('note', { body })}
          />
        )}
        {openPanel === 'resolve' && (
          <ResolvePanel
            busy={busy}
            defaultNote={alert.action || ''}
            onCancel={() => setOpenPanel(null)}
            onSubmit={(note) => act('resolve', { note })}
          />
        )}
        {openPanel === 'coach' && (
          <CoachPanel
            busy={busy}
            haulerId={alert.hauler_id}
            haulerDisplay={alert.hauler_display_name}
            onCancel={() => setOpenPanel(null)}
            onSubmit={logCoaching}
          />
        )}
      </div>
    </article>
  );
}

function StatusPill({ meta }) {
  return (
    <span className="mono" style={{
      fontSize: 10,
      letterSpacing: '0.06em',
      padding: '2px 8px',
      borderRadius: 'var(--radius-sm)',
      background: meta.bg,
      color: meta.fg,
      fontWeight: 'var(--fw-medium)',
    }}>
      {meta.label}
    </span>
  );
}

function AssigneeChip({ assignee }) {
  const initials = (assignee.display_name || '?')
    .split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text-secondary)',
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%',
        background: 'var(--ash)',
        color: 'var(--iron)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 'var(--fw-medium)', letterSpacing: '0.04em',
      }}>
        {initials}
      </span>
      {assignee.display_name}
    </span>
  );
}

function MetaLine({ children }) {
  return (
    <div className="mono" style={{
      marginTop: 'var(--space-2)',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text-tertiary)',
      letterSpacing: '0.02em',
    }}>
      {children}
    </div>
  );
}

function NotesList({ notes }) {
  return (
    <div style={{
      marginTop: 'var(--space-3)',
      borderLeft: '2px solid var(--border-hairline)',
      paddingLeft: 'var(--space-3)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      {[...notes].reverse().map((n) => (
        <div key={n.id}>
          <div className="mono" style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
            marginBottom: 2,
          }}>
            {n.by_display?.toUpperCase()} · {formatAbsolute(n.created_at_iso)}
          </div>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            {n.body}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, disabled, variant }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        background: isPrimary ? 'var(--charcoal)' : 'var(--surface)',
        color: isPrimary ? 'var(--bone)' : 'var(--text)',
        border: isPrimary ? 'none' : '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  );
}

function SnoozePanel({ busy, onCancel, onSubmit }) {
  const presets = [
    { label: '1 hour',            hrs: 1   },
    { label: '4 hours',           hrs: 4   },
    { label: 'Until tomorrow 08:00', hrs: null },
    { label: '3 days',            hrs: 72  },
  ];
  const resolve = (p) => {
    const d = new Date();
    if (p.hrs != null) return new Date(d.getTime() + p.hrs * 3_600_000).toISOString();
    // tomorrow 08:00 Africa/Accra (UTC+0) — equivalent to 08:00 UTC
    const t = new Date(d);
    t.setUTCDate(t.getUTCDate() + 1);
    t.setUTCHours(8, 0, 0, 0);
    return t.toISOString();
  };
  return (
    <Panel onCancel={onCancel} title="Snooze until…">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => onSubmit(resolve(p))}
            style={presetBtnStyle}
          >
            {p.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function AssignPanel({ users, current, busy, onCancel, onSubmit }) {
  const [value, setValue] = useState(current?.user_id || '');
  return (
    <Panel onCancel={onCancel} title="Assign to">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={selectStyle}
      >
        <option value="">— Unassigned —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name} · {u.role.replace('_', ' ')}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button type="button" disabled={busy} onClick={() => onSubmit(value || null)} style={confirmBtnStyle}>
          {value ? 'Assign' : 'Unassign'}
        </button>
      </div>
    </Panel>
  );
}

function NotePanel({ busy, onCancel, onSubmit }) {
  const [body, setBody] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Panel onCancel={onCancel} title="Add a note">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you do? What's the next step?"
        rows={3}
        style={textareaStyle}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button
          type="button"
          disabled={busy || !body.trim()}
          onClick={() => onSubmit(body.trim())}
          style={confirmBtnStyle}
        >
          Save note
        </button>
      </div>
    </Panel>
  );
}

function ResolvePanel({ busy, defaultNote, onCancel, onSubmit }) {
  const [note, setNote] = useState(defaultNote);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Panel onCancel={onCancel} title="Resolve with note">
      <textarea
        ref={ref}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="How was this resolved?"
        rows={3}
        style={textareaStyle}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button type="button" disabled={busy} onClick={() => onSubmit(note.trim())} style={confirmBtnStyle}>
          Resolve
        </button>
      </div>
    </Panel>
  );
}

function CoachPanel({ busy, haulerId, haulerDisplay, onCancel, onSubmit }) {
  // Axle alerts already prescribe dispatcher coaching in the action field,
  // so the topic defaults to the intervention this alert was asking for.
  // Session counts + expected delta capture whether the intervention was
  // substantive (not a tick-box), and the 7-day cooldown downstream is
  // triggered purely by the session existing — not by these numbers.
  // Phase 54 — operator picks the actual drivers attending; the
  // attendees_count field is auto-derived from the selection so the
  // two stay consistent.
  const [dispatcher, setDispatcher] = useState('');
  const [delta, setDelta]           = useState('-40');
  const [notes, setNotes]           = useState('');
  const [drivers, setDrivers]       = useState([]);
  const [picked, setPicked]         = useState(new Set());
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!haulerId) return;
    authFetch(`/api/drivers?hauler_id=${encodeURIComponent(haulerId)}`)
      .then((r) => (r.ok ? r.json() : { drivers: [] }))
      .then((j) => setDrivers(j.drivers ?? []))
      .catch(() => { /* drivers list is decorative if fetch fails */ });
  }, [haulerId]);

  const togglePicked = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const disabled = busy || !dispatcher.trim();
  const submit = () => onSubmit({
    dispatcher_name:    dispatcher.trim(),
    attendees_count:    picked.size > 0 ? picked.size : null,
    attendee_driver_ids: Array.from(picked),
    expected_delta_pct: delta === '' ? null : Number(delta),
    notes:              notes.trim() || null,
  });

  return (
    <Panel onCancel={onCancel} title={`Log coaching session · ${haulerDisplay || 'hauler'}`}>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        marginBottom: 8,
        lineHeight: 1.55,
      }}>
        Topic: <em style={{ color: 'var(--text-secondary)' }}>Pre-departure axle verification</em>.
        This alert auto-closes on submit; a 7-day cooldown suppresses re-emission while the intervention is fresh.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>Dispatcher *</span>
        <input
          ref={ref}
          type="text"
          value={dispatcher}
          onChange={(e) => setDispatcher(e.target.value)}
          placeholder="e.g. Kofi Owusu"
          style={inputStyle}
        />
      </label>

      {/* Phase 54 — driver attendee checkboxes. Auto-derives the
          attendees_count on submit so the count + named-attendees
          stay in sync. Hidden when no drivers loaded yet. */}
      {drivers.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Drivers attending · {picked.size} of {drivers.length}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 4,
            maxHeight: 180,
            overflowY: 'auto',
            padding: 6,
            background: 'var(--surface)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-hairline)',
          }}>
            {drivers.map((d) => {
              const checked = picked.has(d.id);
              return (
                <label
                  key={d.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: checked ? 'var(--accent-tint)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 'var(--ts-caption-size)',
                    fontFamily: 'inherit',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePicked(d.id)}
                  />
                  <span style={{
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {d.full_name}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>Expected hold-rate delta (%)</span>
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="-40"
          style={inputStyle}
        />
      </label>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What did you cover? Who committed to what?"
        rows={3}
        style={textareaStyle}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button type="button" disabled={disabled} onClick={submit} style={confirmBtnStyle}>
          Log session & close alert
        </button>
      </div>
    </Panel>
  );
}

function Panel({ title, children, onCancel }) {
  return (
    <div style={{
      marginTop: 'var(--space-3)',
      padding: 'var(--space-3)',
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{title}</span>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', border: 'none',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
      {children}
    </div>
  );
}

const presetBtnStyle = {
  padding: '6px 12px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const confirmBtnStyle = {
  padding: '6px 12px',
  background: 'var(--charcoal)',
  color: 'var(--bone)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontWeight: 'var(--fw-medium)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const selectStyle = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

const inputStyle = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

const textareaStyle = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  resize: 'vertical',
};

function formatRelative(iso) {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const hrs = Math.round((now - then) / 3_600_000);
  if (hrs < 1)   return 'NOW';
  if (hrs < 24)  return `${hrs}H AGO`;
  const days = Math.round(hrs / 24);
  return `${days}D AGO`;
}

function formatAbsolute(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Africa/Accra',
  });
}
