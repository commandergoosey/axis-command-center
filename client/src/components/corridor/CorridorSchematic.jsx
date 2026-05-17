/*
 * CorridorSchematic — horizontal SVG transit-map of the Nyinahin → Takoradi line.
 *
 * Y-zone layout (VIEW_H=260, LINE_Y=158):
 *   y=10–58   Segment pill strip (SEG label + L·E count)
 *   y=82–110  ABOVE label zone (name, km, connector stub)
 *   y=158     Corridor line (waypoint glyphs)
 *   y=178–200 BELOW label zone (connector stub, km, name)
 *   y=208–229 km scale strip
 *
 * Alternating label rule:
 *   Depots and weighbridges default ABOVE; junctions and rest stops default BELOW.
 *   If a waypoint would land in the same zone as a prior waypoint within 20 px X,
 *   it is flipped to the opposite zone — prevents co-located label collisions.
 */

const VIEW_W = 900;
const VIEW_H = 260;
const PAD_X  = 60;
const LINE_Y = 158;

// ABOVE zone Y-coords (absolute)
const ABOVE_NAME_Y = 88;
const ABOVE_KM_Y   = 104;
// BELOW zone Y-coords (absolute)
const BELOW_KM_Y   = 178;
const BELOW_NAME_Y = 194;
// km scale strip
const TICK_Y1      = 208;
const TICK_Y2      = 216;
const TICK_LABEL_Y = 229;
// Segment pill strip
const PILL_Y       = 10;
const PILL_H       = 48;
const PILL_SEG_Y   = 28;
const PILL_LE_Y    = 46;

const WAYPOINT_GLYPH = {
  depot:       { shape: 'square',  size: 11, color: 'var(--charcoal)' },
  weighbridge: { shape: 'diamond', size: 11, color: 'var(--bauxite-rust)' },
  rest:        { shape: 'circle',  size:  8, color: 'var(--iron)' },
  junction:    { shape: 'circle',  size:  6, color: 'var(--slate)' },
};

const DEFAULT_ZONE = {
  depot: 'above', weighbridge: 'above',
  rest:  'below', junction:   'below',
};

/** Assign each waypoint an 'above' or 'below' label zone, flipping on collision. */
function computeZones(waypoints, kmToX) {
  const placed = { above: [], below: [] };
  return waypoints.map((w) => {
    const x = kmToX(w.km);
    let zone = DEFAULT_ZONE[w.kind] ?? 'below';
    const collision = placed[zone].some((px) => Math.abs(px - x) < 20);
    if (collision) zone = zone === 'above' ? 'below' : 'above';
    placed[zone].push(x);
    return { ...w, zone };
  });
}

