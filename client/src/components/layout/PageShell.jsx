/*
 * PageShell — standard page frame with eyebrow, H1, and content slot.
 * Use on every page except Today (which has its own briefing-header composition).
 */

export default function PageShell({ eyebrow, title, description, actions, children }) {
  return (
    <div style={{ padding: 'var(--content-pad)', animation: 'fade-in 180ms ease-out' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
          paddingBottom: 'var(--space-4)',
          borderBottom: '1px solid var(--border-hairline)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          {eyebrow && (
            <div
              className="eyebrow"
              style={{ marginBottom: 'var(--space-2)' }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--ts-h1-size)',
              lineHeight: 'var(--ts-h1-lh)',
              fontWeight: 'var(--fw-medium)',
              letterSpacing: 'var(--ts-h1-tracking)',
              color: 'var(--text)',
            }}
          >
            {title}
          </h1>
          {description && (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 'var(--ts-body-size)',
                lineHeight: 'var(--ts-body-lh)',
                color: 'var(--text-secondary)',
                maxWidth: '62ch',
              }}
            >
              {description}
            </p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 'var(--space-2)' }}>{actions}</div>}
      </header>
      <main>{children}</main>
    </div>
  );
}
