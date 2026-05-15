/*
 * Trips — trip analytics with hauler-scoped filtering and per-trip drawer.
 * Top: summary strip. Middle: cost-per-route card + delay heatmap.
 * Bottom: filter bar (route + status) over a row-clickable trips ledger.
 * Row click opens TripDetail with GPS timeline, weighbridge events, and
 * cross-linked alerts. /api/trips re-derives analytics on every hauler
 * change; route + status filters are applied client-side on the cached
 * trip list so the ledger reacts instantly.
 */

import { authFetch } from '../lib/auth';

import { useEffect, useMemo, useState, useCallback } from 'react';
import PageShell from '../components/layout/PageShell';
import HaulerFilter from '../components/trips/HaulerFilter';
import CostPerRouteCard from '../components/trips/CostPerRouteCard';
import DelayHeatmap from '../components/trips/DelayHeatmap';
import TripsTable from '../components/trips/TripsTable';
import TripDetail from '../components/trips/TripDetail';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';

const ROUTE_OPTIONS = [
  ['',           'All routes'],
  ['southbound', 'Southbound · laden'],
  ['northbound', 'Northbound · empty'],
];

const STATUS_OPTIONS = [
  ['',          'All statuses'],
  ['completed', 'Completed'],
  ['delayed',   'Delayed'],
];

export default function Trips() {
  const [haulerId, setHaulerId] = useState('');
  const [data, setData]         = useState(null);
  const [haulers, setHaulers]   = useState([]);
  const [error, setError]       = useState(null);
  const [direction, setDirection] = useState('');
  const [status, setStatus]       = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const loadHaulers = useCallback(async () => {
    try {
      const res = await authFetch('/api/haulers');
      if (res.ok) {
        const body = await res.json();
        setHaulers(Array.isArray(body) ? body : body.haulers ?? []);
      }
    } catch { /* non-fatal */ }
  }, []);

  const loadTrips = useCallback(async (hid) => {
    try {
      const qs = hid ? `?hauler_id=${encodeURIComponent(hid)}` : '';
      const res = await authFetch(`/api/trips${qs}`);
      if (!res.ok) throw new Error(`trips ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadHaulers(); }, [loadHaulers]);
  useEffect(() => { loadTrips(haulerId); }, [haulerId, loadTrips]);

  const allTrips = data?.trips ?? [];
  const filteredTrips = useMemo(() => allTrips.filter((t) => (
    (!direction || t.direction === direction) &&
    (!status    || t.status    === status)
  )), [allTrips, direction, status]);

  const anyFilter = direction || status;

  const southboundTotal = data?.cost_per_route?.find((r) => r.direction === 'southbound');
  const totalMargin = data?.cost_per_route?.reduce(
    (s, r) => s + (r.revenue_usd - r.cost_total_usd),
    0,
  );

  return (
    <PageShell
      eyebrow="Operations"
      title="Trips"
      description="Trip-level economics across the corridor. Costs rolled up per route direction; delay heatmap shows when the line actually bites. Click any trip for its GPS timeline, weighbridge events, and any alerts that cite it."
      actions={
        <HaulerFilter value={haulerId} onChange={setHaulerId} haulers={haulers} />
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
          Trip feed unavailable — {error}
        </div>
      )}

      <SummaryStrip
        count={data?.count}
        southboundTrips={southboundTotal?.trips}
        southboundTonnes={southboundTotal?.tonnes}
        totalMargin={totalMargin}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
      }}>
        <CostPerRouteCard rows={data?.cost_per_route} />
        <DelayHeatmap grid={data?.delay_heatmap} />
      </div>

      <FilterBar
        direction={direction} setDirection={setDirection}
        status={status}       setStatus={setStatus}
        count={filteredTrips.length}
        total={allTrips.length}
        anyFilter={anyFilter}
        onClear={() => { setDirection(''); setStatus(''); }}
      />

      <TripsTable trips={filteredTrips} onRowClick={(t) => setSelectedId(t.id)} />

      <div style={{ marginTop: 'var(--space-4)' }}>
        <IntelligencePanel page="trips" />
      </div>

      <TripDetail
        tripId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
      />
    </PageShell>
  );
}

function FilterBar({ direction, setDirection, status, setStatus, count, total, anyFilter, onClear }) {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center',
      flexWrap: 'wrap',
      padding: 'var(--space-3)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      marginBottom: 'var(--space-3)',
    }}>
      <FilterSelect label="Route"  value={direction} onChange={setDirection} options={ROUTE_OPTIONS} />
      <FilterSelect label="Status" value={status}    onChange={setStatus}    options={STATUS_OPTIONS} />

      {anyFilter && (
        <button
          type="button"
          onClick={onClear}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            border: '1px dashed var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Clear filters
        </button>
      )}

      <span style={{
        marginLeft: 'auto',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        {count} of {total} trips
      </span>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      >
        {options.map(([v, l]) => (
          <option key={`${label}-${v}`} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function SummaryStrip({ count, southboundTrips, southboundTonnes, totalMargin }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Stat label="Trips in window" value={count ?? '—'} />
      <Stat label="Laden trips" value={southboundTrips ?? 0} />
      <Stat
        label="Tonnes delivered"
        value={southboundTonnes ? Math.round(southboundTonnes).toLocaleString() : '—'}
        suffix="t"
      />
      <Stat
        label="Margin (7 day)"
        value={totalMargin != null ? `$${Math.round(totalMargin).toLocaleString()}` : '—'}
        tone={totalMargin != null && totalMargin < 0 ? 'warn' : 'ok'}
      />
    </div>
  );
}

function Stat({ label, value, suffix, tone }) {
  const color = tone === 'warn' ? 'var(--bauxite-rust)' : 'var(--text)';
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="tabular" style={{
          fontSize: 'var(--ts-stat-size)',
          lineHeight: 'var(--ts-stat-lh)',
          fontWeight: 'var(--fw-medium)',
          color,
        }}>
          {value}
        </span>
        {suffix && (
          <span style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
          }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
