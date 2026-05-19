/*
 * Settings — axis_admin platform posture.
 * Three panels: system status, user directory, hauler integration roster.
 * Phase 11 layers credential rotation, role edits, and audit history.
 */

import { authFetch } from '../lib/auth';
import { useEffect, useState, useCallback } from 'react';
import { Server, Plug, CheckCircle2, Circle } from 'lucide-react';

import PageShell  from '../components/layout/PageShell';
import EmptyState from '../components/primitives/EmptyState';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';
import AuditPanel from '../components/settings/AuditPanel';
import BroadcastsPanel from '../components/settings/BroadcastsPanel';
import IntegrationHealthPanel from '../components/settings/IntegrationHealthPanel';
import UserManagementPanel from '../components/settings/UserManagementPanel';
import HaulerManagementPanel from '../components/settings/HaulerManagementPanel';
import NotificationPrefsPanel from '../components/settings/NotificationPrefsPanel';
import WebhookEventsPanel     from '../components/settings/WebhookEventsPanel';
import AlertRulesPanel        from '../components/settings/AlertRulesPanel';

function fmtSync(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function Settings() {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/settings');
      if (res.status === 403) {
        setError('forbidden');
        return;
      }
      if (!res.ok) throw new Error(`settings ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error === 'forbidden') {
    return (
      <PageShell
        eyebrow="Platform"
        title="Settings"
        description="Platform posture, user directory, and hauler integration roster. Axis admin only."
      >
        <EmptyState
          label="Settings is restricted to AXIS Admin"
          note="Your role does not have access to this surface. Sign in as an AXIS Admin to view user directory and integration credentials."
        />
        {/* LP-20 — notification prefs are personal; visible to all roles */}
        <div style={{ marginTop: 'var(--space-4)' }}>
          <NotificationPrefsPanel />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Platform"
      title="Settings"
      description="Platform posture, user directory, and hauler integration roster. Axis admin only."
    >
      {error && (
        <div style={bannerErrorStyle}>Settings feed unavailable — {error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SystemPanel system={data?.system} />
        <UserManagementPanel users={data?.users ?? []} onRefresh={load} />
        <HaulerManagementPanel />
        <BroadcastsPanel />
        <IntegrationsPanel integrations={data?.integrations ?? []} />
        <IntegrationHealthPanel haulers={data?.integrations ?? []} />
        <NotificationPrefsPanel />
        <AlertRulesPanel />
        <WebhookEventsPanel />
        <AuditPanel />
        <IntelligencePanel page="settings" />
      </div>
    </PageShell>
  );
}

function SystemPanel({ system }) {
  return (
    <Section icon={Server} title="System" count={system?.mode}>
      {!system ? (
        <Skeleton rows={2} />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
        }}>
          <Stat label="Product"   value={system.product} mono={false} />
          <Stat label="Version"   value={system.version} />
          <Stat label="Mode"      value={system.mode} />
          <Stat label="Uptime"    value={fmtUptime(system.uptime_s)} />
          <Stat label="Auth"      value={system.auth.scheme} mono={false} />
          <Stat label="Token TTL" value={`${system.auth.token_ttl_hours}h`} />
        </div>
      )}
    </Section>
  );
}


function IntegrationsPanel({ integrations }) {
  const liveCount = integrations.filter((i) => i.live).length;
  return (
    <Section icon={Plug} title="Hauler integrations" count={`${liveCount} live · ${integrations.length} total`}>
      {integrations.length === 0 ? (
        <Skeleton rows={4} />
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {integrations.map((i) => {
            const errored = (i.error_count_24h ?? 0) > 0;
            const live = i.live;
            const tone = live
              ? { label: 'LIVE',      fg: 'var(--signal-green)',  bg: 'rgba(46, 107, 63, 0.08)',  bd: 'rgba(46, 107, 63, 0.3)' }
              : errored
                ? { label: 'ERRORED', fg: 'var(--bauxite-rust)',  bg: 'rgba(139, 46, 26, 0.08)',  bd: 'rgba(139, 46, 26, 0.3)' }
                : i.has_credentials
                  ? { label: 'IDLE',    fg: 'var(--signal-amber)',  bg: 'rgba(217, 158, 55, 0.08)', bd: 'rgba(217, 158, 55, 0.3)' }
                  : { label: 'PENDING', fg: 'var(--text-tertiary)', bg: 'var(--accent-tint)',        bd: 'var(--border-hairline)' };
            return (
              <li key={i.hauler_id} style={rowGridStyle(['minmax(0, 1.2fr)', 'minmax(0, 0.6fr)', 'minmax(0, 0.9fr)', 'auto', 'auto'])}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                    {i.display_name}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {i.hauler_id}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {i.type}{i.adapter ? ` · ${i.adapter}` : ''}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {fmtSync(i.last_sync)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                  {i.has_credentials
                    ? <CheckCircle2 size={12} strokeWidth={1.6} color="var(--signal-green)" />
                    : <Circle       size={12} strokeWidth={1.6} color="var(--iron)" />}
                  {i.has_credentials ? 'Creds set' : 'No creds'}
                </span>
                <span className="mono" style={{
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  padding: '2px 8px',
                  background: tone.bg,
                  color: tone.fg,
                  border: `1px solid ${tone.bd}`,
                  borderRadius: 2,
                }}>
                  {tone.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Section({ icon: Icon, title, count, children }) {
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">{title}</span>
        </div>
        {count != null && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, mono = true }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div
        className={mono ? 'mono' : undefined}
        style={{
          fontSize: mono ? 13 : 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Skeleton({ rows = 3 }) {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: 12,
          marginBottom: 10,
          background: 'var(--accent-tint)',
          borderRadius: 2,
          opacity: 0.5,
        }} />
      ))}
    </div>
  );
}

function rowGridStyle(columns) {
  return {
    display: 'grid',
    gridTemplateColumns: columns.join(' '),
    gap: 'var(--space-3)',
    alignItems: 'center',
    padding: 'var(--space-3) var(--space-4)',
    borderTop: '1px solid var(--border-hairline)',
  };
}

const bannerErrorStyle = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--signal-amber)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
  marginBottom: 'var(--space-4)',
};
