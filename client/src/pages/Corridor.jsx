/*
 * Corridor — aggregated corridor state view.
 * Pill toggle at top right switches between the schematic (default) and a
 * static Ghana map. The conditions side panel is shared between both modes
 * so the operator never loses situational context when switching view.
 */

import { authFetch } from '../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '../components/layout/PageShell';
import PillToggle from '../components/primitives/PillToggle';
import CorridorSchematic from '../components/corridor/CorridorSchematic';
import CorridorMap from '../components/corridor/CorridorMap';
import CorridorConditions from '../components/corridor/CorridorConditions';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';

const MODE_OPTIONS = [
  { value: 'schematic', label: 'Schematic' },
  { value: 'map',       label: 'Map' },
];

export default function Corridor() {
  const [mode, setMode]       = useState('schematic');
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/corridor');
      if (!res.ok) throw new Error(`corridor ${res.status}`);
      const body = await res.json();
      setData(body);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      eyebrow="Corridor"
      title={data?.corridor?.name ?? 'Nyinahin–Takoradi'}
      description="Aggregated view across all hauliers on the line. Schematic shows segment laden/empty counts; map places depots on Ghana. Live per-truck tracking stays in each hauler's FMS."
      actions={
        <PillToggle value={mode} onChange={setMode} options={MODE_OPTIONS} />
      }
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
          Corridor feed unavailable — {error}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 'var(--space-4)',
        alignItems: 'start',
      }}>
        <div>
          {mode === 'schematic' ? (
            <CorridorSchematic
              waypoints={data?.waypoints}
              segments={data?.segments}
              lengthKm={data?.corridor?.length_km ?? 300}
            />
          ) : (
            <CorridorMap waypoints={data?.waypoints} convoys={data?.active_convoys} />
          )}
        </div>
        <CorridorConditions
          conditions={data?.conditions}
          activeConvoys={data?.active_convoys}
          onAdvisoryChange={load}
        />
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <IntelligencePanel page="corridor" />
      </div>
    </PageShell>
  );
}
