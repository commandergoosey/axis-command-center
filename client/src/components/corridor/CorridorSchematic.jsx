/*
 * CorridorSchematic — horizontal SVG of the Nyinahin → Takoradi line.
 * Waypoint glyphs sit above the line (depot / weighbridge / rest / junction);
 * per-segment laden/empty truck counts sit below.
 *
 * Intentionally not a tracking map — aggregated by segment, per BRIEF.md §7.2.
 */

const WAYPOINT_GLYPH = {
  depot:       { shape: 'square',  size: 10, color: 'var(--charcoal)' },
  weighbridge: { shape: 'diamond', size: 10, color: 'var(--bauxite-rust)' },
  rest:        { shape: 'circle',  size: 8,  color: 'var(--iron)' },
  junction:    { shape: 'circle',  size: 6,  color: 'var(--slate)' },
};

const VIEW_W = 900;
const VIEW_H = 300;
const PAD_X  = 60;
const LINE_Y = 150;

export default function CorridorSchematic({ waypoints, segments, lengthKm }) {
  if (!waypoints || waypoints.length === 0) return null;
  const kmToX = (km) => PAD_X + (km / lengthKm) * (VIEW_W - 2 * PAD_X);

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="eyebrow">Corridor schematic</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Aggregated by segment · {lengthKm} km
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
          <marker id="axis-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--charcoal)" />
          </marker>
        </defs>

        {/* corridor line */}
        <line
          x1={PAD_X} y1={LINE_Y} x2={VIEW_W - PAD_X} y2={LINE_Y}
          stroke="var(--charcoal)" strokeWidth="2"
          markerEnd="url(#axis-arrow)"
        />

        {/* km ticks every 50 km */}
        {Array.from({ length: Math.floor(lengthKm / 50) + 1 }, (_, i) => i * 50).map((km) => (
          <g key={`tick-${km}`}>
            <line x1={kmToX(km)} y1={LINE_Y + 4} x2={kmToX(km)} y2={LINE_Y + 10} stroke="var(--border-strong)" />
            <text
              x={kmToX(km)}
              y={LINE_Y + 22}
              fontSize="10"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontFamily="var(--font-mono)"
              letterSpacing="0.04em"
            >
              {km}
            </text>
          </g>
        ))}

        {/* segment laden/empty overlays */}
        {segments?.map((seg, idx) => {
          const from = waypoints.find((w) => w.id === seg.from);
          const to   = waypoints.find((w) => w.id === seg.to);
          if (!from || !to) return null;
          const x = (kmToX(from.km) + kmToX(to.km)) / 2;
          const y = LINE_Y + 56;
          return (
            <g key={seg.id}>
              <rect
                x={kmToX(from.km) + 4}
                y={LINE_Y - 34}
                width={Math.max(12, kmToX(to.km) - kmToX(from.km) - 8)}
                height={28}
                rx="4"
                fill="var(--surface-sunk)"
                stroke="var(--border-hairline)"
              />
              <text
                x={x}
                y={LINE_Y - 20}
                fontSize="10"
                textAnchor="middle"
                fill="var(--text-tertiary)"
                fontFamily="var(--font-mono)"
                letterSpacing="0.06em"
              >
                {`SEG ${String.fromCharCode(65 + idx)}`}
              </text>
              <text
                x={x}
                y={LINE_Y - 8}
                fontSize="11"
                textAnchor="middle"
                fill="var(--text)"
                fontFamily="var(--font-mono)"
                fontWeight="500"
              >
                <tspan fill="var(--bauxite-rust)">{seg.laden}L</tspan>
                <tspan> · </tspan>
                <tspan fill="var(--iron)">{seg.empty}E</tspan>
              </text>

              <text
                x={x} y={y}
                fontSize="10"
                textAnchor="middle"
                fill="var(--text-tertiary)"
                fontFamily="var(--font-mono)"
                letterSpacing="0.04em"
              >
                {seg.laden + seg.empty} trks
              </text>
            </g>
          );
        })}

        {/* waypoints */}
        {waypoints.map((w) => {
          const x = kmToX(w.km);
          const glyph = WAYPOINT_GLYPH[w.kind] ?? WAYPOINT_GLYPH.junction;
          return (
            <g key={w.id} transform={`translate(${x} ${LINE_Y})`}>
              <WaypointGlyph glyph={glyph} />
              <text
                y={-24}
                fontSize="11"
                textAnchor="middle"
                fill="var(--text)"
                fontFamily="var(--font-primary)"
                fontWeight="500"
              >
                {w.label}
              </text>
              <text
                y={-10}
                fontSize="10"
                textAnchor="middle"
                fill="var(--text-tertiary)"
                fontFamily="var(--font-mono)"
                letterSpacing="0.04em"
              >
                km {w.km}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function WaypointGlyph({ glyph }) {
  const { shape, size, color } = glyph;
  if (shape === 'square') {
    return <rect x={-size / 2} y={-size / 2} width={size} height={size} fill={color} />;
  }
  if (shape === 'diamond') {
    return <rect x={-size / 2} y={-size / 2} width={size} height={size} fill={color} transform="rotate(45)" />;
  }
  return <circle r={size / 2} fill={color} />;
}

function Legend() {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-3)',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text-tertiary)',
    }}>
      <LegendItem label="Depot" shape="square" color="var(--charcoal)" />
      <LegendItem label="Weighbridge" shape="diamond" color="var(--bauxite-rust)" />
      <LegendItem label="Rest" shape="circle" color="var(--iron)" />
      <LegendItem label="L / E" mono />
    </div>
  );
}

function LegendItem({ label, shape, color, mono }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {shape && (
        <svg width="10" height="10" viewBox="-6 -6 12 12">
          {shape === 'square'  && <rect x="-4" y="-4" width="8" height="8" fill={color} />}
          {shape === 'diamond' && <rect x="-4" y="-4" width="8" height="8" fill={color} transform="rotate(45)" />}
          {shape === 'circle'  && <circle r="4" fill={color} />}
        </svg>
      )}
      <span className={mono ? 'mono' : undefined}>{label}</span>
    </span>
  );
}
