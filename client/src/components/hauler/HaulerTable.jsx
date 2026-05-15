/*
 * HaulerTable — infrastructure register (no card chrome, no alternating rows).
 * Columns resolve to BRIEF.md §7.3. Clicking a row opens detail.
 * Keep text left-aligned; numerals right-aligned with tabular lining figures.
 */

import ApiHealthDot from '../primitives/ApiHealthDot';
import StatusBadge from '../primitives/StatusBadge';
import PinButton from '../primitives/PinButton';
import { formatPercent } from '../../lib/format';

const STATUS_LABEL = {
  connected: 'Connected',
  degraded:  'Degraded',
  manual:    'Manual',
  pending:   'Pending',
};

const INTEGRATION_LABEL = {
  loconav: 'Loconav',
  custom:  'Custom FMS',
  manual:  'Manual CSV',
};

function formatLastSync(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
  }) + ' ' + d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Accra',
  });
}

export default function HaulerTable({ haulers, onRowClick, selectable, selected, onToggleSelect }) {
  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
            {selectable && <Th align="center" style={{ width: 32 }}>{/* checkbox */}</Th>}
            <Th>Hauler</Th>
            <Th align="right">Contracted</Th>
            <Th align="right">Active</Th>
            <Th>Integration</Th>
            <Th>API</Th>
            <Th align="right">On-time</Th>
            <Th align="right">Safety</Th>
            <Th align="right">Share</Th>
            <Th>Last sync</Th>
            <Th align="center" style={{ width: 32 }}>{/* pin */}</Th>
          </tr>
        </thead>
        <tbody>
          {haulers.map((h) => {
            const isPicked = selected?.has?.(h.id);
            return (
            <tr
              key={h.id}
              onClick={() => onRowClick?.(h)}
              style={{
                borderBottom: '1px solid var(--border-hairline)',
                cursor: 'pointer',
                transition: 'background 100ms ease',
                background: isPicked ? 'var(--accent-tint)' : 'transparent',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-tint)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isPicked ? 'var(--accent-tint)' : 'transparent'; }}
            >
              {selectable && (
                <Td align="center">
                  <input
                    type="checkbox"
                    checked={!!isPicked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect?.(h.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </Td>
              )}
              <Td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 'var(--fw-medium)' }}>{h.display_name}</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 'var(--ts-caption-size)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {h.id}
                  </span>
                </div>
              </Td>
              <Td align="right" tabular>{h.fleet.contracted_trucks}</Td>
              <Td align="right" tabular>
                {h.status === 'active' ? h.fleet.active_trucks : '—'}
              </Td>
              <Td>
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
                  {INTEGRATION_LABEL[h.integration.type] ?? h.integration.type}
                </span>
              </Td>
              <Td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ApiHealthDot status={h.api_status} />
                  <StatusBadge tone={h.api_status}>
                    {STATUS_LABEL[h.api_status] ?? h.api_status}
                  </StatusBadge>
                </span>
              </Td>
              <Td align="right" tabular>
                {h.status === 'active' ? formatPercent(h.performance.on_time_pct, 0) : '—'}
              </Td>
              <Td align="right" tabular>
                {h.status === 'active' ? h.performance.safety_score : '—'}
              </Td>
              <Td align="right" tabular>
                {h.status === 'active' ? formatPercent(h.contract_share * 100, 1) : '—'}
              </Td>
              <Td>
                <span className="mono" style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                }}>
                  {formatLastSync(h.integration.last_sync)}
                </span>
              </Td>
              <Td align="center">
                <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                  <PinButton entityType="hauler" entityId={h.id} />
                </span>
              </Td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = 'left', style: extraStyle }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '12px 16px',
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
        whiteSpace: 'nowrap',
        ...(extraStyle ?? {}),
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left', tabular = false }) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '14px 16px',
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        whiteSpace: 'nowrap',
        fontVariantNumeric: tabular ? 'tabular-nums lining-nums' : 'normal',
      }}
    >
      {children}
    </td>
  );
}
