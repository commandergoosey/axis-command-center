/*
 * Reports — monthly GIBDLC pack, lender quarterly pack, regulatory filings.
 *
 * Phase 104 additions:
 *   • SchedulesPanel — shows all recurring schedules, toggle/delete/batch
 *   • ScheduleDrawer — schedule form opens from each ReportTile clock icon
 *   • ReportAIChat   — replaces IntelligencePanel; AI-driven PDF builder
 *   • Live exports   — Download PDF button (server-side pdfkit render)
 */

import { authFetch, can } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import { useEffect, useState, useCallback } from 'react';
import PageShell          from '../components/layout/PageShell';
import ReportTile         from '../components/reports/ReportTile';
import RecentReports      from '../components/reports/RecentReports';
import LiveExportsSection from '../components/reports/LiveExportsSection';
import FilingsTracker     from '../components/reports/FilingsTracker';
import FilingDetailDrawer from '../components/reports/FilingDetailDrawer';
import GenerateDrawer     from '../components/reports/GenerateDrawer';
import ScheduleDrawer     from '../components/reports/ScheduleDrawer';
import SchedulesPanel     from '../components/reports/SchedulesPanel';
import ReportAIChat       from '../components/reports/ReportAIChat';

export default function Reports() {
  const { user } = useAuth();
  const mayManage = can(user?.role, 'generateReport');

  const [data,       setData]       = useState(null);
  const [schedules,  setSchedules]  = useState([]);
  const [filings,    setFilings]    = useState([]);
  const [error,      setError]      = useState(null);

  // Drawers
  const [drawerEntry,   setDrawerEntry]   = useState(null);   // generate
  const [scheduleEntry, setScheduleEntry] = useState(null);   // schedule
  const [filingId,      setFilingId]      = useState(null);

  const loadReports = useCallback(async () => {
    try {
      const fetches = [
        authFetch('/api/reports'),
        authFetch('/api/compliance'),
      ];
      // Only fetch schedules for users who can manage reports
      if (mayManage) fetches.push(authFetch('/api/reports/schedules'));

      const [reportsRes, complianceRes, schedRes] = await Promise.all(fetches);
      if (!reportsRes.ok) throw new Error(`reports ${reportsRes.status}`);
      setData(await reportsRes.json());
      if (complianceRes.ok) {
        const compliance = await complianceRes.json();
        setFilings(compliance.filings ?? []);
      }
      if (schedRes?.ok) {
        const sb = await schedRes.json();
        setSchedules(sb.schedules ?? []);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [mayManage]);

  useEffect(() => { loadReports(); }, [loadReports]);

  return (
    <PageShell
      eyebrow="Platform"
      title="Reports"
      description="GIBDLC contract pack, lender side-letter pack, and the regulatory filings bundle. Every report renders from the live aggregator — no stale numbers. PDFs stream direct from the server; recipients record delivery for the next audit."
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
          Reports feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {/* Report library */}
        <section>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
            Report library · {data?.library?.length ?? 0}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {(data?.library ?? []).map((entry) => (
              <ReportTile
                key={entry.id}
                entry={entry}
                onGenerate={setDrawerEntry}
                onSchedule={setScheduleEntry}
              />
            ))}
          </div>
        </section>

        {/* Schedules management — always visible for managers; empty state guides first use */}
        {mayManage && (
          <SchedulesPanel
            schedules={schedules}
            onRefresh={loadReports}
          />
        )}

        {/* Live exports */}
        <LiveExportsSection exports={data?.live_exports ?? []} />

        {/* Filings tracker */}
        <FilingsTracker
          filings={filings}
          onSelect={(f) => setFilingId(f.id)}
        />

        {/* Recent reports */}
        <RecentReports items={data?.recent ?? []} />

        {/* AI report builder — ops + admin only */}
        {mayManage && <ReportAIChat />}
      </div>

      {/* Generate drawer */}
      {drawerEntry && (
        <GenerateDrawer
          entry={drawerEntry}
          onClose={() => setDrawerEntry(null)}
          onGenerated={() => loadReports()}
        />
      )}

      {/* Schedule drawer — gated by mayManage */}
      {mayManage && scheduleEntry && (
        <ScheduleDrawer
          entry={scheduleEntry}
          onClose={() => setScheduleEntry(null)}
          onScheduled={() => { loadReports(); setScheduleEntry(null); }}
        />
      )}

      {/* Filing detail drawer */}
      {filingId && (
        <FilingDetailDrawer
          filingId={filingId}
          onClose={() => setFilingId(null)}
          onFiled={() => loadReports()}
        />
      )}
    </PageShell>
  );
}
