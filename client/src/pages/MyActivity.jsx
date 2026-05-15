/*
 * My activity — Phase 91.
 *
 * First-person view of the calling user's contribution over the
 * last N days. Composed live from the audit log (Phase 41) by
 * filtering on actor_user_id. Pure read-side; no new state.
 *
 * Distinct from Day-in-Review (Phase 51, corridor close-out for
 * the operator's shift) and Week-in-Review (Phase 68, corridor
 * synthesis for the week). My activity is the *first-person*
 * view of personal contribution.
 *
 * KPI strip + action item flow tile + by-category breakdown +
 * daily sparkline + recent-events timeline (25 most recent).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  PlusCircle,
  MessageSquare,
  AlertTriangle,
  RotateCcw,
  Clock,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

const HORIZONS = [
  { days: 7,  label: '7 days'  },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

// Operator-friendly category labels (CATEGORY_BY_TYPE values).
const CATEGORY_LABEL = {
  action_items:    'Action items',
  handovers:       'Handovers',
  risks:           'Risks',
  contacts:        'Hauler contacts',
  planning:        'Forecast scenarios',
  playbooks:       'Playbooks',
  maintenance:     'Maintenance',
  settlements:     'Settlements',
  claims:          'Claims',
  broadcasts:      'Broadcasts',
  lender_outputs:  'Lender outputs',
  forecasts:       'Forecasts',
  integrations:    'Integrations',
  other:           'Other',
};

// Per-category deep-link target. Where it makes sense to jump back to
// the surface that owns this kind of work.
const CATEGORY_LINK = {
  action_items:   '/inbox',
  handovers:      '/',
  risks:          '/risks',
  contacts:       '/haulers',
  playbooks:      '/playbooks',
  maintenance:    '/maintenance',
  settlements:    '/settlements',
  claims:         '/claims',
  broadcasts:     '/alerts',
  lender_outputs: '/lender/pack',
  forecasts:      '/financials',
  integrations:   '/settings',
};

// Friendly action labels for the timeline.
const ACTION_LABEL = {
  assign:                  'opened',
  unassign:                'closed',
  auto_clear:              'auto-closed',
  snooze:                  'snoozed',
  unsnooze:                'unsnoozed',
  reassign:                'reassigned',
  comment:                 'commented on',
  comment_delete:          'deleted comment on',
  escalate:                'escalated',
  escalation_ack:          'acknowledged escalation on',
  create:                  'created',
  update:                  'updated',
  delete:                  'deleted',
  submit:                  'submitted',
  publish:                 'published',
  archive:                 'archived',
  resolve:                 'resolved',
  ack:                     'acknowledged',
};

// Per-entity-type deep-link target for a single audit row.
const ENTITY_LINK = {
  action_item:          '/inbox',
  handover_note:        '/',
  risk:                 '/risks',
  risk_step:            '/risks',
  risk_comment:         '/risks',
  hauler_contact:       '/haulers',
  forecast_scenario:    '/sensitivity',
  forecast:             '/financials',
  forecast_snapshot:    '/financials',
  playbook:             '/playbooks',
  playbook_run:         '/playbooks',
  playbook_item:        '/playbooks',
  maintenance_schedule: '/maintenance',
  settlement:           '/settlements',
  claim:                '/claims',
  broadcast:            '/alerts',
  lender_pack:          '/lender/pack',
  integration_sync:     '/settings',
};

export default function MyActivity() {
  const { user } = useAuth();
  const [days, setDays]     = useState(7);
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    authFetch(`/api/me/activity?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [days]);

  const total = data?.counts?.total ?? 0;
  const flow  = data?.counts?.action_item_flow ?? {};
  const byCat = useMemo(() => {
    const obj = data?.counts?.by_category ?? {};
    return Object.entries(obj).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <PageShell
      eyebrow="Activity"
      title="My activity"
      description={
        user
          ? `First-person view of ${user.display_name.split(' ')[0]}'s contribution. Composed live from the audit log — counts and timeline reflect what you've personally touched in the last ${days} days.`
          : 'First-person view of your platform contribution.'
      }
      actions={<HorizonPicker value={days} onChange={setDays} />}
    >
      {error && <div style={errorBox}>Activity unavailable — {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <KpiStrip total={total} flow={flow} />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
          gap: 'var(--space-3)',
        }}>
          <ActionItemFlow flow={flow} />
          <DailySparkline series={data?.daily_series ?? []} />
        </div>

        <ByCategory rows={byCat} />

        <RecentTimeline rows={data?.recent ?? []} />
      </div>
    </PageShell>
  );
}

// ── Horizon picker ────────────────────────────────────────────────

function HorizonPicker({ value, onChange }) {
  return (
    <div style={{
      display: 'inline-flex',
      gap: 4,
      padding: 4,
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
    }}>
      {HORIZONS.map((h) => {
        const active = value === h.days;
        return (
          <button
            key={h.days}
            type="button"
            onClick={() => onChange(h.days)}
            style={{
              padding: '4px 10px',
              background: active ? 'var(--accent-tint)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: active ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
              fontSize: 'var(--ts-caption-size)',
              fontWeight: active ? 'var(--fw-medium)' : 'normal',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {h.label}
          </button>
        );
      })}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ total, flow }) {
  const closed   = flow.closed   ?? 0;
  const opened   = flow.opened   ?? 0;
  const cmt      = flow.commented ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile
        label="Total events"
        value={total}
        sub={total === 0 ? 'no audit log entries in window' : 'audit log entries you authored'}
        tone={total === 0 ? 'tertiary' : 'text'}
        Icon={Activity}
      />
      <Tile
        label="Action items closed"
        value={closed}
        sub={closed === 0 ? 'none in window' : 'unassigned or auto-cleared'}
        tone={closed > 0 ? 'green' : 'tertiary'}
        Icon={CheckCircle2}
      />
      <Tile
        label="Action items opened"
        value={opened}
        sub={opened === 0 ? 'none assigned to you' : 'assigned to you'}
        tone={opened > 0 ? 'rust' : 'tertiary'}
        Icon={PlusCircle}
      />
      <Tile
        label="Comments"
        value={cmt}
        sub={cmt === 0 ? 'no comments authored' : 'on action items'}
        tone={cmt > 0 ? 'text' : 'tertiary'}
        Icon={MessageSquare}
      />
    </div>
  );
}

function Tile({ label, value, sub, tone, Icon }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          {label.toUpperCase()}
        </span>
        {Icon && <Icon size={12} strokeWidth={1.6} color="var(--text-tertiary)" />}
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

// ── Action item flow ──────────────────────────────────────────────

function ActionItemFlow({ flow }) {
  const items = [
    { key: 'opened',      label: 'Opened',      Icon: PlusCircle,     tone: 'rust'  },
    { key: 'closed',      label: 'Closed',      Icon: CheckCircle2,   tone: 'green' },
    { key: 'snoozed',     label: 'Snoozed',     Icon: Clock,          tone: 'amber' },
    { key: 'commented',   label: 'Commented',   Icon: MessageSquare,  tone: 'text'  },
    { key: 'reassigned',  label: 'Reassigned',  Icon: RotateCcw,      tone: 'text'  },
    { key: 'escalated',   label: 'Escalated',   Icon: AlertTriangle,  tone: 'rust'  },
  ];
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
        ACTION ITEM FLOW
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        rowGap: 'var(--space-3)',
        columnGap: 'var(--space-3)',
      }}>
        {items.map((it) => {
          const v = flow[it.key] ?? 0;
          const dim = v === 0;
          const color = dim ? 'var(--text-tertiary)'
                      : it.tone === 'rust'  ? 'var(--bauxite-rust)'
                      : it.tone === 'green' ? 'var(--signal-green)'
                      : it.tone === 'amber' ? 'var(--signal-amber)'
                      : 'var(--text)';
          return (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <it.Icon size={14} strokeWidth={1.6} color={color} />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span className="tabular" style={{
                  fontSize: 18,
                  fontWeight: 'var(--fw-medium)',
                  color,
                }}>
                  {v}
                </span>
                <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                  {it.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Daily sparkline ───────────────────────────────────────────────

function DailySparkline({ series }) {
  const max = Math.max(1, ...series.map((d) => d.n));
  // Cap visible bars at 30 so 90d still reads. Otherwise show all.
  const visible = series.length > 30 ? series.slice(-30) : series;
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-3)',
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          DAILY ACTIVITY
        </span>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          peak: <span className="tabular" style={{ color: 'var(--text-secondary)' }}>{max}</span>
        </span>
      </div>
      {visible.length === 0 ? (
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          No data in window.
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`,
            alignItems: 'end',
            gap: 2,
            height: 60,
          }}>
            {visible.map((d) => {
              const h = d.n === 0 ? 2 : Math.max(2, Math.round((d.n / max) * 56));
              return (
                <div
                  key={d.date}
                  title={`${d.date} · ${d.n} events`}
                  style={{
                    height: h,
                    background: d.n === 0 ? 'var(--border-soft)' : 'var(--bauxite-rust)',
                    opacity: d.n === 0 ? 0.5 : 1,
                    borderRadius: 1,
                  }}
                />
              );
            })}
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6,
            fontSize: 10,
            color: 'var(--text-tertiary)',
          }}>
            <span className="mono">{visible[0]?.date}</span>
            <span className="mono">{visible[visible.length - 1]?.date}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── By category bar list ─────────────────────────────────────────

function ByCategory({ rows }) {
  const navigate = useNavigate();
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
        BY CATEGORY
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          No activity in window.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(([cat, n]) => {
            const link = CATEGORY_LINK[cat];
            const label = CATEGORY_LABEL[cat] || cat;
            const pct = (n / max) * 100;
            return (
              <div
                key={cat}
                onClick={link ? () => navigate(link) : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr 40px',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: link ? 'pointer' : 'default',
                }}
                onMouseEnter={(e) => { if (link) e.currentTarget.style.background = 'var(--accent-tint)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  color: 'var(--text)',
                }}>
                  {label}
                </span>
                <div style={{
                  height: 6,
                  background: 'var(--surface)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: 'var(--bauxite-rust)',
                    opacity: 0.85,
                  }} />
                </div>
                <span className="tabular" style={{
                  textAlign: 'right',
                  fontSize: 'var(--ts-body-sm-size)',
                  color: 'var(--text-secondary)',
                  fontWeight: 'var(--fw-medium)',
                }}>
                  {n}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Recent timeline ──────────────────────────────────────────────

function RecentTimeline({ rows }) {
  const navigate = useNavigate();
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          RECENT EVENTS
        </span>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          25 most recent
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{
          padding: 'var(--space-5)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
          textAlign: 'center',
        }}>
          Nothing yet — once you assign action items, post handovers, or update risks, they'll show up here.
        </div>
      ) : (
        <div>
          {rows.map((r) => {
            const link = ENTITY_LINK[r.entity_type];
            const verb = ACTION_LABEL[r.action] || r.action;
            return (
              <div
                key={r.id}
                onClick={link ? () => navigate(link) : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr auto',
                  columnGap: 12,
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border-hairline)',
                  cursor: link ? 'pointer' : 'default',
                }}
                onMouseEnter={(e) => { if (link) e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span className="mono" style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.04em',
                }}>
                  {relTime(r.ts)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--ts-body-sm-size)',
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{verb}</span>
                    {' '}
                    <span style={{ fontWeight: 'var(--fw-medium)' }}>
                      {r.summary || `${r.entity_type} ${r.entity_id}`}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 'var(--ts-caption-size)',
                    color: 'var(--text-tertiary)',
                    marginTop: 2,
                  }}>
                    <span className="mono" style={{ letterSpacing: '0.04em' }}>
                      {r.entity_type.toUpperCase()}
                    </span>
                    {r.entity_id && (
                      <span> · <span className="mono">{r.entity_id}</span></span>
                    )}
                  </div>
                </div>
                {link && (
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                  }}>
                    OPEN →
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14)    return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

const errorBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
};
