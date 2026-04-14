import type { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// EmptyState — the standard "no data yet" panel. Replaces the random
// `<p>No X yet.</p>` strings sprinkled through pages with something that
// actually tells users what the page is for and how to start.
//
//   <EmptyState
//     title="No data assets yet"
//     description="Data assets are the business-meaningful pieces of data your processes depend on."
//     action={{ label: 'Add Data Asset', onClick: openAdd }}
//     secondaryAction={{ label: 'Import CSV', onClick: openImport }}
//   />
// ──────────────────────────────────────────────────────────────────────────

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

interface EmptyStateProps {
  icon?: string;                     // optional unicode glyph
  title: string;
  description?: string | ReactNode;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  children?: ReactNode;              // extra footer content (e.g. learn-more link)
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 18px',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 18px',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

export default function EmptyState({ icon, title, description, action, secondaryAction, children }: EmptyStateProps) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '3.5rem 1.5rem',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
    }}>
      {icon && (
        <div style={{ fontSize: 36, marginBottom: 12, color: 'var(--color-text-muted)' }}>
          {icon}
        </div>
      )}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>
        {title}
      </h2>
      {description && (
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: action || secondaryAction ? 18 : 0, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
          {description}
        </div>
      )}
      {(action || secondaryAction) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {action && (
            <button
              onClick={action.onClick}
              style={action.variant === 'secondary' ? btnSecondary : btnPrimary}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              style={secondaryAction.variant === 'primary' ? btnPrimary : btnSecondary}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}
