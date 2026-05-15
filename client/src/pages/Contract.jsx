/*
 * Contract — GIBDLC contract dashboard.
 * Four tiles of contract particulars, then the take-or-pay gauge alongside
 * monthly tonnage vs floor, then SLA attainment and payment security side
 * by side. Every modelled figure carries a MODELLED pill.
 */

import { authFetch } from '../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '../components/layout/PageShell';
import ContractTermsStrip    from '../components/contract/ContractTermsStrip';
import TakeOrPayGauge        from '../components/contract/TakeOrPayGauge';
import CumulativeTonnageChart from '../components/contract/CumulativeTonnageChart';
import RunRatePanel          from '../components/contract/RunRatePanel';
import ForecastAnomalyStrip  from '../components/contract/ForecastAnomalyStrip';
import SLAMeter              from '../components/contract/SLAMeter';
import PaymentSecurityCard   from '../components/contract/PaymentSecurityCard';
import IntelligencePanel     from '../components/intelligence/IntelligencePanel';

export default function Contract() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/contract');
      if (!res.ok) throw new Error(`contract ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      eyebrow="Contract"
      title="GIBDLC contract"
      description="Haulage contract with GIBDLC under GIADEC oversight. Minimum take-or-pay at 80% of contracted monthly tonnage. Payment security via standby letter of credit."
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
          Contract feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <ContractTermsStrip terms={data?.terms} basis={data?.contract_basis} />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'var(--space-4)',
        }}>
          <TakeOrPayGauge mtd={data?.mtd} />
          <CumulativeTonnageChart history={data?.history} />
        </div>

        <RunRatePanel mtd={data?.mtd} />

        {/* Phase 151 — forecast anomaly alerts */}
        {data?.anomalies?.length > 0 && (
          <ForecastAnomalyStrip anomalies={data.anomalies} />
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'var(--space-4)',
        }}>
          <SLAMeter sla={data?.sla} />
          <PaymentSecurityCard paymentSecurity={data?.payment_security} />
        </div>

        <IntelligencePanel page="contract" />
      </div>
    </PageShell>
  );
}
