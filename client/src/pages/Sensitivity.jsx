/*
 * Sensitivity — Phase 75.
 *
 * FX & cost sensitivity calculator. Three sliders move the
 * inputs (cedi/USD shift, diesel price shift, opex inflation),
 * the server recomputes DSCR + EBITDA + revenue + tariff effective
 * rate end-to-end, and the page renders a side-by-side
 * baseline/scenario comparison with delta tiles up top.
 *
 * Pure compute, no writes. All authenticated roles can read —
 * the calculator is the kind of stress-test surface lenders
 * specifically want.
 *
 * Mounted at /sensitivity. Sidebar entry under Capital alongside
 * Financials and Risks.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, RotateCcw,
  AlertTriangle, ArrowRight,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import DSCRWaterfall from '../components/sensitivity/DSCRWaterfall';

const VERDICT_TONE = {
  PASS:   'var(--signal-green)',
  WATCH:  'var(--signal-amber)',
  BREACH: 'var(--bauxite-rust)',
};

export default function Sensitivity() {
  const [inputs, setInputs] = useState({ cedi_pct: 0, diesel_pct: 0, opex_pct: 0 });
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      cedi_pct:   String(inputs.cedi_pct),
      diesel_pct: String(inputs.diesel_pct),
      opex_pct:   String(inputs.opex_pct),
    });
    authFetch(`/api/sensitivity?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [inputs]);

  useEffect(() => { load(); }, [load]);

  const setField = (k, v) => setInputs((s) => ({ ...s, [k]: Number(v) }));
  const reset = () => setInputs({ cedi_pct: 0, diesel_pct: 0, opex_pct: 0 });
  const applyPreset = (p) => setInputs({
    cedi_pct: p.cedi_pct, diesel_pct: p.diesel_pct, opex_pct: p.opex_pct,
  });

  return (
    <PageShell
      eyebrow="Capital"
      title="FX & cost sensitivity"
      description="Quantitative stress-test for the corridor's FX exposure. Move cedi/USD, diesel, or opex inputs and watch DSCR, EBITDA, and tariff effective rate respond live. The corridor's tariff is USD-denominated; ~63% of opex is GHS — this is where the margin equation lives."
      actions={
        <button
          type="button"
          onClick={reset}
          disabled={inputs.cedi_pct === 0 && inputs.diesel_pct === 0 && inputs.opex_pct === 0}
          style={resetBtnStyle}
        >
          <RotateCcw size={11} strokeWidth={1.6} />
          Reset to baseline
        </button>
      }
    >
      {error && (
        <div style={errorBoxStyle}>
          Sensitivity feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {data && <PresetRow presets={data.presets} inputs={inputs} onApply={applyPreset} />}
        <SliderRow inputs={inputs} bounds={data?.bounds} setField={setField} />
        {data && <DeltaTiles deltas={data.deltas} baseline={data.baseline} scenario={data.scenario} />}
        {data && <DSCRWaterfall waterfall={data.waterfall} targetMin={data.baseline?.target_min} />}
        {data && <ComparisonGrid baseline={data.baseline} scenario={data.scenario} />}
        {data && <ShowYourWork inputs={inputs} baseline={data.baseline} scenario={data.scenario} />}
      </div>
    </PageShell>
  );
}

// ── Presets ───────────────────────────────────────────────────────

function PresetRow({ presets, inputs, onApply }) {
  return (
    <div style={{
      display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>PRESETS</span>
      {presets.map((p) => {
        const active = inputs.cedi_pct   === p.cedi_pct
                    && inputs.diesel_pct === p.diesel_pct
                    && inputs.opex_pct   === p.opex_pct;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onApply(p)}
            title={p.description}
            style={{
              padding: '4px 12px',
              background: active ? 'var(--accent-tint)' : 'transparent',
              border: `1px solid ${active ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
              borderRadius: 999,
              fontSize: 'var(--ts-caption-size)',
              color: active ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              fontWeight: active ? 'var(--fw-medium)' : 'normal',
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Sliders ───────────────────────────────────────────────────────

function SliderRow({ inputs, bounds, setField }) {
  const sliders = [
    {
      key:   'cedi_pct',
      label: 'Cedi vs USD',
      help:  'Negative = cedi weakens (more GHS per USD). A weaker cedi raises the GHS diesel reading, which flows through fuel-indexation to a higher effective tariff.',
      bounds: bounds?.cedi_pct   || { min: -25, max: 25 },
    },
    {
      key:   'diesel_pct',
      label: 'Diesel price',
      help:  'Direct shift on the NPA diesel reading. Flows through fuel-indexation alongside the cedi shift.',
      bounds: bounds?.diesel_pct || { min: -30, max: 50 },
    },
    {
      key:   'opex_pct',
      label: 'Opex inflation',
      help:  'Across-the-board opex inflation. Wages + non-fuel local costs. Erodes EBITDA without affecting tariff.',
      bounds: bounds?.opex_pct   || { min: -10, max: 30 },
    },
  ];
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
      display: 'flex', flexDirection: 'column',
      gap: 'var(--space-4)',
    }}>
      {sliders.map((s) => (
        <Slider
          key={s.key}
          {...s}
          value={inputs[s.key]}
          onChange={(v) => setField(s.key, v)}
        />
      ))}
    </div>
  );
}

function Slider({ label, help, value, bounds, onChange }) {
  const sign = value > 0 ? '+' : '';
  const tone = value > 0 ? 'var(--bauxite-rust)' : value < 0 ? 'var(--bauxite-rust)' : 'var(--text-tertiary)';
  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 4,
      }}>
        <div>
          <span style={{
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {label}
          </span>
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            marginTop: 2,
            maxWidth: 600,
            lineHeight: 1.4,
          }}>
            {help}
          </div>
        </div>
        <span className="tabular" style={{
          minWidth: 60,
          textAlign: 'right',
          fontWeight: 'var(--fw-medium)',
          fontSize: 16,
          color: value === 0 ? 'var(--text-tertiary)' : tone,
        }}>
          {sign}{value}%
        </span>
      </div>
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%' }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
        marginTop: 2,
      }}>
        <span>{bounds.min}%</span>
        <span>0%</span>
        <span>+{bounds.max}%</span>
      </div>
    </div>
  );
}

// ── Delta tiles ───────────────────────────────────────────────────

function DeltaTiles({ deltas, baseline, scenario }) {
  const dscrIcon = deltas.dscr > 0 ? TrendingUp : deltas.dscr < 0 ? TrendingDown : Minus;
  const ebitdaIcon = deltas.ebitda_usd > 0 ? TrendingUp : deltas.ebitda_usd < 0 ? TrendingDown : Minus;
  const tariffIcon = deltas.tariff_effective > 0 ? TrendingUp : deltas.tariff_effective < 0 ? TrendingDown : Minus;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <DeltaTile
        label="DSCR shift"
        baseline={`${baseline.current.toFixed(2)}×`}
        scenario={`${scenario.current.toFixed(2)}×`}
        delta={deltas.dscr === 0 ? '0.00×' : `${deltas.dscr > 0 ? '+' : ''}${deltas.dscr.toFixed(2)}×`}
        Icon={dscrIcon}
        tone={deltas.dscr > 0 ? 'green' : deltas.dscr < 0 ? 'rust' : 'tertiary'}
        verdict={scenario.verdict}
        verdictChange={deltas.verdict_changed ? `was ${baseline.verdict}` : null}
      />
      <DeltaTile
        label="EBITDA shift (this month)"
        baseline={`$${(baseline.ebitda_usd / 1000).toFixed(0)}k`}
        scenario={`$${(scenario.ebitda_usd / 1000).toFixed(0)}k`}
        delta={deltas.ebitda_usd === 0 ? '$0' : `${deltas.ebitda_usd > 0 ? '+' : '-'}$${Math.abs(Math.round(deltas.ebitda_usd / 1000))}k`}
        Icon={ebitdaIcon}
        tone={deltas.ebitda_usd > 0 ? 'green' : deltas.ebitda_usd < 0 ? 'rust' : 'tertiary'}
      />
      <DeltaTile
        label="Effective tariff shift"
        baseline={`$${baseline.tariff_effective.toFixed(2)}/t`}
        scenario={`$${scenario.tariff_effective.toFixed(2)}/t`}
        delta={deltas.tariff_effective === 0 ? '$0.00' : `${deltas.tariff_effective > 0 ? '+' : ''}$${deltas.tariff_effective.toFixed(2)}`}
        Icon={tariffIcon}
        tone={deltas.tariff_effective > 0 ? 'green' : deltas.tariff_effective < 0 ? 'rust' : 'tertiary'}
        sub={scenario.tariff?.clamped_at_cap ? 'clamped at indexation cap' : scenario.tariff?.clamped_at_floor ? 'clamped at indexation floor' : null}
      />
    </div>
  );
}

function DeltaTile({ label, baseline, scenario, delta, Icon, tone, verdict, verdictChange, sub }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 6,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          {label.toUpperCase()}
        </span>
        <Icon size={14} strokeWidth={1.6} color={color} />
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
        color, lineHeight: 1.05,
      }}>
        {delta}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span className="tabular">baseline {baseline}</span>
        <ArrowRight size={10} strokeWidth={1.6} style={{ alignSelf: 'center', opacity: 0.5 }} />
        <span className="tabular" style={{ color: 'var(--text-secondary)' }}>scenario {scenario}</span>
      </div>
      {(verdict || sub) && (
        <div style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px dashed var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
        }}>
          {verdict && (
            <span style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: `color-mix(in srgb, ${VERDICT_TONE[verdict]} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${VERDICT_TONE[verdict]} 30%, transparent)`,
              color: VERDICT_TONE[verdict],
              fontWeight: 'var(--fw-medium)',
              letterSpacing: '0.06em',
            }}>
              {verdict}
            </span>
          )}
          {verdictChange && (
            <span style={{ color: 'var(--bauxite-rust)' }}>{verdictChange}</span>
          )}
          {sub && !verdictChange && (
            <span style={{ color: 'var(--signal-amber)' }}>{sub}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Side-by-side comparison ───────────────────────────────────────

function ComparisonGrid({ baseline, scenario }) {
  const rows = [
    { label: 'Effective tariff',     b: `$${baseline.tariff_effective.toFixed(2)}/t`, s: `$${scenario.tariff_effective.toFixed(2)}/t` },
    { label: 'Projected tonnes',     b: baseline.projected_tonnes.toLocaleString(),   s: scenario.projected_tonnes.toLocaleString() },
    { label: 'Projected revenue',    b: `$${baseline.revenue_usd.toLocaleString()}`,  s: `$${scenario.revenue_usd.toLocaleString()}` },
    { label: 'Opex ratio',           b: `${baseline.opex_ratio_pct.toFixed(1)}%`,     s: `${scenario.opex_ratio_pct.toFixed(1)}%` },
    { label: 'Operating costs',      b: `$${baseline.opex_usd.toLocaleString()}`,     s: `$${scenario.opex_usd.toLocaleString()}` },
    { label: 'EBITDA (this month)',  b: `$${baseline.ebitda_usd.toLocaleString()}`,   s: `$${scenario.ebitda_usd.toLocaleString()}` },
    { label: 'Monthly debt service', b: `$${baseline.debt_service_usd.toLocaleString()}`, s: `$${scenario.debt_service_usd.toLocaleString()}` },
    { label: 'DSCR (this month)',    b: `${baseline.this_month_dscr.toFixed(2)}×`,    s: `${scenario.this_month_dscr.toFixed(2)}×` },
    { label: 'DSCR (trailing 3M)',   b: `${baseline.current.toFixed(2)}×`,            s: `${scenario.current.toFixed(2)}×` },
    { label: 'Headroom vs floor',    b: `${baseline.headroom_pct.toFixed(1)}%`,       s: `${scenario.headroom_pct.toFixed(1)}%` },
  ];
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface)' }}>
            <th style={th}>Metric</th>
            <th style={{ ...th, textAlign: 'right' }}>Baseline</th>
            <th style={{ ...th, textAlign: 'right' }}>Scenario</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border-hairline)' : 'none' }}>
              <td style={td}>{r.label}</td>
              <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.b}</td>
              <td style={{ ...td, textAlign: 'right', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 'var(--fw-medium)' }}>{r.s}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Show your work ────────────────────────────────────────────────

function ShowYourWork({ inputs, baseline, scenario }) {
  const noShift = inputs.cedi_pct === 0 && inputs.diesel_pct === 0 && inputs.opex_pct === 0;
  return (
    <div style={{
      padding: 'var(--space-4) var(--space-5)',
      background: 'var(--surface)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <AlertTriangle size={12} strokeWidth={1.6} color="var(--text-tertiary)" />
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>SHOW YOUR WORK</span>
      </div>
      {noShift ? (
        <p style={{ margin: 0 }}>
          No shifts applied — scenario equals baseline. Move a slider or pick a preset to see the corridor's response.
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          With cedi <strong>{fmtPct(inputs.cedi_pct)}</strong>, diesel <strong>{fmtPct(inputs.diesel_pct)}</strong>, and opex <strong>{fmtPct(inputs.opex_pct)}</strong>:
          {' '}fuel-indexation moves effective tariff from{' '}
          <strong>${baseline.tariff_effective.toFixed(2)}</strong> to{' '}
          <strong>${scenario.tariff_effective.toFixed(2)}</strong> per tonne, with opex ratio shifting from{' '}
          <strong>{baseline.opex_ratio_pct.toFixed(1)}%</strong> to{' '}
          <strong>{scenario.opex_ratio_pct.toFixed(1)}%</strong>.
          Holding tonnes at <strong>{baseline.projected_tonnes.toLocaleString()}</strong>, EBITDA moves{' '}
          <strong>{fmtUsd(scenario.ebitda_usd - baseline.ebitda_usd)}</strong>, and DSCR settles at{' '}
          <strong>{scenario.current.toFixed(2)}×</strong> against the {baseline.target_min.toFixed(2)}× floor.
        </p>
      )}
    </div>
  );
}

function fmtPct(n) {
  if (n === 0) return '0%';
  return (n > 0 ? '+' : '') + n + '%';
}
function fmtUsd(n) {
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs}`;
}

const th = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  fontWeight: 500,
};
const td = {
  padding: '10px',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  lineHeight: 1.4,
};
const resetBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};
const errorBoxStyle = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
  marginBottom: 'var(--space-4)',
};
