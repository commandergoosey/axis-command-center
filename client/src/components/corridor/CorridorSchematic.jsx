/*
 * CorridorSchematic — horizontal SVG transit-map of the Nyinahin → Takoradi line.
 *
 * Y-zone layout (VIEW_H=260, LINE_Y=155):
 *   y=10–58   Segment pill strip  (SEG A + L·E count)
 *   y=72–100  ABOVE label zone    (name, km)
 *   y=155     Corridor line        (waypoint glyphs)
 *   y=172–192 BELOW label zone    (km, name)
 *   y=206–226 km scale strip
 *
 * Close-pair rule: waypoints within CLOSE_KM of their predecessor only
 * show a glyph + tiny km number — no name text. This keeps the three
 * paired stops (km 0/2, km 150/152, km 298/300) uncluttered.
 *
 * Major-waypoint zone alternates ABOVE/BELOW by index so adjacent main
 * labels never land in the same vertical band.
 */

const VIEW_W = 900;
const VIEW_H = 260;
const PAD_X  = 60;
const LINE_Y = 155;
const CLOSE_KM = 10;          // suppress name if within this many km of prior waypoint

// ABOVE zone (absolute y)
const A_NAME_Y = 80;
const A_KM_Y   = 96;
// BELOW zone (absolute y)
const B_KM_Y   = 174;
const B_NAME_Y = 190;
// km scale strip
const S_TICK1  = 206;
const S_TICK2  = 214;
const S_LABEL  = 226;
// Segment pill strip
const P_TOP    = 10;
const P_H      = 48;
const P_SEG_Y  = 28;
const P_LE_Y   = 46;

const GLYPH_CFG = {
  depot:       { shape: 'square',  size: 11, color: 'var(--charcoal)' },
  weighbridge: { shape: 'diamond', size: 11, color: 'var(--bauxite-rust)' },
  rest:        { shape: 'circle',  size:  8, color: 'var(--iron)' },
  junction:    { shape: 'circle',  size:  6, color: 'var(--slate)' },
};

/** Tag each waypoint with showName and zone. */
function annotate(waypoints, kmToX) {
  const sorted = [...waypoints].sort((a, b) => a.km - b.km);
  let majorIdx = 0;
  return sorted.map((w, i) => {
    const isClose  = i > 0 && (w.km - sorted[i - 1].km) <= CLOSE_KM;
    const showName = !isClose;
    // Major waypoints alternate ABOVE/BELOW; minor always BELOW (short km text only)
    const zone = showName
      ? (majorIdx++ % 2 === 0 ? 'above' : 'below')
      : 'below';
    return { ...w, showName, zone, x: kmToX(w.km) };
  });
}

/** Shorten label to first word only for the schematic strip. */
function shortLabel(label) {
  // "Nyinahin mine gate" → "Nyinahin"  |  "Kumasi junction" → "Kumasi"
  return label.split(' ')[0];
}

