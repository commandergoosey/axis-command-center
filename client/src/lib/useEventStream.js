/*
 * useEventStream — LP-25.
 *
 * React hook that connects to the AXIS SSE stream at /api/events/stream,
 * subscribes to specified event types, and invokes callbacks when events
 * arrive. Reconnects automatically with exponential back-off on drop.
 *
 * Usage:
 *   useEventStream({
 *     onTripStarted:   (payload) => ...,
 *     onTripCompleted: (payload) => ...,
 *     onPosition:      (payload) => ...,
 *     onAlert:         (payload) => ...,
 *   });
 *
 * The hook is a no-op when no callbacks are provided. It cleans up
 * the EventSource on unmount.
 *
 * Note: EventSource cannot send custom headers in browsers, so the
 * bearer token is passed as ?token= query parameter. The server's
 * auth middleware reads that param when the Authorization header is absent.
 */

import { useEffect, useRef } from 'react';
import { getToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const RECONNECT_BASE_MS  = 2_000;
const RECONNECT_MAX_MS   = 30_000;

export default function useEventStream({
  onTripStarted,
  onTripCompleted,
  onPosition,
  onAlert,
  enabled = true,
} = {}) {
  const esRef       = useRef(null);
  const retryMs     = useRef(RECONNECT_BASE_MS);
  const retryTimer  = useRef(null);
  const unmounted   = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    unmounted.current = false;

    function connect() {
      const token = getToken();
      if (!token) return; // not authenticated yet

      const url = `${API_BASE}/api/events/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const es  = new EventSource(url);
      esRef.current = es;

      es.addEventListener('connected', () => {
        retryMs.current = RECONNECT_BASE_MS; // reset back-off on successful connect
      });

      if (onTripStarted) {
        es.addEventListener('trip_started', (e) => {
          try { onTripStarted(JSON.parse(e.data)); } catch (_) {}
        });
      }

      if (onTripCompleted) {
        es.addEventListener('trip_completed', (e) => {
          try { onTripCompleted(JSON.parse(e.data)); } catch (_) {}
        });
      }

      if (onPosition) {
        es.addEventListener('position_update', (e) => {
          try { onPosition(JSON.parse(e.data)); } catch (_) {}
        });
      }

      if (onAlert) {
        es.addEventListener('alert_raised', (e) => {
          try { onAlert(JSON.parse(e.data)); } catch (_) {}
        });
      }

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!unmounted.current) {
          retryTimer.current = setTimeout(() => {
            if (!unmounted.current) {
              retryMs.current = Math.min(retryMs.current * 2, RECONNECT_MAX_MS);
              connect();
            }
          }, retryMs.current);
        }
      };
    }

    connect();

    return () => {
      unmounted.current = true;
      clearTimeout(retryTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
    // callbacks are stable refs from the caller — intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
