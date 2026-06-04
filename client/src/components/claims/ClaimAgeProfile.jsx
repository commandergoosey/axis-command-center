/*
 * Phase 183 — Claim age profile.
 * BarChart of open claims bucketed by days since filed:
 * 0–30, 31–60, 61–90, 90+. Overdue buckets (31+ days) shown in amber/rust.
 * Uses age_profile from /api/claims.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ResponsiveContainer,
} from 'recharts';

function bucketColor(isOverdue) {
  return isOverdue ? 'var(--signal-amber)' : 'var(--signal-green)';
}

function fmtUsd(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${(v ?? 0).toLocaleString()}`;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{d.bucket}</div>
      <Row label="Open claims"  value={d.count} />
      <Row label="Exposure"     value={fmtUsd(d.exposure_usd)} color={d.is_overdue ? 'var(--signal-amber)' : 'var(--signal-green)'} />
      {d.is_overdue && (
        <div style={{ marginTop: 6, fontSize: 9, color: 'var(--signal-amber)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Overdue — SLA at risk
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: color ?? 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

export default function ClaimAgeProfile({ ageProfile }) {
  if (!ageProfile?.length) return null;

  const overdueCount = ageProfile
    .filter((b) => b.is_overdue)
    .reduce((s, b) => s + b.count, 0);
  const overdueUsd = ageProfile
    .filter((b) => b.is_overdue)
    .reduce((s, b) => s + (b.exposure_usd ?? 0), 0);

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Open claim age profile
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Filed, under review &amp; approved claims · days since filed
          </div>
        </div>
        {overdueCount > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 'var(--ts-h2-size, 22px)',
              fontWeight: 'var(--fw-black)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--signal-amber)',
              lineHeight: 1.1,
            }}>
              {overdueCount}
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>overdue (31+ d)</div>
          </div>
        )}
      </div>

      {overdueCount > 0 && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-amber)',
          marginBottom: 'var(--space-3)',
        }}>
          {overdueCount} claim{overdueCount !== 1 ? 's' : ''} overdue · {fmtUsd(overdueUsd)} exposure at risk of SLA breach
        </div>
      )}

      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          data={ageProfile}
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          barSize={48}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={24}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {ageProfile.map((b) => (
              <Cell
                key={b.bucket}
                fill={bucketColor(b.is_overdue)}
                fillOpacity={b.is_overdue ? 0.8 : 0.65}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Exposure footer strip */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
      }}>
        {ageProfile.map((b) => (
          <div key={b.bucket} style={{ flex: 1 }}>
            <div style={{
              fontSize: 9,
              color: b.is_overdue ? 'var(--signal-amber)' : 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 2,
            }}>
              {b.bucket}
            </div>
            <div style={{
              fontSize: 'var(--ts-caption-size)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--text)',
            }}>
              {fmtUsd(b.exposure_usd)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
