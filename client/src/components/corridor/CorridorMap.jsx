/*
 * CorridorMap — Phase 106.
 *
 * Interactive Leaflet map of the Nyinahin–Takoradi corridor.
 * CartoDB Positron tiles (free, no API key).
 * Shows:
 *   • Corridor polyline — Bauxite Rust, 3px
 *   • Waypoint markers — depot (filled square), weighbridge (diamond),
 *     rest stop (circle), junction (small circle)
 *   • Convoy markers — position interpolated from km along the route.
 *     Colour: Bauxite Rust (on time) or Amber (delayed). Click for popup.
 */

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// ── Fix leaflet's default icon paths broken by Vite asset pipeline ────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const RUST     = '#A23E23';
const AMBER    = '#B45309';
const GREEN    = '#16A34A';
const IRON     = '#6B6763';
const CHARCOAL = '#1F1F1F';

/*
 * Actual road geometry for the Nyinahin → Takoradi corridor,
 * sourced from OSRM (router.project-osrm.org, driving profile).
 * 32 waypoints in [lat, lng] order for Leaflet.
 *
 * Key topographic feature: the route swings significantly west (lng ≈ -2.136)
 * through the Tarkwa mining belt before arcing back SE toward Takoradi port.
 * Points 20–21 are linear interpolations between OSRM returns 19 and 22.
 */
const CORRIDOR_ROUTE = [
  [6.599073, -2.109706], // Nyinahin mine gate
  [6.605677, -2.003984],
  [6.653674, -1.887975],
  [6.660419, -1.815554],
  [6.698376, -1.783460],
  [6.687825, -1.623011], // Kumasi junction area
  [6.540770, -1.670145],
  [6.464592, -1.637065],
  [6.344924, -1.630563],
  [6.146299, -1.713866], // Fomena / Bekwai area
  [6.088628, -1.782048],
  [6.031867, -1.758502],
  [5.964042, -1.774960], // Dunkwa area
  [5.962234, -1.896670],
  [5.772003, -2.100521],
  [5.693347, -2.135650], // Tarkwa — westernmost point
  [5.590274, -2.053872],
  [5.568350, -2.005313],
  [5.512441, -1.987626],
  [5.469894, -2.007738],
  [5.463115, -2.000633], // interpolated
  [5.456336, -1.993528], // interpolated
  [5.449557, -1.986423],
  [5.368243, -2.000038],
  [5.332371, -1.978343],
  [5.199569, -2.029566],
  [5.102584, -2.112336],
  [5.009645, -2.085324],
  [5.004763, -2.027452],
  [4.972359, -1.987270],
  [4.890048, -1.959336],
  [4.888673, -1.754722], // Takoradi port
];

// Interpolate a lat/lng position along the corridor given a km value.
function interpolate(km, waypoints) {
  if (!waypoints?.length) return null;
  const sorted = [...waypoints].sort((a, b) => a.km - b.km);
  if (km <= sorted[0].km) return [sorted[0].lat, sorted[0].lng];
  const last = sorted[sorted.length - 1];
  if (km >= last.km) return [last.lat, last.lng];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (km >= a.km && km <= b.km) {
      const t = (km - a.km) / (b.km - a.km);
      return [a.lat + t * (b.lat - a.lat), a.lng + t * (b.lng - a.lng)];
    }
  }
  return [sorted[0].lat, sorted[0].lng];
}

// DivIcon factory — keeps AXIS chrome consistent with the design system.
function waypointIcon(kind) {
  const configs = {
    depot:       { size: 12, color: CHARCOAL, shape: 'square' },
    weighbridge: { size: 11, color: RUST,     shape: 'diamond' },
    rest:        { size: 8,  color: IRON,     shape: 'circle' },
    junction:    { size: 7,  color: IRON,     shape: 'circle' },
  };
  const cfg = configs[kind] ?? configs.junction;
  const s   = cfg.size;
  let shapeStyle = '';
  if (cfg.shape === 'square') {
    shapeStyle = `width:${s}px;height:${s}px;background:${cfg.color};border-radius:1px;`;
  } else if (cfg.shape === 'diamond') {
    shapeStyle = `width:${s}px;height:${s}px;background:${cfg.color};transform:rotate(45deg);border-radius:1px;`;
  } else {
    shapeStyle = `width:${s}px;height:${s}px;background:${cfg.color};border-radius:50%;`;
  }
  const html = `<div style="display:flex;align-items:center;justify-content:center;"><div style="${shapeStyle}border:1.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,.35);"></div></div>`;
  return L.divIcon({ html, iconSize: [s + 4, s + 4], iconAnchor: [(s + 4) / 2, (s + 4) / 2], className: '' });
}

