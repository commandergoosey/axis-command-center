/*
 * AlertsSummary — Phase 13 triage strip.
 * Six tiles: open · critical · warning · snoozed · assigned to me · unassigned.
 * Tones map to severity so the eye lands on whatever the operator must act on.
 *
 * Phase 39: a seventh "Auto-cleared" tile appears when alertSynth has
 * suppressed at least one static alert because its lifecycle entity got
 * remediated (licence renewed, dispatcher coached, HSE incident closed).
 * The tile gives operators a magnitude signal without leaving the page —
 * the AutoClearedSection below the fold has the per-alert detail.
 */

export default function AlertsSummary({ summary }) {
  if (!summary) return null;
  const showAutoCleared = (summary.auto_cleared ?? 0) > 0;
  const cols = showAutoCleared ? 7 : 6;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 'var(--space-3)',
    }}>
      <Tile label="Open"            value={summary.open_total} />
      <Tile label="Critical"        value={summary.by_severity.CRITICAL} tone="rust"  />
      <Tile label="Warning"         value={summary.by_severity.WARNING}  tone="amber" />
      <Tile label="Snoozed"         value={summary.snoozed} />
      <Tile label="Assigned to me"  value={summary.assigned_to_me ?? 0} tone={summary.assigned_to_me > 0 ? 'iron' : undefined} />
      <Tile label="Unassigned"      value={summary.unassigned} tone={summary.unassigned > 0 ? 'amber' : undefined} />
      {showAutoCleared && (
        <Tile label="Auto-cleared"  value={summary.auto_cleared} tone="green" />
      )}
    </div>
  );
}

function Tile({ label, value, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
             : tone === 'amber' ? 'var(--signal-amber)'
             : tone === 'iron'  ? 'var(--iron)'
             : tone === 'green' ? 'var(--signal-green)'
             : 'var(--text)';
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div className="eyebrow">{label}</div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-stat-size)',
        lineHeight: 'var(--ts-stat-lh)',
        fontWeight: 'var(--fw-medium)',
        color,
        marginTop: 4,
      }}>
        {value}
      </div>
    </div>
  );
}