export default function CorridorSchematic({ waypoints, segments, lengthKm }) {
  if (!waypoints || waypoints.length === 0) return null;
  const kmToX = (km) => PAD_X + (km / lengthKm) * (VIEW_W - 2 * PAD_X);
  const tagged = annotate(waypoints, kmToX);

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
            id="cs-arrow"
            viewBox="0 0 10 10" refX="8" refY="5"
            markerWidth="5" markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--charcoal)" />
          </marker>
        </defs>

        {/* ── Segment pill strip (above the line) ────────────────────── */}
        {segments?.map((seg, idx) => {
          const from = waypoints.find((w) => w.id === seg.from);
          const to   = waypoints.find((w) => w.id === seg.to);
          if (!from || !to) return null;
          const x1 = kmToX(from.km) + 4;
          const x2 = kmToX(to.km) - 4;
          const cx = (x1 + x2) / 2;
          const pw = Math.max(16, x2 - x1);
          return (
            <g key={seg.id}>
              <rect
                x={x1} y={P_TOP} width={pw} height={P_H}
                rx="5"
                fill="var(--surface-sunk)"
                stroke="var(--border-hairline)"
              />
              <text
                x={cx} y={P_SEG_Y}
                fontSize="9" textAnchor="middle"
                fill="var(--text-tertiary)"
                fontFamily="var(--font-mono)"
                letterSpacing="0.08em"
              >
                {`SEG ${String.fromCharCode(65 + idx)}`}
              </text>
              <text
                x={cx} y={P_LE_Y}
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
          markerEnd="url(#cs-arrow)"
        />

        {/* ── Waypoints ─────────────────────────────────────────────── */}
        {tagged.map((w) => {
          const gcfg  = GLYPH_CFG[w.kind] ?? GLYPH_CFG.junction;
          const half  = Math.ceil(gcfg.size / 2) + 1;
          const above = w.zone === 'above';

          if (!w.showName) {
            // Minor waypoint — glyph + small km number below
            return (
              <g key={w.id} transform={`translate(${w.x} ${LINE_Y})`}>
                <line
                  x1={0} y1={half}
                  x2={0} y2={B_KM_Y - LINE_Y - 3}
                  stroke="var(--border-hairline)" strokeWidth="1"
                />
                <WaypointGlyph glyph={gcfg} />
                <text
                  y={B_KM_Y - LINE_Y}
                  fontSize="9" textAnchor="middle"
                  fill="var(--text-tertiary)"
                  fontFamily="var(--font-mono)"
                >
                  {w.km}
                </text>
              </g>
            );
          }

          // Major waypoint — name + km in the assigned zone
          const connY1 = above ? -(LINE_Y - A_KM_Y - 3) : half;
          const connY2 = above ? -half                   : B_KM_Y - LINE_Y - 3;

          return (
            <g key={w.id} transform={`translate(${w.x} ${LINE_Y})`}>
              <line
                x1={0} y1={connY1}
                x2={0} y2={connY2}
                stroke="var(--border-strong)" strokeWidth="1"
              />
              <WaypointGlyph glyph={gcfg} />
              {above ? (
                <>
                  <text
                    y={A_NAME_Y - LINE_Y}
                    fontSize="12" fontWeight="600" textAnchor="middle"
                    fill="var(--text)" fontFamily="var(--font-primary)"
                  >
                    {shortLabel(w.label)}
                  </text>
                  <text
                    y={A_KM_Y - LINE_Y}
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
                    y={B_KM_Y - LINE_Y}
                    fontSize="10" textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontFamily="var(--font-mono)" letterSpacing="0.04em"
                  >
                    km {w.km}
                  </text>
                  <text
                    y={B_NAME_Y - LINE_Y}
                    fontSize="12" fontWeight="600" textAnchor="middle"
                    fill="var(--text)" fontFamily="var(--font-primary)"
                  >
                    {shortLabel(w.label)}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* ── km scale strip ────────────────────────────────────────── */}
        <line
          x1={PAD_X} y1={S_TICK1}
          x2={VIEW_W - PAD_X} y2={S_TICK1}
          stroke="var(--border-hairline)" strokeWidth="0.5"
        />
        {Array.from({ length: Math.floor(lengthKm / 50) + 1 }, (_, i) => i * 50).map((km) => (
          <g key={`tick-${km}`}>
            <line
              x1={kmToX(km)} y1={S_TICK1}
              x2={kmToX(km)} y2={S_TICK2}
              stroke="var(--border-strong)" strokeWidth="1"
            />
            <text
              x={kmToX(km)} y={S_LABEL}
              fontSize="9" textAnchor="middle"
              fill="var(--text-tertiary)"
              fontFamily="var(--font-mono)" letterSpacing="0.04em"
            >
              {km}
            </text>
          </g>
        ))}
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
      <LegendItem label="Rest / jct"  shape="circle"  color="var(--iron)" />
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