// GPS device marker — square to visually distinguish from round convoy dots.
function deviceIcon(lastSeenAt) {
  const minsAgo = lastSeenAt
    ? (Date.now() - new Date(lastSeenAt).getTime()) / 60_000
    : Infinity;
  const color = minsAgo < 5 ? GREEN : minsAgo < 30 ? AMBER : RUST;
  const html = `<div style="
    width:8px;height:8px;
    background:${color};
    border:2px solid white;
    border-radius:2px;
    box-shadow:0 0 0 1.5px ${color}99,0 1px 3px rgba(0,0,0,.4);
  "></div>`;
  return L.divIcon({ html, iconSize: [12, 12], iconAnchor: [6, 6], className: '' });
}

function convoyIcon(onSchedule) {
  const color = onSchedule ? RUST : AMBER;
  const html = `<div style="
    width:10px;height:10px;
    background:${color};
    border:2px solid white;
    border-radius:50%;
    box-shadow:0 0 0 2px ${color}55, 0 1px 4px rgba(0,0,0,.4);
  "></div>`;
  return L.divIcon({ html, iconSize: [14, 14], iconAnchor: [7, 7], className: '' });
}

export default function CorridorMap({ waypoints, convoys, devices = [] }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const layersRef    = useRef({ waypoints: [], convoys: [], devices: [], route: null });

  // ── Initialise map once ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: true,
    });

    // CartoDB Positron — monochrome, no API key
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 14,
      },
    ).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Draw/update waypoint markers and route whenever waypoints change ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !waypoints?.length) return;

    // Remove old waypoint layers
    layersRef.current.waypoints.forEach((l) => map.removeLayer(l));
    if (layersRef.current.route) map.removeLayer(layersRef.current.route);
    layersRef.current.waypoints = [];

    // Route polyline — use the road-following CORRIDOR_ROUTE, not waypoint straight lines.
    // smoothFactor:0 disables Leaflet's Douglas-Peucker simplification so all 32
    // intermediate points render regardless of zoom level (prevents the arc collapsing
    // back into a straight vertical line on the Dunkwa→Tarkwa→Takoradi section).
    const route = L.polyline(CORRIDOR_ROUTE, {
      color: RUST, weight: 3, opacity: 0.85,
      smoothFactor: 0,
      lineJoin: 'round', lineCap: 'round',
    }).addTo(map);
    layersRef.current.route = route;

    // Waypoint markers
    const markers = waypoints.map((w) => {
      const m = L.marker([w.lat, w.lng], { icon: waypointIcon(w.kind), zIndexOffset: 100 })
        .addTo(map);

      const kindLabel = {
        depot: 'Depot',
        weighbridge: 'Weighbridge',
        rest: 'Rest stop',
        junction: 'Junction',
      }[w.kind] ?? w.kind;

      m.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;min-width:140px;">
          <div style="font-weight:600;color:${CHARCOAL};margin-bottom:3px;">${w.label}</div>
          <div style="color:${IRON};font-size:11px;">${kindLabel} · ${w.km} km</div>
        </div>`,
        { maxWidth: 220, className: 'axis-popup' },
      );
      return m;
    });
    layersRef.current.waypoints = markers;

    // Fit map to the route on first load
    map.fitBounds(route.getBounds(), { padding: [40, 40] });
  }, [waypoints]);

  // ── Draw/update convoy markers whenever convoys change ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    layersRef.current.convoys.forEach((l) => map.removeLayer(l));
    layersRef.current.convoys = [];

    if (!waypoints?.length || !convoys?.length) return;

    const markers = convoys
      .filter((c) => c.km != null)
      .map((c) => {
        const pos = interpolate(c.km, waypoints);
        if (!pos) return null;

        const m = L.marker(pos, { icon: convoyIcon(c.on_schedule), zIndexOffset: 200 }).addTo(map);

        const phase = c.phase ? c.phase.charAt(0).toUpperCase() + c.phase.slice(1) : '—';
        const dir   = c.direction === 'northbound' ? '↑ Northbound' : '↓ Southbound';
        const sched = c.on_schedule
          ? `<span style="color:#16A34A;">On schedule</span>`
          : `<span style="color:${AMBER};">Delayed</span>`;

        m.bindPopup(
          `<div style="font-family:sans-serif;font-size:12px;min-width:160px;">
            <div style="font-weight:600;color:${CHARCOAL};margin-bottom:4px;">${c.id}</div>
            <div style="color:${IRON};font-size:11px;margin-bottom:2px;">${c.hauler_display_name ?? c.hauler_id}</div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;color:${CHARCOAL};">
              <tr><td style="padding:1px 0;color:${IRON};">Phase</td><td style="text-align:right;">${phase}</td></tr>
              <tr><td style="padding:1px 0;color:${IRON};">Position</td><td style="text-align:right;">${c.km} km</td></tr>
              <tr><td style="padding:1px 0;color:${IRON};">Direction</td><td style="text-align:right;">${dir}</td></tr>
              <tr><td style="padding:1px 0;color:${IRON};">Trucks</td><td style="text-align:right;">${c.trucks}</td></tr>
              <tr><td style="padding:1px 0;color:${IRON};">Status</td><td style="text-align:right;">${sched}</td></tr>
            </table>
            ${c.notes ? `<div style="margin-top:5px;color:${IRON};font-size:10px;border-top:1px solid #eee;padding-top:4px;">${c.notes}</div>` : ''}
          </div>`,
          { maxWidth: 240, className: 'axis-popup' },
        );
        return m;
      })
      .filter(Boolean);

    layersRef.current.convoys = markers;
  }, [waypoints, convoys]);

  // ── GPS device layer — real lat/lng from MQTT telematics ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    layersRef.current.devices.forEach((l) => map.removeLayer(l));
    layersRef.current.devices = [];

    const positioned = devices.filter(
      (d) => d.active && d.last_position?.latitude != null && d.last_position?.longitude != null,
    );
    if (!positioned.length) return;

    const markers = positioned.map((d) => {
      const pos  = [d.last_position.latitude, d.last_position.longitude];
      const hbAt = d.health?.last_seen_at ?? null;
      const m    = L.marker(pos, { icon: deviceIcon(hbAt), zIndexOffset: 300 }).addTo(map);

      const speed   = d.last_position.speed_kmh != null ? `${d.last_position.speed_kmh} km/h` : '—';
      const posAt   = d.last_position.position_at
        ? new Date(d.last_position.position_at).toLocaleTimeString()
        : '—';
      const minsAgo = hbAt
        ? Math.round((Date.now() - new Date(hbAt).getTime()) / 60_000)
        : null;
      const seenStr = minsAgo == null ? '—'
        : minsAgo < 1  ? 'Just now'
        : `${minsAgo}m ago`;

      m.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;min-width:160px;">
          <div style="font-weight:600;color:${CHARCOAL};margin-bottom:3px;">${d.vehicle_id ?? d.imei}</div>
          <div style="color:${IRON};font-size:11px;margin-bottom:5px;">${d.hauler_id ?? 'Unassigned'} · GPS</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;color:${CHARCOAL};">
            <tr><td style="padding:1px 0;color:${IRON};">Speed</td><td style="text-align:right;">${speed}</td></tr>
            <tr><td style="padding:1px 0;color:${IRON};">Position at</td><td style="text-align:right;">${posAt}</td></tr>
            <tr><td style="padding:1px 0;color:${IRON};">Last seen</td><td style="text-align:right;">${seenStr}</td></tr>
            <tr><td style="padding:1px 0;color:${IRON};">IMEI</td><td style="text-align:right;font-family:monospace;font-size:10px;">${d.imei}</td></tr>
          </table>
        </div>`,
        { maxWidth: 240, className: 'axis-popup' },
      );
      return m;
    });

    layersRef.current.devices = markers;
  }, [devices]);

  const onSchedule = convoys?.filter((c) => c.on_schedule).length ?? 0;
  const total      = convoys?.length ?? 0;
  const gpsOnline  = devices.filter(
    (d) => d.active && d.last_position?.latitude != null
      && d.health?.last_seen_at
      && (Date.now() - new Date(d.health.last_seen_at).getTime()) < 30 * 60_000,
  ).length;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <div>
          <div className="eyebrow">Corridor map</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Nyinahin–Takoradi · 300 km · convoy positions from km marker · GPS squares from live MQTT
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <LegendItem color={RUST}  label={`${onSchedule} on time`} dot />
          <LegendItem color={AMBER} label={`${total - onSchedule} delayed`} dot />
          <LegendItem color={CHARCOAL} label="Depot" square />
          <LegendItem color={RUST}    label="Weighbridge" diamond />
          {devices.length > 0 && <>
            <div style={{ width: 1, height: 14, background: 'var(--border-hairline)', margin: '0 4px' }} />
            <LegendItem color={GREEN} label={`${gpsOnline} GPS live`}  squareSm />
            <LegendItem color={RUST}  label="GPS offline" squareSm />
          </>}
        </div>
      </div>

      {/* Map container */}
      <div
        ref={containerRef}
        style={{ height: 480, width: '100%' }}
      />
    </div>
  );
}

function LegendItem({ color, label, dot, square, squareSm, diamond }) {
  let shapeStyle = {};
  if (dot)      shapeStyle = { width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 };
  if (square)   shapeStyle = { width: 9, height: 9, borderRadius: 1, background: color, flexShrink: 0 };
  if (squareSm) shapeStyle = { width: 7, height: 7, borderRadius: 1.5, background: color, flexShrink: 0 };
  if (diamond)  shapeStyle = { width: 8, height: 8, background: color, transform: 'rotate(45deg)', borderRadius: 1, flexShrink: 0 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={shapeStyle} />
      <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}
