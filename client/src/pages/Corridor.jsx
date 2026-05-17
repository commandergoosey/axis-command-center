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
import HealthTrendChart      from '../components/corridor/HealthTrendChart';
import SegmentUtilChart      from '../components/corridor/SegmentUtilChart';
import ThroughputForecast    from '../components/corridor/ThroughputForecast';
import WaypointDwellChart    from '../components/corridor/WaypointDwellChart';
import IntelligencePanel     from '../components/intelligence/IntelligencePanel';

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

      {/* ── Main view: schematic or map, plus the conditions side panel ── */}
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
            <CorridorMap
              key={data?.waypoints?.length ?? 0}
              waypoints={data?.waypoints}
              convoys={data?.active_convoys}
            />
          )}
        </div>
        <CorridorConditions
          conditions={data?.conditions}
          activeConvoys={data?.active_convoys}
          onAdvisoryChange={load}
        />
      </div>

      {/* ── Analytics section ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-5)',
        marginBottom: 'var(--space-4)',
      }}>
        <div className="eyebrow" style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          Corridor analytics
        </div>
        <div style={{ flex: 1, height: 1, background: 'var(--border-hairline)' }} />
      </div>

      {/* Health trend — full width */}
      <HealthTrendChart history={data?.health_history} />

      {/* Phase 191 + Phase 215 — segment utilisation and waypoint dwell, side by side */}
      {(data?.segment_util?.length > 0 || data?.waypoint_dwell?.length > 0) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'var(--space-4)',
          marginTop: 'var(--space-4)',
        }}>
          {data?.segment_util?.length > 0 && (
            <SegmentUtilChart segmentUtil={data.segment_util} />
          )}
          {data?.waypoint_dwell?.length > 0 && (
            <WaypointDwellChart waypointDwell={data.waypoint_dwell} />
          )}
        </div>
      )}

      {/* Phase 172 — 4-week corridor throughput forecast — full width */}
      {data?.throughput_forecast?.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <ThroughputForecast throughputForecast={data.throughput_forecast} />
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <IntelligencePanel page="corridor" />
      </div>
    </PageShell>
  );
}