export default function CorridorSchematic({ waypoints, segments, lengthKm }) {
  if (!waypoints || waypoints.length === 0) return null;
  const kmToX = (km) => PAD_X + (km / lengthKm) * (VIEW_W - 2 * PAD_X);
  const zoned = computeZones([...waypoints].sort((a, b) => a.km - b.km), kmToX);

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-5)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">Corridor schematic</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Aggregated by segment · {lengthKm} km · laden (L) and empty (E) trucks
          </div>
        </div>
        <Legend />
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Nyinahin to Takoradi corridor schematic"
      >
        <defs>
          <marker
            id="axis-arrow"
            viewBox="0 0 10 10" refX="8" refY="5"
            markerWidth="5" markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--charcoal)" />
          </marker>
        </defs>

        {/* ── Segment pill strip ─────────────────────────────────────── */}
        {segments?.map((seg, idx) => {
          const from = waypoints.find((w) => w.id === seg.from);
          const to   = waypoints.find((w) => w.id === seg.to);
          if (!from || !to) return null;
          const x1  = kmToX(from.km) + 4;
          const x2  = kmToX(to.km)   - 4;
          const cx  = (kmToX(from.km) + kmToX(to.km)) / 2;
          const w   = Math.max(16, x2 - x1);
          return (
            <g key={seg.id}>
              <rect
                x={x1} y={PILL_Y}
                width={w} height={PILL_H}
                rx="5"
                fill="var(--surface-sunk)"
                stroke="var(--border-hairline)"
              />
              <text
                x={cx} y={PILL_SEG_Y}
                fontSize="9" textAnchor="middle"
                fill="var(--text-tertiary)"
                fontFamily="var(--font-mono)"
                letterSpacing="0.08em"
              >
                {`SEG ${String.fromCharCode(65 + idx)}`}
              </text>
              <text
                x={cx} y={PILL_LE_Y}
                fontSize="11" textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontWeight="500"
              >
                <tspan fill="var(--bauxite-rust)">{seg.laden}L</tspan>
                <tspan fill="var(--text-tertiary)"> · </tspan>
                <tspan fill="var(--iron)">{seg.empty}E</tspan>
              </text>
            </g>
          );
        })}

        {/* ── Corridor line ──────────────────────────────────────────── */}
        <line
          x1={PAD_X} y1={LINE_Y}
          x2={VIEW_W - PAD_X} y2={LINE_Y}
          stroke="var(--charcoal)" strokeWidth="2"
          markerEnd="url(#axis-arrow)"
        />

        {/* ── Waypoints (glyphs + zoned labels + connectors) ─────────── */}
        {zoned.map((w) => {
          const x     = kmToX(w.km);
          const glyph = WAYPOINT_GLYPH[w.kind] ?? WAYPOINT_GLYPH.junction;
          const above = w.zone === 'above';

          // Connector runs from just outside the glyph to just outside the label text.
          // Coords are relative to g transform(x, LINE_Y).
          const halfG    = Math.ceil(glyph.size / 2) + 1;
          const connTop  = above ? -(LINE_Y - ABOVE_KM_Y + 4) : halfG;     // rel y start
          const connBot  = above ? -halfG                      : BELOW_KM_Y - LINE_Y - 4; // rel y end

          return (
            <g key={w.id} transform={`translate(${x} ${LINE_Y})`}>
              {/* Connector stub */}
              <line
                x1={0} y1={connTop}
                x2={0} y2={connBot}
                stroke="var(--border-strong)"
                strokeWidth="1"
              />

              {/* Glyph */}
              <WaypointGlyph glyph={glyph} />

              {/* Labels */}
              {above ? (
                <>
                  <text
                    y={ABOVE_NAME_Y - LINE_Y}
                    fontSize="11" textAnchor="middle"
                    fill="var(--text)" fontFamily="var(--font-primary)" fontWeight="500"
                  >
                    {w.label}
                  </text>
                  <text
                    y={ABOVE_KM_Y - LINE_Y}
                    fontSize="10" textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontFamily="var(--font-mono)" letterSpacing="0.04em"
                  >
                    km {w.km}
                  </text>
                </>
              ) : (
                <>
                  <text
                    y={BELOW_KM_Y - LINE_Y}
                    fontSize="10" textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontFamily="var(--font-mono)" letterSpacing="0.04em"
                  >
                    km {w.km}
                  </text>
                  <text
                    y={BELOW_NAME_Y - LINE_Y}
                    fontSize="11" textAnchor="middle"
                    fill="var(--text)" fontFamily="var(--font-primary)" fontWeight="500"
                  >
                    {w.label}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* ── km scale strip ────────────────────────────────────────── */}
        {Array.from({ length: Math.floor(lengthKm / 50) + 1 }, (_, i) => i * 50).map((km) => (
          <g key={`tick-${km}`}>
            <line
              x1={kmToX(km)} y1={TICK_Y1}
              x2={kmToX(km)} y2={TICK_Y2}
              stroke="var(--border-strong)" strokeWidth="1"
            />
            <text
              x={kmToX(km)} y={TICK_LABEL_Y}
              fontSize="9" textAnchor="middle"
              fill="var(--text-tertiary)"
              fontFamily="var(--font-mono)" letterSpacing="0.04em"
            >
              {km}
            </text>
          </g>
        ))}
        {/* km baseline rule */}
        <line
          x1={PAD_X} y1={TICK_Y1}
          x2={VIEW_W - PAD_X} y2={TICK_Y1}
          stroke="var(--border-hairline)" strokeWidth="0.5"
        />
      </svg>
    </div>
  );
}

function WaypointGlyph({ glyph }) {
  const { shape, size, color } = glyph;
  const h = size / 2;
  if (shape === 'square')  return <rect x={-h} y={-h} width={size} height={size} fill={color} />;
  if (shape === 'diamond') return <rect x={-h} y={-h} width={size} height={size} fill={color} transform="rotate(45)" />;
  return <circle r={h} fill={color} />;
}

function Legend() {
  return (
    <div style={{
      display: 'flex', gap: 'var(--space-3)',
      fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)',
      flexWrap: 'wrap',
    }}>
      <LegendItem label="Depot"       shape="square"  color="var(--charcoal)" />
      <LegendItem label="Weighbridge" shape="diamond" color="var(--bauxite-rust)" />
      <LegendItem label="Rest / junction" shape="circle" color="var(--iron)" />
      <LegendItem label="L laden · E empty" mono />
    </div>
  );
}

function LegendItem({ label, shape, color, mono }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {shape && (
        <svg width="11" height="11" viewBox="-6 -6 12 12">
          {shape === 'square'  && <rect x="-4" y="-4" width="8" height="8" fill={color} />}
          {shape === 'diamond' && <rect x="-4" y="-4" width="8" height="8" fill={color} transform="rotate(45)" />}
          {shape === 'circle'  && <circle r="4" fill={color} />}
        </svg>
      )}
      <span className={mono ? 'mono' : undefined}>{label}</span>
    </span>
  );
}
