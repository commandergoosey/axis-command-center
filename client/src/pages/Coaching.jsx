/*
 * Coaching — Phase 81.
 *
 * Driver-level coaching workflow. The cockpit's safety story
 * lives at the rig + driver level; this page surfaces the
 * pipeline of drivers needing intervention and the recent
 * session log.
 *
 * Composed server-side via /api/coaching/pipeline. Sessions are
 * recorded via the existing Phase 30 endpoint (reused).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  GraduationCap, Plus, X, AlertCircle, Calendar, Users, Filter,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import Button from '../components/primitives/Button';
import Modal from '../components/primitives/Modal';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

const TIER_TONE = {
  urgent:  'var(--bauxite-rust)',
  high:    'var(--bauxite-rust)',
  medium:  'var(--signal-amber)',
  routine: 'var(--text-secondary)',
};
const TIER_LABEL = {
  urgent:  'Urgent',
  high:    'High',
  medium:  'Medium',
  routine: 'Routine',
};

const FLAG_LABEL = {
  rest_breach:      'Rest breach',
  coaching_due:     'Coaching due',
  licence_expiring: 'Licence expiring',
  psv_expiring:     'PSV expiring',
};

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops', 'hauler_admin']);

export default function Coaching() {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [composeFor, setComposeFor] = useState(null); // null | driver row
  const [tierFilter, setTierFilter] = useState(null);

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/coaching/pipeline')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredPipeline = (data?.pipeline ?? []).filter((r) =>
    !tierFilter || r.tier === tierFilter,
  );

  return (
    <PageShell
      eyebrow="Operations"
      title="Driver coaching"
      description="Pipeline of drivers needing intervention — flagged for rest breach, coaching due, or past their routine cadence. Log sessions inline; outcomes show up in the recent-sessions log."
    >
      {error && <div style={errorBox}>Coaching pipeline unavailable — {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <KpiStrip counts={data?.counts} />

        <FilterRow
          tierFilter={tierFilter}
          setTierFilter={setTierFilter}
          counts={data?.counts}
        />

        <PipelineTable
          rows={filteredPipeline}
          capped={data?.pipeline_capped}
          canWrite={canWrite}
          onLogSession={setComposeFor}
        />

        <RecentSessionsCard sessions={data?.recent_sessions ?? []} />
      </div>

      {composeFor && (
        <SessionFormModal
          driver={composeFor}
          onClose={() => setComposeFor(null)}
          onSaved={() => { setComposeFor(null); load(); }}
        />
      )}
    </PageShell>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ counts }) {
  const total    = counts?.total    ?? 0;
  const flagged  = counts?.flagged  ?? 0;
  const overdue  = counts?.overdue  ?? 0;
  const urgent   = counts?.by_tier?.urgent ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile label="In pipeline" value={total} sub="needing intervention" tone={total === 0 ? 'tertiary' : 'text'} />
      <Tile label="Urgent" value={urgent} sub={urgent > 0 ? 'rest breach or active flag' : 'none urgent'} tone={urgent > 0 ? 'rust' : 'green'} />
      <Tile label="Flagged" value={flagged} sub={flagged > 0 ? 'driver-level flag set' : 'no flags active'} tone={flagged > 0 ? 'amber' : 'green'} />
      <Tile label="Past cadence" value={overdue} sub={overdue > 0 ? 'overdue routine session' : 'cadence current'} tone={overdue > 0 ? 'amber' : 'green'} />
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)', fontWeight: 'var(--fw-black)',
        color, lineHeight: 1.05,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

// ── Filter chips ──────────────────────────────────────────────────

function FilterRow({ tierFilter, setTierFilter, counts }) {
  const tiers = ['urgent', 'high', 'medium', 'routine'];
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>FILTER</span>
      <Chip
        label={`All${counts?.total != null ? ` · ${counts.total}` : ''}`}
        active={!tierFilter}
        onClick={() => setTierFilter(null)}
      />
      {tiers.map((t) => {
        const n = counts?.by_tier?.[t] ?? 0;
        if (n === 0) return null;
        return (
          <Chip
            key={t}
            label={`${TIER_LABEL[t]} · ${n}`}
            tone={TIER_TONE[t]}
            active={tierFilter === t}
            onClick={() => setTierFilter((f) => f === t ? null : t)}
          />
        );
      })}
    </div>
  );
}

function Chip({ label, active, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--accent-tint)' : 'transparent',
        border: `1px solid ${active ? (tone || 'var(--bauxite-rust)') : 'var(--border-hairline)'}`,
        borderRadius: 999,
        fontSize: 'var(--ts-caption-size)',
        color: active ? (tone || 'var(--bauxite-rust)') : 'var(--text-secondary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Pipeline table ────────────────────────────────────────────────

function PipelineTable({ rows, capped, canWrite, onLogSession }) {
  if (!rows || rows.length === 0) {
    return (
      <p style={emptyBox}>No drivers in the coaching pipeline.</p>
    );
  }
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface)' }}>
            <th style={th}>Driver</th>
            <th style={th}>Hauler</th>
            <th style={th}>Tier</th>
            <th style={th}>Flag</th>
            <th style={th}>Safety</th>
            <th style={th}>Last session</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tone = TIER_TONE[r.tier] || 'var(--text)';
            return (
              <tr key={r.driver_id} style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                <td style={{ ...td, borderLeft: `3px solid ${tone}` }}>
                  <div style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                    {r.full_name}
                  </div>
                  {r.assigned_plate && (
                    <div className="mono" style={{
                      fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2,
                    }}>
                      {r.assigned_plate}
                    </div>
                  )}
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>
                  {r.hauler_id}
                </td>
                <td style={td}>
                  <Pill label={TIER_LABEL[r.tier]} tone={tone} />
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>
                  {r.flag ? FLAG_LABEL[r.flag] || r.flag : <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>cadence only</span>}
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: r.safety_score >= 80 ? 'var(--text)' : r.safety_score >= 70 ? 'var(--signal-amber)' : 'var(--bauxite-rust)' }}>
                    {r.safety_score}
                  </span>
                  {r.harsh_events_7d > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-tertiary)' }}>
                      ({r.harsh_events_7d}× harsh 7d)
                    </span>
                  )}
                </td>
                <td style={td}>
                  {r.days_since_last == null ? (
                    <span style={{ color: 'var(--bauxite-rust)' }}>never coached</span>
                  ) : (
                    <span style={{ color: r.overdue ? 'var(--signal-amber)' : 'var(--text-secondary)' }}>
                      {r.days_since_last}d ago
                    </span>
                  )}
                  {r.last_session_topic && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {r.last_session_topic}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => onLogSession(r)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 10px',
                        background: 'var(--bauxite-rust)',
                        color: 'var(--bone)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--ts-caption-size)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <Plus size={11} strokeWidth={1.8} />
                      Log session
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {capped && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          textAlign: 'center',
        }}>
          Showing top 50. Filter by tier to narrow further.
        </div>
      )}
    </div>
  );
}

function Pill({ label, tone }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 10%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone,
      fontSize: 10,
      fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

// ── Recent sessions ───────────────────────────────────────────────

function RecentSessionsCard({ sessions }) {
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <h2 style={{
          margin: 0, fontSize: 'var(--ts-h3-size)',
          fontWeight: 'var(--fw-medium)', color: 'var(--text)',
        }}>
          Recent sessions
        </h2>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {sessions.length} in last 30 days
        </span>
      </header>
      {sessions.length === 0 ? (
        <p style={{
          margin: 0, fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)', fontStyle: 'italic',
        }}>
          No coaching sessions logged yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{
              padding: '8px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}>
                <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                  {s.topic}
                </span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {new Date(s.held_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}
                </span>
              </div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                {s.hauler_id} · {s.dispatcher_name || 'unattributed'} · {s.attendees_count ?? 0} attendees
                {s.attendee_driver_ids?.length > 0 && (
                  <span> · {s.attendee_driver_ids.length} driver{s.attendee_driver_ids.length === 1 ? '' : 's'} linked</span>
                )}
              </div>
              {s.notes && (
                <p style={{
                  margin: '4px 0 0',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}>
                  {s.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Log session modal ────────────────────────────────────────────

function SessionFormModal({ driver, onClose, onSaved }) {
  const [topic, setTopic]     = useState('');
  const [notes, setNotes]     = useState('');
  const [dispatcher, setDispatcher] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  async function save() {
    if (!topic.trim() || posting) return;
    setPosting(true); setError(null);
    try {
      const r = await authFetch('/api/coaching/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hauler_id: driver.hauler_id,
          topic: topic.trim(),
          notes: notes.trim() || null,
          dispatcher_name: dispatcher.trim() || null,
          attendees_count: 1,
          attendee_driver_ids: [driver.driver_id],
          held_at: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  return (
    <Modal open onClose={onClose} width={600}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Log coaching session
            </div>
            <h2 style={{
              margin: 0, fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {driver.full_name}
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              {driver.hauler_id} · {driver.assigned_plate || 'no rig assigned'}
              {driver.flag && ` · flag: ${FLAG_LABEL[driver.flag] || driver.flag}`}
            </p>
          </div>
          <button type="button" onClick={onClose} style={closeBtn}>
            <X size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Topic">
            <input
              type="text" value={topic} maxLength={120}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={driver.flag === 'rest_breach' ? 'e.g. Rest hours review + dispatcher escalation' : 'What was the session about?'}
              style={inputStyle}
            />
          </Field>
          <Field label="Dispatcher / coach name (optional)">
            <input
              type="text" value={dispatcher} maxLength={80}
              onChange={(e) => setDispatcher(e.target.value)}
              placeholder="e.g. Akua Owusu, Hauler 03 dispatcher"
              style={inputStyle}
            />
          </Field>
          <Field label="Notes (optional)">
            <textarea
              value={notes} maxLength={1000} rows={4}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Outcome, agreed actions, follow-up commitments…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || 'Linked to this driver — count toward their coaching cadence.'}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!topic.trim() || posting}>
              {posting ? 'Saving…' : 'Log session'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
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
};
const th = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  fontWeight: 500,
};
const td = {
  padding: '10px',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  lineHeight: 1.4,
  verticalAlign: 'top',
};
const closeBtn = {
  padding: 4, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-tertiary)',
};
const errorBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
};
const emptyBox = {
  margin: 0,
  padding: 'var(--space-5)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
  textAlign: 'center',
};
