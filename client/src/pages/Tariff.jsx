/*
 * Tariff — indexation tracker.
 * Hero strip (base / effective / adjustment), indexation composition panel,
 * and side-by-side NPA diesel and GSS CPI trend charts. Next review date
 * sits in a neutral footer band.
 */

import { authFetch } from '../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '../components/layout/PageShell';
import EffectiveRateHero from '../components/tariff/EffectiveRateHero';
import IndexationPanel   from '../components/tariff/IndexationPanel';
import TrendCard         from '../components/tariff/TrendCard';
import EffectiveRateHistoryCard  from '../components/tariff/EffectiveRateHistoryCard';
import IndexationBreakdownChart    from '../components/tariff/IndexationBreakdownChart';
import ComponentShareChart         from '../components/tariff/ComponentShareChart';
import TariffEscalationForecast   from '../components/tariff/TariffEscalationForecast';
import IntelligencePanel           from '../components/intelligence/IntelligencePanel';

export default function Tariff() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/tariff');
      if (!res.ok) throw new Error(`tariff ${res.status}`);
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
      title="Tariff"
      description="Base tariff $0.08 per tonne-km across the 300 km corridor — $24.00 per tonne delivered. Indexed monthly: 40% fuel (NPA diesel), 30% Ghana CPI (GSS), 30% fixed in USD."
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
          Tariff feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <EffectiveRateHero data={data} />
        <EffectiveRateHistoryCard
          history={data?.effective_rate_history}
          nextReview={data?.next_review}
          current={data?.effective_rate_usd_per_tonne}
        />
        <IndexationPanel   data={data} />

        {/* Phase 152 — per-component tariff breakdown chart */}
        {data?.component_history && (
          <IndexationBreakdownChart componentHistory={data.component_history} />
        )}

        {/* Phase 196 — component share trend (% of effective rate over time) */}
        {data?.component_history?.length > 0 && (
          <ComponentShareChart componentHistory={data.component_history} />
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'var(--space-4)',
        }}>
          {data?.npa_diesel && (
            <TrendCard
              title="NPA diesel pump price"
              subtitle="Monthly average · Ghana National Petroleum Authority"
              series={data.npa_diesel.series}
              baseMonth={data.npa_diesel.base_month}
              baseValue={data.npa_diesel.base_ghs_per_l}
              currentValue={data.npa_diesel.current_ghs_per_l}
              unit="GHS/L"
              dataKey="ghs_per_l"
              color="var(--bauxite-rust)"
            />
          )}
          {data?.gss_cpi && (
            <TrendCard
              title="Ghana CPI"
              subtitle="Headline index · Ghana Statistical Service"
              series={data.gss_cpi.series}
              baseMonth={data.gss_cpi.base_month}
              baseValue={data.gss_cpi.base_index}
              currentValue={data.gss_cpi.current_index}
              unit=""
              dataKey="index"
              color="var(--charcoal)"
            />
          )}
        </div>

        {/* Phase 168 — 6-month escalation forecast: base / trend / stress */}
        {data?.escalation_forecast && (
          <TariffEscalationForecast
            escalationForecast={data.escalation_forecast}
            currentRate={data.effective_rate_usd_per_tonne}
          />
        )}

        <IntelligencePanel page="tariff" />

        {data?.terms && (
          <footer style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
          }}>
            <span>Review cadence · {data.terms.review_cadence}</span>
            <span>
              Next review ·{' '}
              <span className="mono" style={{ color: 'var(--text)' }}>
                {new Date(data.terms.next_review_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
            </span>
            <span>Pass-through band · {data.terms.pass_through_floor_pct}%–{data.terms.pass_through_cap_pct}%</span>
          </footer>
        )}
      </div>
    </PageShell>
  );
}
