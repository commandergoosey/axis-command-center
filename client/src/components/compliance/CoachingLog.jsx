/*
 * CoachingLog — Phase 31.
 *
 * Reads /api/coaching/sessions and renders a compact log of the last 30
 * days. Used on the Compliance page to show that dispatcher coaching
 * interventions are logged — including attendees, expected hold-rate
 * delta, and the alerts each session auto-closed. Empty state invites
 * the operator to log a session from any open axle alert.
 */

import { useEffect, useState, useCallback } from 'react';
import { GraduationCap, Clock } from 'lucide-react';
import { authFetch } from '../../lib/auth';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default function CoachingLog() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/coaching/sessions');
      if (!res.ok) throw new Error(`coaching ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const recent = (sessions || []).filter((s) =>
    (Date.now() - new Date(s.held_at).getTime()) <= 30 * ONE_DAY_MS,
  );
  const activeCooldowns = (sessions || []).filter((s) =>
    (Date.now() - new Date(s.held_at).getTime()) <= 7 * ONE_DAY_MS,
  );

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
        gap: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">
            <GraduationCap size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Dispatcher coaching · last 30 days
          </div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Interventions logged against weighbridge patterns. Each session suppresses the matching axle-load alert for 7 days while the hold-rate delta plays out.
          </div>
        </div>
        <div className="mono" style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          padding: '3px 8px',
          borderRadius: 'var(--radius-sm)',
          background: activeCooldowns.length > 0 ? 'rgba(46, 107, 63, 0.12)' : 'var(--ash)',
          color:      activeCooldowns.length > 0 ? 'var(--signal-green)' : 'var(--text-tertiary)',
          whiteSpace: 'nowrap',
        }}>
          {activeCooldowns.length} ACTIVE COOLDOWN{activeCooldowns.length === 1 ? '' : 'S'}
        </div>
      </header>

      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-red)',
        }}>
          Coaching log unavailable — {error}
        </div>
      )}

      {sessions && recent.length === 0 && !error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface-sunk)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
          lineHeight: 1.55,
        }}>
          No coaching sessions logged in 30 days. Open an axle-load alert from the Alerts board and use <em>Coach dispatcher</em> to capture the next intervention.
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {recent.map((s) => {
            const days = Math.floor((Date.now() - new Date(s.held_at).getTime()) / ONE_DAY_MS);
            const inCooldown = days < 7;
            return (
              <article key={s.id} style={{
                display: 'grid',
                gridTemplateColumns: '1.3fr 1.4fr 1fr 1fr 1.4fr',
                gap: 'var(--space-3)',
                alignItems: 'baseline',
                padding: '10px var(--space-3)',
                background: inCooldown ? 'rgba(46, 107, 63, 0.05)' : 'var(--surface-sunk)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
              }}>
                <div>
                  <div style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                    Hauler {s.hauler_id.replace('haul-', '')}
                  </div>
                  <div className="mono" style={{
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.04em',
                    marginTop: 2,
                  }}>
                    {formatDay(s.held_at)}
                    {inCooldown && (
                      <span style={{ color: 'var(--signal-green)', marginLeft: 6 }}>
                        <Clock size={10} style={{ verticalAlign: '-1px' }} /> cooldown {7 - days}d left
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {s.dispatcher_name || '—'}
                  <div className="mono" style={{
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.04em',
                    marginTop: 2,
                    textTransform: 'uppercase',
                  }}>
                    {s.topic}
                  </div>
                </div>
                <span
                  className="tabular"
                  style={{ color: 'var(--text-secondary)' }}
                  title={
                    s.attendee_drivers?.length > 0
                      ? s.attendee_drivers.map((a) => a.display_name).join(', ')
                      : ''
                  }
                >
                  {s.attendee_drivers?.length > 0
                    ? `${s.attendee_drivers.length} named${
                        s.attendees_count != null && s.attendees_count !== s.attendee_drivers.length
                          ? ` of ${s.attendees_count}`
                          : ''
                      }`
                    : s.attendees_count != null
                      ? `${s.attendees_count} attended`
                      : '—'}
                </span>
                <span className="tabular" style={{
                  color: s.expected_delta_pct != null && s.expected_delta_pct < 0
                    ? 'var(--signal-green)'
                    : 'var(--text-secondary)',
                }}>
                  {s.expected_delta_pct != null ? `${s.expected_delta_pct}% expected` : '—'}
                </span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)', lineHeight: 1.5 }}>
                  {s.linked_alert_ids?.length > 0
                    ? `Auto-closed ${s.linked_alert_ids.length} alert${s.linked_alert_ids.length === 1 ? '' : 's'}`
                    : 'No linked alerts'}
                </span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Africa/Accra',
  });
}
