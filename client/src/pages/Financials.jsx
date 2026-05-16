/*
 * Financials — lender-facing snapshot.
 * DSCR hero with trend, P&L (MTD + YTD), covenant table, and a 90-day
 * cashflow forecast. Every value carries the MODELLED tag (BRIEF §12.4).
 */

import { authFetch } from '../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import { FileText } from 'lucide-react';
import PageShell           from '../components/layout/PageShell';
import DSCRHero            from '../components/financials/DSCRHero';
import PnLSnapshot         from '../components/financials/PnLSnapshot';
import PLTrendChart        from '../components/financials/PLTrendChart';
import CovenantTable          from '../components/financials/CovenantTable';
import CovenantHeadroomChart  from '../components/financials/CovenantHeadroomChart';
import CashflowForecast    from '../components/financials/CashflowForecast';
import ReceivablesPanel    from '../components/financials/ReceivablesPanel';
import HaulerRevenueStrip  from '../components/financials/HaulerRevenueStrip';
import DSOTrendChart       from '../components/financials/DSOTrendChart';
import EbitdaBridgeChart        from '../components/financials/EbitdaBridgeChart';
import CostComponentTrendChart  from '../components/financials/CostComponentTrendChart';
import IntelligencePanel        from '../components/intelligence/IntelligencePanel';

export default function Financials() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/financials');
      if (!res.ok) throw new Error(`financials ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      eyebrow="Capital"
      title="Financials"
      description="Lender-facing snapshot. Target DSCR ≥ 1.30× at covenant; 2.5× at Year 5 steady state. Print-friendly — this page is the lender pack made live."
      actions={(
        <a
          href="/lender/pack"
          target="_blank"
          rel="noreferrer"
          title="Open the print-friendly lender briefing pack in a new tab"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'var(--bauxite-rust)',
            color: 'var(--bone)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            textDecoration: 'none',
            fontWeight: 'var(--fw-medium)',
            letterSpacing: '0.02em',
          }}
        >
          <FileText size={12} strokeWidth={1.8} />
          Generate lender pack →
        </a>
      )}
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
          Financials feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <DSCRHero dscr={data?.dscr} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
          gap: 'var(--space-4)',
        }}>
          <PnLSnapshot pnl={data?.pnl} />
          <CovenantTable covenants={data?.covenants} />
        </div>
        {/* Phase 163 — covenant headroom: spatial distance from each threshold */}
        <CovenantHeadroomChart covenants={data?.covenants} />
        <ReceivablesPanel receivables={data?.receivables} onMutate={load} />
        <HaulerRevenueStrip haulers={data?.by_hauler} />
        {/* Phase 156 — monthly P&L trend */}
        <PLTrendChart pnlTrend={data?.pnl_trend} />
        <CashflowForecast weeks={data?.cashflow} />
        {/* Phase 180 — DSO 6-month trend */}
        <DSOTrendChart dsoTrend={data?.dso_trend} />
        {/* Phase 200 — EBITDA bridge: prior month → current MTD */}
        {data?.ebitda_bridge && (
          <EbitdaBridgeChart ebitdaBridge={data.ebitda_bridge} />
        )}
        {/* Phase 217 — monthly operating cost by component (fuel/driver/maint/other) */}
        {data?.cost_component_trend?.length > 0 && (
          <CostComponentTrendChart costComponentTrend={data.cost_component_trend} />
        )}
        <IntelligencePanel page="financials" />
      </div>
    </PageShell>
  );
}
