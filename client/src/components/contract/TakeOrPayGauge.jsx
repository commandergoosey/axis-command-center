/*
 * TakeOrPayGauge — semi-arc gauge showing delivered vs the 80% floor and
 * 100% contracted line for the current month. Below floor → Bauxite Rust
 * pointer; above floor → Iron; above contracted → Signal Green.
 *
 * The arc sweeps 180° from left (0 t) to right (contracted × 1.15 ceiling).
 */

import ModelledTag from '../primitives/ModelledTag';

const W = 360;
const H = 200;
const CX = W / 2;
const CY = 170;
const R  = 140;

function polar(frac) {
  // frac 0..1 maps to 180°..0° (left arc to right arc), reading clockwise.
  const theta = Math.PI * (1 - frac);
  return { x: CX + R * Math.cos(theta), y: CY - R * Math.sin(theta) };
}

function arcPath(fromFrac, toFrac) {
  const a = polar(fromFrac);
  const b = polar(toFrac);
  const large = Math.abs(toFrac - fromFrac) > 0.5 ? 1 : 0;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export default function TakeOrPayGauge({ mtd }) {
  if (!mtd) return null;

  const contracted = mtd.contracted_tonnes;
  const floor      = mtd.floor_tonnes;
  const delivered  = mtd.delivered_tonnes;
  const ceiling    = Math.max(contracted * 1.15, delivered * 1.1, 1);

  const floorFrac     = Math.min(1, floor / ceiling);
  const contractFrac  = Math.min(1, contracted / ceiling);
  const deliveredFrac = Math.min(1, Math.max(0, delivered / ceiling));

  const pointerColor = !mtd.on_track
    ? 'var(--bauxite-rust)'
    : delivered >= contracted
      ? 'var(--signal-green)'
      : 'var(--iron)';

  const pointer = polar(deliveredFrac);
  const floorMark    = polar(floorFrac);
  const contractMark = polar(contractFrac);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="eyebrow">Take-or-pay posture · month-to-date</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Delivered tonnage vs the 80% contract floor. GIBDLC bills the greater of actual or floor.
          </div>
        </div>
        <ModelledTag />
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: W, maxWidth: '100%', height: 'auto', flex: '0 0 auto' }}
          role="img"
          aria-label="Take or pay gauge"
        >
          {/* track (full arc) */}
          <path
            d={arcPath(0, 1)}
            fill="none"
            stroke="var(--surface-sunk)"
            strokeWidth="16"
            strokeLinecap="butt"
          />
          {/* below-floor band — Bauxite Rust tint */}
          <path
            d={arcPath(0, floorFrac)}
            fill="none"
            stroke="rgba(162, 62, 35, 0.28)"
            strokeWidth="16"
          />
          {/* floor → contracted band — Iron */}
          <path
            d={arcPath(floorFrac, contractFrac)}
            fill="none"
            stroke="var(--ash)"
            strokeWidth="16"
          />
          {/* contracted → ceiling band — lighter ash */}
          <path
            d={arcPath(contractFrac, 1)}
            fill="none"
            stroke="rgba(140, 140, 140, 0.15)"
            strokeWidth="16"
          />

          {/* floor tick */}
          <line
            x1={CX + (R - 14) * Math.cos(Math.PI * (1 - floorFrac))}
            y1={CY - (R - 14) * Math.sin(Math.PI * (1 - floorFrac))}
            x2={floorMark.x}
            y2={floorMark.y}
            stroke="var(--bauxite-rust)"
            strokeWidth="2"
          />
          <text
            x={floorMark.x}
            y={floorMark.y - 18}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--bauxite-rust)"
            letterSpacing="0.04em"
          >
            FLOOR 80%
          </text>

          {/* contracted tick */}
          <line
            x1={CX + (R - 14) * Math.cos(Math.PI * (1 - contractFrac))}
            y1={CY - (R - 14) * Math.sin(Math.PI * (1 - contractFrac))}
            x2={contractMark.x}
            y2={contractMark.y}
            stroke="var(--charcoal)"
            strokeWidth="2"
          />
          <text
            x={contractMark.x}
            y={contractMark.y - 18}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--charcoal)"
            letterSpacing="0.04em"
          >
            CONTRACTED
          </text>

          {/* pointer */}
          <line
            x1={CX}
            y1={CY}
            x2={pointer.x}
            y2={pointer.y}
            stroke={pointerColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={7} fill={pointerColor} />
        </svg>

        <ReadoutStack mtd={mtd} />
      </div>
    </section>
  );
}

function ReadoutStack({ mtd }) {
  const cushion = mtd.cushion_tonnes;
  const cushionColor = cushion >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 200 }}>
      {/* Phase 117 — LIVE badge on delivered MTD when backed by real convoy data */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>Delivered MTD</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {mtd.has_live_data ? (
            <span className="mono" style={{
              fontSize: 8, padding: '2px 5px',
              background: 'rgba(38,160,100,0.08)',
              border: '1px solid rgba(38,160,100,0.28)',
              borderRadius: 2, color: 'var(--signal-green)',
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>LIVE</span>
          ) : (
            <span className="mono" style={{
              fontSize: 8, padding: '2px 5px',
              border: '1px solid var(--border-soft)',
              borderRadius: 2, color: 'var(--text-tertiary)',
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>MODELLED</span>
          )}
          <span className="tabular" style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text)' }}>
            {mtd.delivered_tonnes.toLocaleString()} t
          </span>
        </span>
      </div>
      <Readout label="Floor (80%)"    value={`${mtd.floor_tonnes.toLocaleString()} t`} />
      <Readout label="Contracted MTD" value={`${mtd.contracted_tonnes.toLocaleString()} t`} />
      <Readout
        label={cushion >= 0 ? 'Cushion' : 'Deficit'}
        value={`${cushion >= 0 ? '+' : ''}${cushion.toLocaleString()} t`}
        valueColor={cushionColor}
      />
      <div style={{
        marginTop: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: mtd.on_track ? 'rgba(46, 107, 63, 0.10)' : 'rgba(162, 62, 35, 0.10)',
        color: mtd.on_track ? 'var(--signal-green)' : 'var(--bauxite-rust)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--ts-caption-size)',
        fontWeight: 'var(--fw-medium)',
        letterSpacing: '0.02em',
      }}>
        {mtd.on_track ? 'On track to clear the floor.' : 'Below floor — take-or-pay clause engaged.'}
      </div>
    </div>
  );
}

function Readout({ label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
      <span className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-size)',
        color: valueColor ?? 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </span>
    </div>
  );
}
