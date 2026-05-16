/*
 * Compliance — corridor regulatory posture.
 * Axle-load summary (30d) + events table, HSE panel, driver licence
 * pipeline (90d), and the regulatory filing tracker.
 */

import { authFetch } from '../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import PageShell          from '../components/layout/PageShell';
import AxleLoadSummary    from '../components/compliance/AxleLoadSummary';
import AxleEventsTable    from '../components/compliance/AxleEventsTable';
import CoachingLog        from '../components/compliance/CoachingLog';
import HSEPanel           from '../components/compliance/HSEPanel';
import LicencePipeline          from '../components/compliance/LicencePipeline';
import DeadlineCountdownStrip    from '../components/compliance/DeadlineCountdownStrip';
import ComplianceHealthTrend     from '../components/compliance/ComplianceHealthTrend';
import AxleWeeklyTrendChart      from '../components/compliance/AxleWeeklyTrendChart';
import ViolationTypeChart        from '../components/compliance/ViolationTypeChart';
import FilingsTracker            from '../components/reports/FilingsTracker';
import FilingDetailDrawer from '../components/reports/FilingDetailDrawer';
import IntelligencePanel  from '../components/intelligence/IntelligencePanel';

export default function Compliance() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [filingId, setFilingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/compliance');
      if (!res.ok) throw new Error(`compliance ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      eyebrow="Operations"
      title="Compliance"
      description="Axle-load compliance under LI 2180 (60-tonne GVW, ~40-tonne payload). Weighbridge events, HSE incidents per million tonne-km, driver licence expiry pipeline, and regulatory filing status."
    >
      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--signal-amber)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          fontSize: 'var(--ts-body-sm-size)',
          marginBottom: 'var(--space-4)',
        }}>
          Compliance feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'var(--space-4)',
        }}>
          <AxleLoadSummary axle={data?.axle} />
          <HSEPanel hse={data?.hse} onMutate={load} />
        </div>
        <AxleEventsTable events={data?.axle?.events} onHoldLogged={load} />
        <CoachingLog />
        {/* Phase 150 — unified deadline countdown: licences + filings */}
        {/* Phase 167 — compliance health score + 8-week trend */}
        <ComplianceHealthTrend healthScore={data?.health_score} />
        {/* Phase 208 — 8-week axle event frequency trend */}
        {data?.axle_weekly_trend && (
          <AxleWeeklyTrendChart axleWeeklyTrend={data.axle_weekly_trend} />
        )}
        {/* Phase 228 — violation breakdown by type: axle holds, warnings, licence, filings */}
        {data?.violation_by_type?.length > 0 && (
          <ViolationTypeChart violationByType={data.violation_by_type} />
        )}
        <DeadlineCountdownStrip deadlines={data?.upcoming_deadlines} />
        <LicencePipeline items={data?.licence_expiry} onRenewed={load} />
        <FilingsTracker
          filings={data?.filings ?? []}
          onSelect={(f) => setFilingId(f.id)}
        />
        <IntelligencePanel page="compliance" />
      </div>

      {filingId && (
        <FilingDetailDrawer
          filingId={filingId}
          onClose={() => setFilingId(null)}
          onFiled={() => load()}
        />
      )}
    </PageShell>
  );
}
