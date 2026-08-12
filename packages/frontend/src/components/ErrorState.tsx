import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// ErrorState — the standard "couldn't load this" panel, the error-branch
// sibling of <EmptyState>. Data-fetching pages should render it when the
// primary fetch rejects, instead of failing silently, showing a raw toast
// and an empty table, or hand-rolling a one-off inline error string.
//
//   {error ? (
//     <ErrorState message={error} onRetry={fetchData} />
//   ) : loading ? (
//     <SkeletonRows … />
//   ) : rows.length === 0 ? (
//     <EmptyState … />
//   ) : (
//     <DataTable … />
//   )}
//
// Mirror <EmptyState>'s container so the two read as one family (same
// surface, border, radius, centred padding).
// ──────────────────────────────────────────────────────────────────────────

interface ErrorStateProps {
  /** Heading. Default "Couldn't load this". */
  title?: string;
  /** The error detail — an errorMessage(err) string is ideal. */
  message?: string | ReactNode;
  /** When provided, renders a Retry button wired to it (usually fetchData). */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra footer content (e.g. a support link). */
  children?: ReactNode;
}

export default function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  retryLabel = 'Retry',
  children,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        textAlign: 'center',
        padding: '3.5rem 1.5rem',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ marginBottom: 12, color: 'var(--color-error)', display: 'flex', justifyContent: 'center' }}>
        <AlertCircle size={32} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>{title}</h2>
      {message && (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', maxWidth: 440, margin: '0 auto 16px' }}>
          {message}
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '8px 18px', background: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          {retryLabel}
        </button>
      )}
      {children}
    </div>
  );
}
