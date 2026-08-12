import type { ReactNode } from 'react';
import Button from './Button';

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
  // Either a Unicode glyph (legacy) or a React node (e.g. a Lucide
  // icon element). Rendered inside a centred 36px container.
  icon?: ReactNode;
  title: string;
  description?: string | ReactNode;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  children?: ReactNode;              // extra footer content (e.g. learn-more link)
}

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
            <Button
              variant={action.variant === 'secondary' ? 'secondary' : 'primary'}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant={secondaryAction.variant === 'primary' ? 'primary' : 'secondary'}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}
