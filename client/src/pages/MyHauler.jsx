/*
 * MyHauler — Phase 79.
 *
 * Hauler-side dashboard. The hauler_admin persona's default
 * landing page; AXIS roles can pass `?hauler_id=` to view the
 * same composition for any hauler.
 *
 * Composed server-side by services/myHauler.js. The page renders
 * AXIS's view *of* this hauler — not the operator's view. So the
 * hauler admin sees what AXIS sees about them: their MTD
 * attainment, AXIS's open action items mentioning them, the
 * AXIS contact log entries with their counterparties, the open
 * alerts, the fleet flags, the recent audit trail.
 *
 * Goal: a hauler admin should never need to dig through AXIS's
 * operator surfaces to know where they stand.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Building2, TrendingUp, TrendingDown, Minus, Phone, MessageCircle, Mail, MapPin,
  Users, ShieldAlert, Wrench, IdCard, AlertTriangle, FileText, ScrollText, ArrowRight,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import BroadcastBanner from '../components/today/BroadcastBanner';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

const VERDICT_LABEL = {
  on_pace_for_contracted: 'On pace for contracted',
  above_floor:            'Above floor, below contracted',
  banked_floor_drift:     'Floor banked — pace slipping',
  below_floor_at_pace:    'Below floor at pace',
  on_pace:                'On pace',
  drift:                  'Drift · within tolerance',
  lagging:                'Lagging',
  severely_lagging:       'Severely lagging',
};
const VERDICT_TONE = {
  on_pace_for_contracted: 'green',
  on_pace:                'green',
  above_floor:            'text',
  drift:                  'text',
  banked_floor_drift:     'amber',
  lagging:                'amber',
  below_floor_at_pace:    'amber',
  severely_lagging:       'rust',
};

const CHANNEL_ICON = {
  phone: Phone, whatsapp: MessageCircle, email: Mail, site_visit: MapPin, meeting: Users,
};

export default function MyHauler() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);

  // AXIS roles can pass ?hauler_id=...; hauler_admin's hauler is
  // implicit in their token.
  const params = new URLSearchParams(location.search);
  const haulerIdQuery = params.get('hauler_id');

  const load = useCallback(() => {
    setError(null);
    const url = haulerIdQuery
      ? `/api/me/hauler?hauler_id=${encodeURIComponent(haulerIdQuery)}`
      : '/api/me/hauler';
    authFetch(url)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, [haulerIdQuery]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <PageShell eyebrow="Corridor" title="My hauler">
        <div style={errorBox}>{error}</div>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell eyebrow="Corridor" title="My hauler">
        <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' }}>Composing dashboard…</p>
      </PageShell>
    );
  }

  const c = data.corridor;
  const sub = user?.role === 'hauler_admin'
    ? `AXIS's view of your corridor presence — KPIs, contacts, action items, fleet health.`
    : `View of ${c.display_name}'s corridor presence — what AXIS sees about this hauler.`;

  return (
    <PageShell
      eyebrow="Corridor"
      title={c.display_name}
      description={sub}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <BroadcastBanner refreshKey={data?.generated_at} />
        <CorridorHeader corridor={c} />
        <KpiRow mtd={data.mtd} performance={data.performance} corridor={c} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
          gap: 'var(--space-4)',
          alignItems: 'flex-start',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <FleetHealthCard fleetHealth={data.fleet_health} />
            <RecentAuditCard rows={data.recent_audit} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <ActionItemsCard items={data.action_items} navigate={navigate} />
            <OpenAlertsCard alerts={data.open_alerts} navigate={navigate} />
            <ContactsCard contacts={data.contacts} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

// ── Corridor header ──────────────────────────────────────────────

function CorridorHeader({ corridor }) {
  const apiTone = corridor.integration.api_status === 'connected' ? 'var(--signal-green)'
                : corridor.integration.api_status === 'degraded' ? 'var(--signal-amber)'
                : 'var(--text-tertiary)';
  return (
    <section style={card}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto auto auto auto auto',
        gap: 'var(--space-4)',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={20} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span style={{ fontSize: 14, fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
            {corridor.hauler_id} · onboarded {corridor.onboarded_date}
          </span>
        </span>
        <Stat label="Contracted" value={corridor.contracted_trucks} />
        <Stat label="Active" value={corridor.active_trucks} />
        <Stat label="Idle" value={corridor.idle_trucks} tone={corridor.idle_trucks > 0 ? 'rust' : 'tertiary'} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: apiTone,
          }} />
          <span className="mono" style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {corridor.integration.type} · {corridor.integration.api_status}
          </span>
        </span>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 18, fontWeight: 'var(--fw-medium)', color,
      }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

// ── KPI row ─────────────────────────────────────────────────────

function KpiRow({ mtd, performance, corridor }) {
  const verdictTone = VERDICT_TONE[mtd.forecast_verdict] || 'text';
  const attTone = mtd.attainment_pct >= 90 ? 'green'
                : mtd.attainment_pct >= corridor.take_or_pay_floor_pct ? 'text'
                : mtd.attainment_pct >= 70 ? 'amber'
                : 'rust';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <KpiTile
        label="MTD attainment"
        value={`${mtd.attainment_pct.toFixed(0)}%`}
        sub={`${(mtd.delivered_mtd / 1000).toFixed(1)} kt of ${(mtd.contracted_mtd / 1000).toFixed(1)} kt`}
        tone={attTone}
      />
      <KpiTile
        label="Forecast EOM"
        value={mtd.forecast_eom != null ? `${(mtd.forecast_eom / 1000).toFixed(1)}kt` : '—'}
        sub={mtd.forecast_verdict ? VERDICT_LABEL[mtd.forecast_verdict] : '—'}
        tone={verdictTone}
      />
      <KpiTile
        label="On-time"
        value={performance ? `${performance.on_time_pct?.toFixed(0)}%` : '—'}
        sub={performance ? `SLA ${performance.sla_attainment_pct?.toFixed(0)}%` : 'inactive'}
        tone={performance && performance.on_time_pct >= 90 ? 'green' : 'text'}
      />
      <KpiTile
        label="Safety score"
        value={performance ? performance.safety_score : '—'}
        sub={performance && performance.safety_score >= 80 ? 'within target' : performance ? 'below target' : 'inactive'}
        tone={performance && performance.safety_score >= 80 ? 'green' : performance ? 'amber' : 'tertiary'}
      />
    </div>
  );
}

function KpiTile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{ ...card, padding: 'var(--space-4)' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
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

// ── Action items card ──────────────────────────────────────────

function ActionItemsCard({ items, navigate }) {
  return (
    <section style={card}>
      <SectionHeader
        title="Open action items"
        sub={items.length > 0 ? 'AXIS-side items mentioning this hauler' : 'No items mention this hauler.'}
        icon={ScrollText}
      />
      {items.length === 0 ? (
        <p style={emptyText}>Clean — no AXIS-side items currently reference this hauler.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it) => {
            const overdue = it.due_date && new Date(it.due_date).getTime() < Date.now();
            return (
              <div
                key={it.action_item_id}
                onClick={() => navigate('/')}
                style={{
                  padding: '8px 12px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border-hairline)',
                  borderLeft: `3px solid ${overdue ? 'var(--bauxite-rust)' : 'var(--signal-amber)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--ts-body-sm-size)',
                }}
              >
                <div style={{ color: 'var(--text)' }}>{it.action_item_id}</div>
                {it.assignee?.display_name && (
                  <div style={{
                    fontSize: 'var(--ts-caption-size)',
                    color: 'var(--text-tertiary)',
                    marginTop: 2,
                  }}>
                    {it.assignee.display_name}
                    {it.due_date && (
                      <span style={{ color: overdue ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
                        {' · due '}{it.due_date.slice(0, 10)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Open alerts card ───────────────────────────────────────────

function OpenAlertsCard({ alerts, navigate }) {
  return (
    <section style={card}>
      <SectionHeader title="Open alerts" sub={`${alerts.length} active`} icon={AlertTriangle} />
      {alerts.length === 0 ? (
        <p style={emptyText}>No alerts referencing this hauler.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alerts.map((a) => {
            const tone = a.severity === 'CRITICAL' ? 'var(--bauxite-rust)' : 'var(--signal-amber)';
            return (
              <div
                key={a.id}
                onClick={() => navigate('/alerts')}
                style={{
                  padding: '8px 12px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border-hairline)',
                  borderLeft: `3px solid ${tone}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--ts-body-sm-size)',
                }}
              >
                <div style={{ color: 'var(--text)' }}>{a.title}</div>
                <div className="mono" style={{
                  fontSize: 10, color: tone, letterSpacing: '0.06em', marginTop: 2,
                }}>
                  {a.severity} · {a.status}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Contacts card ─────────────────────────────────────────────

function ContactsCard({ contacts }) {
  return (
    <section style={card}>
      <SectionHeader
        title="Recent AXIS contacts"
        sub={contacts.length > 0 ? `${contacts.length} logged` : 'No logged contacts yet.'}
        icon={Phone}
      />
      {contacts.length === 0 ? (
        <p style={emptyText}>AXIS hasn't logged a contact with you yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contacts.map((c) => {
            const Icon = CHANNEL_ICON[c.channel] || Phone;
            return (
              <div key={c.id} style={{
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
                  marginBottom: 4,
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
                    <Icon size={11} strokeWidth={1.6} color="var(--text-tertiary)" />
                    <span style={{ fontWeight: 'var(--fw-medium)' }}>{c.counterparty_name || '—'}</span>
                  </span>
                  <span className="mono" style={{
                    fontSize: 10, color: 'var(--text-tertiary)',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    {c.outcome}
                  </span>
                </div>
                <p style={{
                  margin: 0,
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {c.summary}
                </p>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {c.author?.display_name ?? 'AXIS'} · {new Date(c.created_at).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', timeZone: 'UTC',
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Fleet health card ─────────────────────────────────────────

function FleetHealthCard({ fleetHealth }) {
  return (
    <section style={card}>
      <SectionHeader title="Fleet health" sub={`${fleetHealth.rigs_total} rigs total`} icon={Wrench} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}>
        <SubKpi label="In garage" value={fleetHealth.rigs_in_garage} tone={fleetHealth.rigs_in_garage > 0 ? 'amber' : 'green'} />
        <SubKpi label="Critical flag" value={fleetHealth.rigs_with_critical} tone={fleetHealth.rigs_with_critical > 0 ? 'rust' : 'green'} />
        <SubKpi label="Open workorders" value={fleetHealth.open_workorder_count} tone={fleetHealth.open_workorder_count > 0 ? 'amber' : 'green'} />
      </div>

      {fleetHealth.licence_expiries_60d.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            LICENCES EXPIRING (NEXT 60 DAYS)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {fleetHealth.licence_expiries_60d.map((l) => {
              const tone = l.days_remaining <= 14 ? 'var(--bauxite-rust)' : 'var(--signal-amber)';
              return (
                <div key={l.id} style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  columnGap: 8,
                  alignItems: 'center',
                  padding: '6px 10px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border-hairline)',
                  borderLeft: `3px solid ${tone}`,
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--ts-body-sm-size)',
                }}>
                  <IdCard size={11} strokeWidth={1.6} color={tone} />
                  <span style={{ color: 'var(--text)' }}>
                    {l.driver} — {l.document}
                  </span>
                  <span className="mono tabular" style={{
                    fontSize: 10, color: tone, letterSpacing: '0.04em',
                  }}>
                    {l.days_remaining}d
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {fleetHealth.at_risk_drivers.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            AT-RISK DRIVERS · {fleetHealth.at_risk_drivers.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {fleetHealth.at_risk_drivers.map((d) => (
              <div key={d.id} style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                columnGap: 8,
                alignItems: 'center',
                padding: '6px 10px',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
              }}>
                <Users size={11} strokeWidth={1.6} color="var(--signal-amber)" />
                <span style={{ color: 'var(--text)' }}>
                  {d.full_name}
                  {d.assigned_plate && (
                    <span className="mono" style={{
                      marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 10,
                    }}>
                      {d.assigned_plate}
                    </span>
                  )}
                </span>
                <span className="mono" style={{
                  fontSize: 10,
                  color: 'var(--signal-amber)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  {d.flag.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SubKpi({ label, value, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      textAlign: 'center',
    }}>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size, 24px)', fontWeight: 'var(--fw-black)',
        color: value === 0 ? 'var(--text-tertiary)' : color,
        lineHeight: 1.05,
      }}>
        {value}
      </div>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

// ── Recent audit card ─────────────────────────────────────────

function RecentAuditCard({ rows }) {
  return (
    <section style={card}>
      <SectionHeader
        title="Recent corridor activity"
        sub={`${rows.length} entries in last 30 days`}
        icon={FileText}
      />
      {rows.length === 0 ? (
        <p style={emptyText}>No corridor activity in the audit log mentions this hauler.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => (
            <div key={r.id} style={{
              padding: '8px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
            }}>
              <div style={{ color: 'var(--text)' }}>{r.summary}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {r.actor?.display_name ?? '—'} · {r.entity_type} · {r.action} · {' '}
                {new Date(r.ts).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  hour12: false, timeZone: 'UTC',
                })} UTC
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Shared bits ──────────────────────────────────────────────

function SectionHeader({ title, sub, icon: Icon }) {
  return (
    <header style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />}
        <span style={{
          fontSize: 'var(--ts-h3-size)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          {title}
        </span>
      </div>
      <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
        {sub}
      </span>
    </header>
  );
}

const card = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4) var(--space-5)',
};
const emptyText = {
  margin: 0,
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
};
const errorBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
};
