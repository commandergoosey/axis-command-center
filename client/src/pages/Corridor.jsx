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
  const [devices, setDevices] = useState([]);

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

  // Fetch live device positions for the GPS layer on the corridor map.
  useEffect(() => {
    authFetch('/api/devices?limit=500')
      .then((r) => r.ok ? r.json() : { devices: [] })
      .then((d) => setDevices(d.devices ?? []));
  }, []);

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

      {/* ── Main view: schematic or map — full width ───────────────── */}
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
          devices={devices}
        />
      )}

      {/* ── Conditions strip: weather · advisories · weighbridges ───── */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <CorridorConditions
          conditions={data?.conditions}
          activeConvoys={data?.active_convoys}
          onAdvisoryChange={load}
          horizontal
        />
      </div>

      {/* ── Active convoys ───────────────────────────────────────────── */}
      {data?.active_convoys?.length > 0 && (
        <ConvoyStrip convoys={data.active_convoys} />
      )}

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

/* ── Active convoy strip ──────────────────────────────────────────────────
 * Compact grid of convoy cards rendered below the conditions strip.
 * Each card shows hauler, phase direction, km position, and schedule status.
 */
function ConvoyStrip({ convoys }) {
  const cols = Math.min(convoys.length, 4);
  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}>
        <div className="eyebrow" style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          Active convoys · {convoys.length}
        </div>
        <div style={{ flex: 1, height: 1, background: 'var(--border-hairline)' }} />
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 'var(--space-3)',
      }}>
        {convoys.map((c) => {
          const onSchedule = c.on_schedule;
          const dir = c.direction === 'northbound' ? '↑ N' : '↓ S';
          const phase = c.phase
            ? c.phase.charAt(0).toUpperCase() + c.phase.slice(1)
            : '—';
          return (
            <div key={c.id} style={{
              background: 'var(--surface-raised)',
              border: `1px solid ${onSchedule ? 'var(--border-hairline)' : 'var(--signal-amber)'}`,
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3) var(--space-4)',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--text)',
                }}>
                  {c.id}
                </span>
                <span style={{
                  fontSize: 9,
                  letterSpacing: '0.06em',
                  padding: '1px 6px',
                  borderRadius: 999,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 'var(--fw-medium)',
                  textTransform: 'uppercase',
                  background: onSchedule ? 'rgba(22,163,74,0.10)' : 'rgba(180,83,9,0.10)',
                  color: onSchedule ? 'var(--signal-green)' : 'var(--signal-amber)',
                }}>
                  {onSchedule ? 'On time' : 'Delayed'}
                </span>
              </div>
              <div style={{
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-secondary)',
                marginBottom: 2,
              }}>
                {c.hauler_display_name ?? c.hauler_id}
              </div>
              <div className="mono" style={{
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
              }}>
                {phase} · {dir} · km {c.km} · {c.trucks} trucks
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
