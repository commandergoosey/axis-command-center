/*
 * HaulerDetail — drawer content for a single hauler. The list already
 * carries summary stats; on open the drawer lazy-fetches /api/haulers/:id
 * for lender-facing detail — fleet breakdown, driver roster, MTD
 * economics, 12-week SLA trend, settlement posture, and open alerts.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../primitives/Modal';
import ApiHealthDot from '../primitives/ApiHealthDot';
import StatusBadge from '../primitives/StatusBadge';
import Button from '../primitives/Button';
import IntegrationPanel from './IntegrationPanel';
import HaulerContactLog from './HaulerContactLog';
import HaulerOnboardingPanel from './HaulerOnboardingPanel';
import { formatPercent, formatTonnes } from '../../lib/format';
import { useAuth } from '../../lib/AuthContext';
import { authFetch, can } from '../../lib/auth';

const INTEGRATION_LABEL = {
  loconav: 'Loconav',
  custom:  'Custom FMS',
  manual:  'Manual CSV',
};

const STATUS_LABEL = {
  connected: 'Connected',
  degraded:  'Degraded',
  manual:    'Manual',
  pending:   'Pending',
};

export default function HaulerDetail({ hauler, open, onClose, onSynced }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [detailStatus, setDetailStatus] = useState('idle');

  useEffect(() => {
    if (!open || !hauler?.id) { setDetail(null); setDetailStatus('idle'); return; }
    let cancelled = false;
    setDetailStatus('loading');
    authFetch(`/api/haulers/${hauler.id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => { if (!cancelled) { setDetail(j); setDetailStatus('ready'); } })
      .catch(() => { if (!cancelled) setDetailStatus('error'); });
    return () => { cancelled = true; };
  }, [open, hauler?.id]);

  if (!hauler) return null;
  // Hauler admins only see their own integration panel; lenders see none.
  const showIntegrationPanel =
    can(user?.role, 'manageIntegration') &&
    (user?.role !== 'hauler_admin' || user?.hauler_id === hauler.id);

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Hauler · {hauler.id}
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
          }}>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--text)',
            }}>
              {hauler.display_name}
            </h2>
            <StatusBadge tone={hauler.api_status}>
              {STATUS_LABEL[hauler.api_status] ?? hauler.api_status}
            </StatusBadge>
          </div>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            Onboarded {formatDate(hauler.onboarded_date)} · {INTEGRATION_LABEL[hauler.integration.type] ?? hauler.integration.type}
            {hauler.integration.adapter ? ` (${hauler.integration.adapter})` : ''}
          </p>
        </header>

        <Section title="Fleet contribution">
          <Row label="Contracted trucks" value={hauler.fleet.contracted_trucks} />
          <Row label="Active trucks" value={hauler.status === 'active' ? hauler.fleet.active_trucks : '—'} />
          <Row label="Contract share" value={hauler.status === 'active' ? formatPercent(hauler.contract_share * 100, 1) : '—'} />
        </Section>

        <Section title="Month-to-date (modelled)">
          <Row label="Tonnes delivered" value={formatTonnes(hauler.tonnes_delivered_mtd)} />
          <Row label="Tonnes contracted" value={formatTonnes(hauler.tonnes_contracted_mtd)} />
          <Row label="Run rate" value={runRate(hauler)} />
        </Section>

        <Section title="Performance">
          <Row label="On-time" value={hauler.status === 'active' ? formatPercent(hauler.performance.on_time_pct, 0) : '—'} />
          <Row label="SLA attainment" value={hauler.status === 'active' ? formatPercent(hauler.performance.sla_attainment_pct, 1) : '—'} />
          <Row label="Safety score" value={hauler.status === 'active' ? hauler.performance.safety_score : '—'} />
        </Section>

        {/* Phase 133 — SLA monthly scorecard */}
        {hauler.status === 'active' && (
          <SlaScorecard hauler={hauler} />
        )}

        <Section title="Integration">
          <Row label="Type" value={INTEGRATION_LABEL[hauler.integration.type] ?? hauler.integration.type} />
          <Row
            label="API health"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ApiHealthDot status={hauler.api_status} />
                {STATUS_LABEL[hauler.api_status] ?? hauler.api_status}
              </span>
            }
          />
          <Row label="Last sync" value={formatSync(hauler.integration.last_sync)} />
          <Row label="Errors 24h" value={hauler.integration.error_count_24h ?? '—'} />
        </Section>

        {showIntegrationPanel && <IntegrationPanel hauler={hauler} onSynced={onSynced} />}

        {/* Phase 109 — onboarding checklist for pending haulers. Only
            rendered when the detail fetch has returned a checklist (i.e.
            the hauler was onboarded via the API and is still pending). */}
        {hauler.status === 'pending' && detail?.checklist && (
          <HaulerOnboardingPanel
            hauler={detail.onboarding_meta}
            haulerId={hauler.id}
            checklist={detail.checklist}
            onActivated={() => { onClose?.(); onSynced?.(); }}
            onUpdated={() => {
              // Re-fetch detail to pick up saved meta fields.
              authFetch(`/api/haulers/${hauler.id}`)
                .then((r) => r.ok ? r.json() : null)
                .then((j) => { if (j) setDetail(j); });
            }}
          />
        )}

        {/* Phase 69 — per-hauler contact log. Lender sees the log
            (read-only); axis ops/admin and the hauler's own admin
            can compose new entries. */}
        <HaulerContactLog haulerId={hauler.id} haulerName={hauler.display_name} />

        {detailStatus === 'loading' && (
          <p style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Loading lender detail…
          </p>
        )}
        {detailStatus === 'ready' && detail && (
          <LenderSections detail={detail} onClose={onClose} navigate={navigate} />
        )}

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {/* Phase 49 — opens the printable weekly scorecard for this
              hauler in a new tab. Mirrors the "Print digest" link on
              the Today operations log section. */}
          <a
            href={`/haulers/${hauler.id}/scorecard`}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--bauxite-rust)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-hairline)',
            }}
            title="Open the printable weekly scorecard in a new tab"
          >
            Print weekly scorecard →
          </a>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function LenderSections({ detail, onClose, navigate }) {
  const fb = detail.fleet_breakdown;
  const dr = detail.driver_roster;
  const mtd = detail.mtd;
  const st  = detail.settlement;
  return (
    <>
      <Section title="Fleet breakdown">
        <Row label="Contracted" value={fb.total} />
        <Row label="In transit"       value={fb.status.in_transit} />
        <Row label="At origin"        value={fb.status.at_origin} />
        <Row label="At destination"   value={fb.status.at_destination} />
        <Row label="In workshop"      value={
          fb.status.garage > 0
            ? <span style={{ color: 'var(--bauxite-rust)' }}>{fb.status.garage}</span>
            : fb.status.garage
        } />
        <Row label="Critical flag"    value={
          fb.flags.critical > 0
            ? <span style={{ color: 'var(--bauxite-rust)' }}>{fb.flags.critical}</span>
            : fb.flags.critical
        } />
        <Row label="Service due"      value={fb.flags.service_due} />
        <Row label="Cert <30 d"       value={fb.flags.road_worthy_30d} />
      </Section>

      <Section title="Driver roster">
        <Row label="Drivers"          value={`${dr.total} · ${dr.primary} primary / ${dr.relief} relief`} />
        <Row label="Rest breach"      value={
          dr.rest_breach > 0
            ? <span style={{ color: 'var(--bauxite-rust)' }}>{dr.rest_breach}</span>
            : dr.rest_breach
        } />
        <Row label="Rest warning"     value={
          dr.rest_warning > 0
            ? <span style={{ color: 'var(--signal-amber)' }}>{dr.rest_warning}</span>
            : dr.rest_warning
        } />
        <Row label="Coaching flagged" value={dr.coaching_flagged} />
        <Row label="Avg safety score" value={dr.avg_safety_score} />
      </Section>

      <Section title="Month to date">
        <Row label="Trips"            value={`${mtd.trip_count} · ${mtd.laden_count} laden`} />
        <Row label="Tonnes delivered" value={formatTonnes(mtd.tonnes_delivered)} />
        <Row label="Revenue"          value={fmtUsd(mtd.revenue_usd)} />
        <Row label="Cost"             value={fmtUsd(mtd.cost_usd)} />
        <Row label="Margin"           value={
          <span style={{
            color: mtd.margin_usd >= 0 ? 'var(--text)' : 'var(--bauxite-rust)',
            fontWeight: 'var(--fw-medium)',
          }}>
            {fmtUsd(mtd.margin_usd)}
          </span>
        } />
        <Row label="On-time"          value={
          mtd.on_time_pct != null ? formatPercent(mtd.on_time_pct, 0) : '—'
        } />
      </Section>

      <Section title="SLA trend · 12 weeks">
        <SlaSparkline points={detail.sla_series} current={detail.performance.sla_attainment_pct} />
      </Section>

      <Section title="Settlement · 14-day term">
        <Row label="Invoiced MTD"     value={fmtUsd(st.invoiced_usd)} />
        <Row label="Paid"             value={fmtUsd(st.paid_usd)} />
        <Row label="Outstanding"      value={
          st.outstanding_usd > 0
            ? <span style={{ color: 'var(--signal-amber)' }}>{fmtUsd(st.outstanding_usd)}</span>
            : fmtUsd(0)
        } />
        <Row label="Avg days to settle" value={
          <span style={{
            color: st.avg_days_to_settle > st.term_days ? 'var(--bauxite-rust)' : 'var(--text)',
          }}>{st.avg_days_to_settle} d</span>
        } />
        <Row label="On-time pay"      value={formatPercent(st.on_time_pay_pct, 1)} />
        <Row label="Next invoice"     value={formatDateShort(st.next_invoice_iso)} />
      </Section>

      {detail.forecast && detail.forecast.status === 'active' && (
        <HaulerForecastSection
          forecast={detail.forecast}
          horizon={detail.forecast_horizon}
        />
      )}

      {detail.lifecycle && (
        <LifecycleSection lifecycle={detail.lifecycle} />
      )}

      {detail.open_alerts.length > 0 && (
        <Section title={`Open alerts · ${detail.open_alerts.length}`}>
          {detail.open_alerts.map((a) => (
            <div key={a.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 10px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                  {a.title}
                </span>
                <span className="mono" style={{
                  fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em',
                }}>
                  {a.severity} · {a.status}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/alerts?focus=${a.id}`); }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Open alert
              </button>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// Phase 44 — Per-hauler month-end projection. Renders this hauler's
// slice of the corridor forecast — projected EOM, run-rate against
// their contracted share, and verdict tone matching HaulerStatusList.
// Sibling to LifecycleSection so the drawer reads "what happened
// recently" then "where they're heading."
const VERDICT_LABEL = {
  on_pace:           'On pace',
  drift:             'Drift · within tolerance',
  lagging:           'Lagging',
  severely_lagging:  'Severely lagging',
};
const VERDICT_TONE = {
  on_pace:           'var(--signal-green)',
  drift:             'var(--text)',
  lagging:           'var(--signal-amber)',
  severely_lagging:  'var(--bauxite-rust)',
};

function HaulerForecastSection({ forecast, horizon }) {
  const tone = VERDICT_TONE[forecast.verdict] ?? 'var(--text)';
  const verdictLabel = VERDICT_LABEL[forecast.verdict] ?? '—';
  const shortfall = Math.max(0, forecast.contracted_monthly - forecast.projected_eom);
  return (
    <Section title={`Month-end forecast · ${horizon?.days_remaining ?? '—'}d remaining`}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size, 18px)',
            fontWeight: 'var(--fw-medium)',
            color: tone,
          }}>
            {(forecast.projected_eom / 1000).toFixed(1)} kt
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            projected EOM
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size, 18px)',
            fontWeight: 'var(--fw-medium)',
            color: tone,
          }}>
            {forecast.projected_pct_contracted.toFixed(0)}%
          </div>
          <div className="micro" style={{ color: tone, marginTop: 2 }}>
            {verdictLabel}
          </div>
        </div>
      </div>
      <Row label="Daily avg now" value={
        <span className="tabular">{forecast.daily_avg.toLocaleString()} t/d</span>
      } />
      <Row label="Delivered MTD" value={
        <span className="tabular">{(forecast.delivered_mtd / 1000).toFixed(1)} kt</span>
      } />
      <Row label="Contracted (full month)" value={
        <span className="tabular">{(forecast.contracted_monthly / 1000).toFixed(1)} kt</span>
      } />
      {shortfall > 0 && (
        <Row label="Shortfall vs contracted" value={
          <span className="tabular" style={{ color: tone }}>
            {(shortfall / 1000).toFixed(1)} kt
          </span>
        } />
      )}
    </Section>
  );
}

// Phase 41 — Lifecycle posture. Compact "what happened to this hauler
// recently" block: HSE / coaching / licence renewals over the last 30
// days, plus a tail of the per-hauler audit feed. Reuses the Section/Row
// primitives so the visual grammar matches every other drawer panel.
function LifecycleSection({ lifecycle }) {
  const { hse, coaching, licences, audit, window_days } = lifecycle;
  const hasAnyActivity =
    hse.open + hse.closed_30d + coaching.sessions_30d +
    licences.renewed_30d + licences.expiring.length + audit.recent.length > 0;

  return (
    <Section title={`Lifecycle posture · ${window_days} d`}>
      <Row label="HSE incidents" value={
        <span>
          <span style={{ color: hse.open > 0 ? 'var(--bauxite-rust)' : 'var(--text)' }}>
            {hse.open} open
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}> · {hse.closed_30d} closed {window_days}d</span>
        </span>
      } />
      <Row label="Dispatcher coaching" value={
        <span>
          <span>{coaching.sessions_30d} session{coaching.sessions_30d === 1 ? '' : 's'}</span>
          {coaching.last_held_at && (
            <span style={{ color: 'var(--text-tertiary)' }}>
              {' · last '}{formatDateShort(coaching.last_held_at)}
            </span>
          )}
        </span>
      } />
      <Row label="Driver licences" value={
        <span>
          <span style={{ color: licences.expiring.length > 0 ? 'var(--signal-amber)' : 'var(--text)' }}>
            {licences.expiring.length} expiring ≤30d
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {' · '}{licences.renewed_30d} renewed {window_days}d
          </span>
        </span>
      } />

      {licences.expiring.length > 0 && (
        <div style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {licences.expiring.slice(0, 4).map((l) => {
            const overdue = l.days_remaining < 0;
            const tone = overdue
              ? 'var(--bauxite-rust)'
              : l.days_remaining <= 14 ? 'var(--signal-amber)' : 'var(--text-secondary)';
            return (
              <div key={l.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 'var(--ts-caption-size)',
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {l.driver} · {l.document}
                </span>
                <span className="tabular" style={{ color: tone }}>
                  {overdue ? `${Math.abs(l.days_remaining)}d overdue` : `${l.days_remaining}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {audit.restricted && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          Operational write history is restricted for the lender persona.
        </div>
      )}

      {audit.recent.length > 0 && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
        }}>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Recent writes · last {audit.recent.length}
          </div>
          <ol style={{
            listStyle: 'none', margin: 0, padding: 0,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {audit.recent.map((r) => (
              <li key={r.id} style={{
                display: 'grid',
                gridTemplateColumns: '64px 1fr auto',
                columnGap: 'var(--space-3)',
                alignItems: 'baseline',
                fontSize: 'var(--ts-caption-size)',
              }}>
                <span className="mono tabular" style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                  {fmtAuditTs(r.ts)}
                </span>
                <span style={{
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {r.summary || `${r.entity_type}/${r.action}`}
                </span>
                <span style={{ color: 'var(--text-tertiary)' }} title={r.actor_role || ''}>
                  {r.actor || '—'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!hasAnyActivity && (
        <div style={{
          padding: '6px 0',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          No lifecycle activity in the last {window_days} days.
        </div>
      )}
    </Section>
  );
}

function fmtAuditTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // "27 Apr 15:03" — compact, matches the operations-log convention.
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function SlaSparkline({ points, current }) {
  if (!points?.length) return null;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = Math.max(0.5, max - min);
  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${points.length}, 1fr)`,
        gap: 4,
        alignItems: 'flex-end',
        height: 56,
      }}>
        {points.map((p, i) => {
          const isCurrent = i === points.length - 1;
          const ratio = (p.value - min) / span;
          const height = 8 + Math.round(ratio * 42);
          const below90 = p.value < 90;
          return (
            <div key={i} title={`${p.value}%`} style={{
              height,
              background: isCurrent
                ? 'var(--bauxite-rust)'
                : below90
                  ? 'var(--signal-amber)'
                  : 'var(--border-soft)',
              borderRadius: 2,
            }} />
          );
        })}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span>12 wks ago</span>
        <span>
          current · <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
            {current != null ? `${current}%` : '—'}
          </span>
        </span>
      </div>
    </div>
  );
}

function fmtUsd(n) {
  if (n == null) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US')}`;
}

function formatDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <h3 className="micro" style={{
        margin: '0 0 10px',
        color: 'var(--text-tertiary)',
      }}>
        {title}
      </h3>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--surface)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3)',
      }}>
        {children}
      </div>
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 'var(--space-3)',
    }}>
      <span style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text-secondary)',
      }}>
        {label}
      </span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </span>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatSync(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    + ' '
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Accra' });
}

function runRate(hauler) {
  if (hauler.status !== 'active' || hauler.tonnes_contracted_mtd === 0) return '—';
  const pct = (hauler.tonnes_delivered_mtd / hauler.tonnes_contracted_mtd) * 100;
  return formatPercent(pct, 1);
}

/* ── Phase 133: SLA monthly scorecard ──────────────────────────────── */
const TARIFF_PER_TONNE = 24.00;   // $24.00 / tonne — Tranche 1 base
const FLOOR_PCT = 0.80;           // 80% take-or-pay floor

function SlaScorecard({ hauler }) {
  const sla         = hauler.performance.sla_attainment_pct ?? 0;
  const onTime      = hauler.performance.on_time_pct ?? 0;
  const delivered   = hauler.tonnes_delivered_mtd ?? 0;
  const contracted  = hauler.tonnes_contracted_mtd ?? 0;
  const floor       = Math.round(contracted * FLOOR_PCT);
  const revenue     = Math.round(delivered * TARIFF_PER_TONNE);
  const aboveFloor  = delivered >= floor;
  const attainPct   = contracted > 0 ? Math.min(100, (delivered / contracted) * 100) : 0;
  const floorPct    = contracted > 0 ? Math.min(100, (floor / contracted) * 100) : 80;

  const slaColor    = sla >= 90 ? 'var(--signal-green)' : sla >= 75 ? 'var(--signal-amber)' : 'var(--bauxite-rust)';
  const floorColor  = aboveFloor ? 'var(--signal-green)' : 'var(--bauxite-rust)';

  return (
    <section style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>SLA scorecard · MTD</span>
        <span className="mono" style={{
          fontSize: 9, letterSpacing: '0.08em', padding: '1px 6px',
          background: 'rgba(139,46,26,0.06)', border: '1px solid rgba(139,46,26,0.2)',
          borderRadius: 2, color: 'var(--bauxite-rust)',
        }}>MODELLED</span>
      </div>

      {/* Tonnage progress bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          <span>MTD throughput</span>
          <span className="tabular">{delivered.toLocaleString()} / {contracted.toLocaleString()} t</span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'var(--border-hairline)', borderRadius: 4, overflow: 'hidden' }}>
          {/* Floor marker */}
          <div style={{
            position: 'absolute', left: `${floorPct}%`, top: 0, bottom: 0,
            width: 2, background: 'var(--signal-amber)', zIndex: 1,
          }} title="Take-or-pay floor" />
          {/* Fill */}
          <div style={{
            height: '100%',
            width: `${attainPct}%`,
            background: aboveFloor ? 'var(--signal-green)' : 'var(--bauxite-rust)',
            borderRadius: 4,
            transition: 'width 400ms ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
          <span style={{ color: floorColor }}>
            {aboveFloor ? '✓ Above floor' : '⚠ Below floor'}
            {' · floor = '}{floor.toLocaleString()} t
          </span>
          <span className="tabular">{attainPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
        {[
          { label: 'SLA attainment', value: `${sla.toFixed(1)}%`, color: slaColor },
          { label: 'On-time rate',   value: `${onTime.toFixed(0)}%`, color: onTime >= 90 ? 'var(--signal-green)' : onTime >= 80 ? 'var(--signal-amber)' : 'var(--bauxite-rust)' },
          { label: 'Revenue MTD',    value: revenue >= 1_000_000 ? `$${(revenue/1_000_000).toFixed(2)}M` : `$${Math.round(revenue/1000)}K`, color: 'var(--text)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
            display: 'flex', flexDirection: 'column', gap: 3,
          }}>
            <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {label}
            </span>
            <span className="tabular" style={{ fontSize: 'var(--ts-body-size)', fontWeight: 'var(--fw-semibold)', color }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
