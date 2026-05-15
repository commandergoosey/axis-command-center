/*
 * NotificationPrefsPanel — Phase 63.
 *
 * Per-user notification preferences. Default-on policy: every event
 * type fires unless the user explicitly opts out. Renders a toggle
 * row per known event type with a label and a small "default"
 * caption when the user hasn't overridden the value yet.
 *
 * Lives on Settings — visible to all roles (every user has their own
 * notification feed; lender too, even if they currently receive few
 * notifications). Self-only: each user sees their own prefs, axis_admin
 * doesn't get to manage other users' prefs from here (would defeat the
 * point of personal control).
 */

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { authFetch } from '../../lib/auth';

export default function NotificationPrefsPanel() {
  const [prefs, setPrefs]     = useState(null);
  const [error, setError]     = useState(null);
  const [pendingType, setPendingType] = useState(null); // event_type currently being toggled

  const load = async () => {
    try {
      const r = await authFetch('/api/notifications/prefs');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setPrefs(j.prefs ?? []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (event_type, current) => {
    setPendingType(event_type);
    setError(null);
    try {
      const r = await authFetch('/api/notifications/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type, enabled: !current }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingType(null);
    }
  };

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <Bell size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
        <span className="eyebrow">Notification preferences</span>
        <span className="mono" style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
        }}>
          {prefs ? `${prefs.filter((p) => p.enabled).length} of ${prefs.length} enabled` : ''}
        </span>
      </header>

      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(139, 46, 26, 0.08)',
          color: 'var(--bauxite-rust)',
          fontSize: 'var(--ts-caption-size)',
        }}>
          {error}
        </div>
      )}

      {!prefs ? (
        <div style={{
          padding: 'var(--space-4)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
        }}>
          Loading preferences…
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {prefs.map((p) => (
            <li key={p.event_type} style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border-hairline)',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}>
              <div>
                <div style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  color: 'var(--text)',
                  fontWeight: 'var(--fw-medium)',
                }}>
                  {p.label}
                </div>
                <div style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                }}>
                  <span className="mono">{p.event_type}</span>
                  {p.is_default ? (
                    <span style={{ marginLeft: 8, fontStyle: 'italic' }}>· default</span>
                  ) : (
                    <span style={{ marginLeft: 8 }}>
                      · last updated {new Date(p.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={pendingType === p.event_type}
                onClick={() => toggle(p.event_type, p.enabled)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  fontSize: 11,
                  background: p.enabled ? 'var(--surface)' : 'transparent',
                  border: `1px solid ${p.enabled ? 'var(--signal-green)' : 'var(--border-hairline)'}`,
                  color: p.enabled ? 'var(--signal-green)' : 'var(--text-tertiary)',
                  borderRadius: 999,
                  cursor: pendingType === p.event_type ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 'var(--fw-medium)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {p.enabled ? <Bell size={11} /> : <BellOff size={11} />}
                {p.enabled ? 'On' : 'Off'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
