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
const IRON     = '#6B6763';
const CHARCOAL = '#1F1F1F';

/*
 * Road-following trace of the Nyinahin → Takoradi corridor.
 * Approximates the N8/A8/N10 road network with ~32 intermediate points so the
 * Leaflet polyline follows the actual arc rather than drawing displacement lines.
 *
 * Key fix: the Dunkwa → Takoradi segment swings SW through the Tarkwa mining
 * area before turning SE to Takoradi — the straight-line version was almost
 * exactly vertical (Δlng ≈ 0.002°) and looked like a glitch.
 */
const CORRIDOR_ROUTE = [
  [6.599, -2.110], // Nyinahin mine gate
  [6.585, -2.098], // Nyinahin weighbridge
  [6.580, -2.063],
  [6.592, -2.010],
  [6.610, -1.953],
  [6.628, -1.888],
  [6.648, -1.820],
  [6.662, -1.748],
  [6.675, -1.683],
  [6.688, -1.623], // Kumasi junction
  [6.645, -1.583],
  [6.563, -1.548],
  [6.470, -1.512],
  [6.383, -1.488],
  [6.289, -1.483], // Fomena rest stop
  [6.274, -1.473], // Bekwai weighbridge
  [6.193, -1.506],
  [6.103, -1.592],
  [6.020, -1.684],
  [5.964, -1.775], // Dunkwa rest stop
  [5.880, -1.838], // ← road swings SW toward Tarkwa
  [5.795, -1.900],
  [5.700, -1.955],
  [5.598, -1.992],
  [5.487, -2.010],
  [5.368, -2.007],
  [5.248, -1.983], // Tarkwa area
  [5.138, -1.940],
  [5.038, -1.875],
  [4.958, -1.824],
  [4.905, -1.773], // Takoradi weighbridge
  [4.889, -1.755], // Takoradi port
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

export default function CorridorMap({ waypoints, convoys }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const layersRef    = useRef({ waypoints: [], convoys: [], route: null });

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

    // Route polyline — use the road-following CORRIDOR_ROUTE, not waypoint straight lines
    const route = L.polyline(CORRIDOR_ROUTE, {
      color: RUST, weight: 3, opacity: 0.85,
      dashArray: null, lineJoin: 'round', lineCap: 'round',
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

  const onSchedule = convoys?.filter((c) => c.on_schedule).length ?? 0;
  const total      = convoys?.length ?? 0;

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
            Nyinahin–Takoradi · 300 km · convoy positions interpolated from km marker
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexShrink: 0 }}>
          <LegendItem color={RUST}  label={`${onSchedule} on time`} dot />
          <LegendItem color={AMBER} label={`${total - onSchedule} delayed`} dot />
          <LegendItem color={CHARCOAL} label="Depot" square />
          <LegendItem color={RUST}    label="Weighbridge" diamond />
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

function LegendItem({ color, label, dot, square, diamond }) {
  let shapeStyle = {};
  if (dot)     shapeStyle = { width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 };
  if (square)  shapeStyle = { width: 9, height: 9, borderRadius: 1, background: color, flexShrink: 0 };
  if (diamond) shapeStyle = { width: 8, height: 8, background: color, transform: 'rotate(45deg)', borderRadius: 1, flexShrink: 0 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={shapeStyle} />
      <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}
