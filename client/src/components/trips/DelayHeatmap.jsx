/*
 * DelayHeatmap — 7×24 grid of average departure-delay minutes.
 * Rows are days (Mon..Sun, Africa/Accra local), columns are hours 0–23.
 * Cell intensity ramps from Bone → Bauxite Rust. Null cells stay empty.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function DelayHeatmap({ grid }) {
  if (!grid?.length) return null;

  // Determine the ceiling across the whole grid for colour scaling.
  let ceiling = 0;
  grid.forEach((row) => row.forEach((v) => {
    if (v != null && v > ceiling) ceiling = v;
  }));
  ceiling = Math.max(ceiling, 30);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Delay pattern · 7×24</div>
        <div style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          marginTop: 2,
        }}>
          Avg departure delay in minutes · weighted by trip count in each slot
        </div>
      </header>

      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `56px repeat(24, minmax(18px, 1fr))`,
          gap: 2,
          minWidth: 560,
        }}>
          {/* Header row: hour labels */}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={`h-${h}`}
              className="mono"
              style={{
                fontSize: '9px',
                color: 'var(--text-tertiary)',
                textAlign: 'center',
                letterSpacing: '0.04em',
              }}
            >
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </div>
          ))}

          {/* Body rows */}
          {DAYS.map((day, d) => (
            <RowFragment key={day} day={day} cells={grid[d]} ceiling={ceiling} />
          ))}
        </div>
      </div>

      <Legend ceiling={ceiling} />
    </section>
  );
}

function RowFragment({ day, cells, ceiling }) {
  return (
    <>
      <div className="mono" style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        letterSpacing: '0.04em',
        alignSelf: 'center',
      }}>
        {day}
      </div>
      {Array.from({ length: 24 }, (_, h) => (
        <Cell key={h} value={cells?.[h]} ceiling={ceiling} />
      ))}
    </>
  );
}

function Cell({ value, ceiling }) {
  if (value == null) {
    return (
      <div style={{
        height: 18,
        background: 'var(--surface-sunk)',
        borderRadius: 2,
      }} />
    );
  }
  const t = Math.max(0, Math.min(1, value / ceiling));
  // Ramp the alpha of Bauxite Rust across transparent→full.
  const alpha = 0.12 + t * 0.82;
  return (
    <div
      title={`${value} min delay`}
      style={{
        height: 18,
        background: `rgba(162, 62, 35, ${alpha.toFixed(2)})`,
        borderRadius: 2,
      }}
    />
  );
}

function Legend({ ceiling }) {
  const stops = [0, 0.25, 0.5, 0.75, 1.0];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      marginTop: 'var(--space-3)',
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--border-hairline)',
    }}>
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        0 min
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        {stops.map((s) => (
          <div key={s} style={{
            width: 20,
            height: 10,
            borderRadius: 2,
            background: `rgba(162, 62, 35, ${(0.12 + s * 0.82).toFixed(2)})`,
          }} />
        ))}
      </div>
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        {ceiling}+ min
      </span>
    </div>
  );
}
