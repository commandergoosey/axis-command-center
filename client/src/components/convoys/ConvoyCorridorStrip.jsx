/*
 * ConvoyCorridorStrip — horizontal track showing every active convoy's
 * km position on the Nyinahin→Takoradi line. Laden convoys render on the
 * top lane (heading south); empty convoys render on the bottom lane
 * (returning north). A delayed convoy gets a Bauxite Rust ring.
 */

const VIEW_W = 900;
const VIEW_H = 120;
const PAD_X  = 60;
const LADEN_Y = 40;
const EMPTY_Y = 80;

const PHASE_COLOR = {
  laden:   'var(--bauxite-rust)',
  empty:   'var(--iron)',
  loading: 'var(--signal-amber)',
  offload: 'var(--charcoal)',
};

export default function ConvoyCorridorStrip({ convoys, lengthKm = 300 }) {
  if (!convoys?.length) return null;
  const kmToX = (km) => PAD_X + (km / lengthKm) * (VIEW_W - 2 * PAD_X);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="eyebrow">Corridor posture</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Top lane laden south · bottom lane empty north · ring = delayed
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Active convoys plotted along the corridor"
      >
        {/* lane rails */}
        <line x1={PAD_X} y1={LADEN_Y} x2={VIEW_W - PAD_X} y2={LADEN_Y} stroke="var(--border-hairline)" strokeWidth="1" />
        <line x1={PAD_X} y1={EMPTY_Y} x2={VIEW_W - PAD_X} y2={EMPTY_Y} stroke="var(--border-hairline)" strokeWidth="1" />

        {/* endpoint labels */}
        <text x={PAD_X - 6} y={LADEN_Y + 4} fontSize="10" textAnchor="end"
              fill="var(--text-tertiary)" fontFamily="var(--font-mono)" letterSpacing="0.04em">
          NYN
        </text>
        <text x={VIEW_W - PAD_X + 6} y={LADEN_Y + 4} fontSize="10" textAnchor="start"
              fill="var(--text-tertiary)" fontFamily="var(--font-mono)" letterSpacing="0.04em">
          TKD
        </text>
        <text x={PAD_X - 6} y={EMPTY_Y + 4} fontSize="10" textAnchor="end"
              fill="var(--text-tertiary)" fontFamily="var(--font-mono)" letterSpacing="0.04em">
          NYN
        </text>
        <text x={VIEW_W - PAD_X + 6} y={EMPTY_Y + 4} fontSize="10" textAnchor="start"
              fill="var(--text-tertiary)" fontFamily="var(--font-mono)" letterSpacing="0.04em">
          TKD
        </text>

        {/* convoy glyphs */}
        {convoys.map((c) => {
          const y = c.phase === 'empty' ? EMPTY_Y : LADEN_Y;
          const x = kmToX(Math.max(0, Math.min(lengthKm, c.km ?? 0)));
          const fill = PHASE_COLOR[c.phase] ?? 'var(--iron)';
          const radius = Math.min(14, 6 + Math.sqrt(c.trucks ?? 1) * 1.8);
          return (
            <g key={c.id} transform={`translate(${x.toFixed(1)} ${y})`}>
              <circle
                r={radius}
                fill={fill}
                fillOpacity={c.on_schedule ? 0.25 : 0.18}
                stroke={c.on_schedule ? fill : 'var(--bauxite-rust)'}
                strokeWidth={c.on_schedule ? 1.2 : 2}
              />
              <text
                textAnchor="middle"
                dy="0.35em"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="500"
                fill="var(--text)"
              >
                {c.trucks}
              </text>
              <text
                y={-radius - 6}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-mono)"
                letterSpacing="0.04em"
                fill="var(--text-tertiary)"
              >
                {c.id.replace('CVY-', '')}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
