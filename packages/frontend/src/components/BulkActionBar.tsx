import React from 'react';
import type { ReactNode } from 'react';
import SecondaryButton from './SecondaryButton';

// ──────────────────────────────────────────────────────────────────────────
// BulkActionBar — the "N selected · <actions> · Clear" strip that appears
// above a list once rows are ticked.
//
// The audit found this bar copy-pasted verbatim across list pages (Data
// Assets, People, Governance Issues, Business Glossary, …), each re-coding
// the same container chrome and action buttons with inline hex. Worse, the
// hardcoded palette was *blue* (`#eff6ff` / `#1e40af` / `#bfdbfe`) while the
// product's brand primary is teal (`var(--color-primary)` = #1a7a6d) — so
// the bars were quietly off-brand as well as duplicated.
//
// This component owns the container, the "N selected" count, and the Clear
// affordance (via the shared SecondaryButton); callers compose their own
// action controls as children, using <BulkActionButton> for consistent
// button styling or dropping in a raw <select> where they need one.
//
//   <BulkActionBar count={sel.count} onClear={sel.clear}>
//     <BulkActionButton onClick={() => bulkSetTier('GOLD')}>Set Gold</BulkActionButton>
//     <BulkActionButton variant="danger" onClick={confirmDelete}>Delete</BulkActionButton>
//   </BulkActionBar>
//
// Renders nothing when `count` is 0, so callers can mount it unconditionally.
// ──────────────────────────────────────────────────────────────────────────

interface BulkActionBarProps {
  /** Number of selected rows. The bar hides itself when this is 0. */
  count: number;
  /** Clears the selection (wired to the "Clear selection" button). */
  onClear: () => void;
  /** Action controls — <BulkActionButton>s and/or raw <select>s. */
  children?: ReactNode;
  /** Word rendered after the count. Default "selected". */
  label?: string;
  /** Label for the clear button. Default "Clear selection". */
  clearLabel?: string;
}

export default function BulkActionBar({
  count,
  onClear,
  children,
  label = 'selected',
  clearLabel = 'Clear selection',
}: BulkActionBarProps) {
  if (count <= 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 12px',
        marginBottom: 12,
        background: 'var(--color-primary-light)',
        border: '1px solid var(--color-primary)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
      }}
    >
      <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
        {count} {label}
      </span>
      {children}
      <span style={{ flex: 1 }} />
      <SecondaryButton onClick={onClear}>{clearLabel}</SecondaryButton>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// BulkActionButton — a consistently-styled action button for use inside a
// BulkActionBar. Three semantic variants map to intent, not colour:
//   primary — the emphasised action (e.g. "Move to org…")
//   neutral — ordinary actions (default)
//   danger  — destructive actions (e.g. "Delete selected")
// ──────────────────────────────────────────────────────────────────────────

type BulkActionVariant = 'primary' | 'neutral' | 'danger';

const VARIANT_STYLES: Record<BulkActionVariant, React.CSSProperties> = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: '1px solid var(--color-primary)' },
  neutral: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
  danger: { background: 'var(--color-surface)', color: 'var(--color-error)', border: '1px solid var(--color-error)' },
};

interface BulkActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BulkActionVariant;
}

export function BulkActionButton({
  variant = 'neutral',
  style,
  children,
  ...rest
}: BulkActionButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}
