/*
 * EmptyState — one-line factual placeholder used on scaffold pages.
 * No illustrations. No exclamations. Copy in the register of §2 Voice.
 */

export default function EmptyState({ label, note }) {
  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-6) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <div
        className="micro"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Pending build
      </div>
      <div
        style={{
          fontSize: 'var(--ts-h3-size)',
          lineHeight: 'var(--ts-h3-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}
      >
        {label}
      </div>
      {note && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--ts-body-sm-size)',
            lineHeight: 'var(--ts-body-sm-lh)',
            color: 'var(--text-secondary)',
            maxWidth: '62ch',
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}
