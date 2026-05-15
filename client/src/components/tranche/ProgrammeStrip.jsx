/*
 * ProgrammeStrip — four-tile summary of the total capital programme.
 * Totals come straight from the business plan: 550 trucks, $90M CAPEX,
 * 5.0 Mtpa at steady state, 70/30 debt/equity split.
 */

import ModelledTag from '../primitives/ModelledTag';

export default function ProgrammeStrip({ programme, capital }) {
  if (!programme || !capital) return null;
  const totalDrawn = capital.debt_drawn_usd + capital.equity_drawn_usd;
  const totalCommitted = capital.debt_committed_usd + capital.equity_committed_usd;
  const drawnPct = totalCommitted > 0 ? (totalDrawn / totalCommitted) * 100 : 0;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile
        eyebrow="Total CAPEX"
        value={`$${(programme.total_capex_usd / 1_000_000).toFixed(0)}M`}
        sub={`${programme.total_trucks} trucks at 5.0 Mtpa`}
      />
      <Tile
        eyebrow="Drawn to date"
        value={`$${(totalDrawn / 1_000_000).toFixed(1)}M`}
        sub={`${drawnPct.toFixed(1)}% of committed`}
      />
      <Tile
        eyebrow="Debt / equity"
        value={`${((capital.debt_committed_usd / totalCommitted) * 100).toFixed(0)} / ${((capital.equity_committed_usd / totalCommitted) * 100).toFixed(0)}`}
        sub="Committed structure"
      />
      <Tile
        eyebrow="DSCR targets"
        value={`${capital.dscr_target.toFixed(1)}× min`}
        sub={`${capital.dscr_steady_state.toFixed(1)}× at Year 5 steady state`}
      />
    </div>
  );
}

function Tile({ eyebrow, value, sub }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="eyebrow">{eyebrow}</span>
        <ModelledTag />
      </div>
      <div style={{
        fontSize: 'var(--ts-stat-size)',
        lineHeight: 'var(--ts-stat-lh)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        marginTop: 4,
      }}>
        {sub}
      </div>
    </div>
  );
}
