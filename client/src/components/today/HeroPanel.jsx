/*
 * HeroPanel — Charcoal briefing strip at the top of Today.
 * Reads snapshot.corridor for the three hero figures. Every modelled number
 * carries the MODELLED micro-tag (per BRIEF.md §12.4).
 */

import { formatLongDate } from '../../lib/format';

const HEALTH_COLOR = {
  green: '#4ade80',   // bright enough to read on Charcoal
  amber: '#fbbf24',
  rust:  '#f87171',
};

export default function HeroPanel({ corridor, health }) {
  const tonnesMtd    = corridor?.tonnes_delivered_mtd ?? 0;
  const activeTrucks = corridor?.active_trucks_today ?? 0;
  const slaPct       = corridor?.sla_attainment_pct   ?? 0;

  return (
    <section
      style={{
        background: 'var(--charcoal)',
        color: 'var(--bone)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="eyebrow" style={{ color: 'var(--bauxite-rust)' }}>
          Corridor briefing
        </div>
        <div
          style={{
            fontSize: 'var(--ts-h1-size)',
            lineHeight: 'var(--ts-h1-lh)',
            fontWeight: 'var(--fw-medium)',
            letterSpacing: 'var(--ts-h1-tracking)',
          }}
        >
          {formatLongDate()}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            color: 'rgba(245, 241, 236, 0.45)',
            textTransform: 'uppercase',
          }}
        >
          Nyinahin · Takoradi · 300 km · GIBDLC offtake
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid rgba(245, 241, 236, 0.1)',
        }}
      >
        <HeroStat
          label="Tonnes delivered MTD"
          value={new Intl.NumberFormat('en-GB').format(tonnesMtd)}
          unit="t"
          modelled
        />
        <Divider />
        <HeroStat label="Active trucks today" value={activeTrucks} modelled />
        <Divider />
        <HeroStat label="SLA attainment" value={slaPct.toFixed(1)} unit="%" modelled />
        {health && (
          <>
            <Divider />
            <HealthScore health={health} />
          </>
        )}
      </div>
    </section>
  );
}

/* ── Phase 131: Corridor health score ──────────────────────────────── */
function HealthScore({ health }) {
  const color  = HEALTH_COLOR[health.color] ?? HEALTH_COLOR.amber;
  const arcPct = (health.score / health.max) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      {/* Score + arc progress */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          className="tabular"
          style={{
            fontFamily: 'var(--font-primary)',
            fontWeight: 'var(--fw-black)',
            fontSize: 'var(--ts-display-size)',
            lineHeight: 1,
            letterSpacing: 'var(--ts-display-tracking)',
            color,
          }}
        >
          {health.score}
        </span>
        <span className="mono" style={{ fontSize: 14, opacity: 0.55, color: 'var(--bone)' }}>/100</span>
      </div>
      {/* Thin progress bar */}
      <div style={{ height: 3, background: 'rgba(245,241,236,0.1)', borderRadius: 2, overflow: 'hidden', width: 80 }}>
        <div style={{ height: '100%', width: `${arcPct}%`, background: color, borderRadius: 2, transition: 'width 600ms ease' }} />
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'rgba(245, 241, 236, 0.55)',
      }}>
        <span>Corridor health</span>
        <span className="mono" style={{ fontSize: 9, padding: '2px 6px', border: `1px solid ${color}40`, color }}>
          {health.verdict}
        </span>
      </div>
    </div>
  );
}

function HeroStat({ label, value, unit, modelled }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, color: 'var(--bone)' }}>
        <span
          className="tabular"
          style={{
            fontFamily: 'var(--font-primary)',
            fontWeight: 'var(--fw-black)',
            fontSize: 'var(--ts-display-size)',
            lineHeight: 1,
            letterSpacing: 'var(--ts-display-tracking)',
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="mono" style={{ fontSize: 14, opacity: 0.55, letterSpacing: '0.02em' }}>
            {unit}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 'var(--ts-micro-size)',
          letterSpacing: 'var(--ts-micro-tracking)',
          textTransform: 'uppercase',
          color: 'rgba(245, 241, 236, 0.55)',
        }}
      >
        <span>{label}</span>
        {modelled && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              padding: '2px 6px',
              border: '1px solid rgba(245, 241, 236, 0.18)',
              letterSpacing: '0.14em',
              color: 'rgba(245, 241, 236, 0.7)',
            }}
          >
            MODELLED
          </span>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, background: 'rgba(245, 241, 236, 0.1)' }} aria-hidden="true" />;
}
