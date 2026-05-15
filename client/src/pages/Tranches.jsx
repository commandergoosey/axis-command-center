/*
 * Tranches — capital deployment programme.
 * Programme strip up top (totals), horizontal tranche timeline with status
 * cards, and a gate checklist that tracks the currently selected tranche.
 * Selection defaults to the active tranche; clicking a card jumps the
 * checklist so the lender-side-letter detail stays one click away.
 */

import { authFetch } from '../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '../components/layout/PageShell';
import ProgrammeStrip       from '../components/tranche/ProgrammeStrip';
import TrancheTimeline      from '../components/tranche/TrancheTimeline';
import GateChecklist        from '../components/tranche/GateChecklist';
import CapitalDrawdownChart from '../components/tranche/CapitalDrawdownChart';
import IntelligencePanel    from '../components/intelligence/IntelligencePanel';

export default function Tranches() {
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [selectedId, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/tranches');
      if (!res.ok) throw new Error(`tranches ${res.status}`);
      const body = await res.json();
      setData(body);
      setSelected((prev) => prev ?? body.programme?.current_tranche_id ?? body.tranches?.[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = data?.tranches?.find((t) => t.id === selectedId) ?? data?.tranches?.[0];

  return (
    <PageShell
      eyebrow="Capital"
      title="Tranches"
      description="Modular deployment — 1.0 → 5.0 Mtpa across four CAPEX tranches. $90M total, 70/30 debt/equity. Each tranche draws on the prior's validated run-rate, DSCR headroom, and HSE record."
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
          Tranche feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <ProgrammeStrip programme={data?.programme} capital={data?.capital} />

        {/* Phase 177 — capital drawdown chart */}
        {data?.capital?.series?.length > 0 && (
          <CapitalDrawdownChart capital={data.capital} />
        )}

        <TrancheTimeline
          tranches={data?.tranches ?? []}
          selectedId={selectedId}
          onSelect={setSelected}
        />
        <GateChecklist tranche={selected} />
        <IntelligencePanel page="tranches" />
      </div>
    </PageShell>
  );
}
