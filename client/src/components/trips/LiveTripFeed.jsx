/*
 * LiveTripFeed — LP-20.
 *
 * Polls /api/trips/live every 30 seconds and renders a compact strip of
 * in-progress trips sourced from real webhook / FMS-poller data.
 *
 * Empty when no trips are in flight (demo mode before the poller has run,
 * or a quiet corridor window). Hides entirely rather than showing a skeleton
 * so it doesn't clutter the Trips page on quiet days.
 */

import { useEffect, useRef, useState } from 'react';
import { Truck, ArrowDown, ArrowUp, Clock } from 'lucide-react';
import { authFetch }      from '../../lib/auth';
import useEventStream     from '../../lib/useEventStream';

const POLL_MS = 30_000;

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function DirectionChip({ direction }) {
  const laden = direction !== 'northbound';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px',
      fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
      textTransform: 'uppercase',
      borderRadius: 999,
      background: laden ? 'rgba(46, 107, 63, 0.10)' : 'rgba(217, 158, 55, 0.10)',
      color: laden ? 'var(--signal-green)' : 'var(--signal-amber)',
      border: `1px solid ${laden ? 'rgba(46,107,63,0.25)' : 'rgba(217,158,55,0.25)'}`,
    }}>
      {laden ? <ArrowDown size={9} /> : <ArrowUp size={9} />}
      {laden ? 'Laden' : 'Empty'}
    </span>
  );
}

export default function LiveTripFeed({ haulerId = '' }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const load = async () => {
    try {
      const qs  = haulerId ? `?hauler_id=${encodeURIComponent(haulerId)}` : '';
      const res = await authFetch(`/api/trips/live${qs}`);
      if (!res.ok) return;
      const j = await res.json();
      setTrips(j.trips ?? []);
    } catch (_) {
      /* non-fatal — feed just won't update */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haulerId]);

  // LP-25: reload feed immediately when a trip starts or completes.
  useEventStream({
    onTripStarted:   () => load(),
    onTripCompleted: () => load(),
  });

  // Don't render anything while loading for the first time, or when empty.
  if (loading || trips.length === 0) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--signal-green)',
          boxShadow: '0 0 0 3px rgba(46,107,63,0.18)',
        }} />
        <Truck size={12} strokeWidth={1.6} color="var(--text-secondary)" />
        <span className="eyebrow" style={{ fontSize: 10 }}>Live · {trips.length} trip{trips.length !== 1 ? 's' : ''} in progress</span>
      </header>

      {/* Trip rows */}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {trips.map((t) => (
          <li key={t.id} style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border-hairline)',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'center',
            gap: 12,
          }}>
            {/* Left: vehicle + hauler + route */}
            <div style={{ minWidth: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.02em',
                }}>
                  {t.vehicle_id ?? 'Unknown vehicle'}
                </span>
                <DirectionChip direction={t.direction} />
                {t.hauler_display_name && (
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                    {t.hauler_display_name}
                  </span>
                )}
              </div>
              {(t.origin || t.destination) && (
                <div style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  marginTop: 3,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {t.origin ?? '—'} → {t.destination ?? '—'}
                </div>
              )}
            </div>

            {/* Right: departure time */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap',
            }}>
              <Clock size={9} />
              {fmtRelative(t.departed_at)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
