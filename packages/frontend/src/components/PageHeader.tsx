import type { ReactNode } from 'react';
import CopyButton from './CopyButton';
import EditableTitle from './EditableTitle';

// ──────────────────────────────────────────────────────────────────────────
// PageHeader — the band at the top of every page. Establishes hierarchy
// (kicker → title → subtitle → meta row), keeps actions right-aligned,
// and separates the header from page content with a faint divider so
// the page reads as a clear "section break" rather than a floating title.
//
//   <PageHeader
//     kicker="Policy · POL-007"
//     title="Data Retention Policy"
//     subtitle="Defines how long each data class is retained."
//     meta={<StatusBadge variant="success">Active</StatusBadge>}
//     actions={<Button>Edit</Button>}
//   />
//
// `children` renders inline next to the title (legacy slot used for
// inline ? help-tips); `actions` is the right-aligned button cluster.
// ──────────────────────────────────────────────────────────────────────────

interface PageHeaderProps {
  /** Small uppercase muted eyebrow line above the title — useful for
   *  detail / drill-in pages (e.g., "Policy · POL-007"). Optional. */
  kicker?: ReactNode;
  title: string;
  /** Sentence describing the page. Accepts inline JSX (<em>, links, etc.). */
  subtitle?: ReactNode;
  /** Inline next to the H1 — used for HelpPopover (?) buttons etc. */
  children?: ReactNode;
  /** When set, a quiet copy button sits next to the title that copies this
   *  value (typically the entity id) — a "reference this thing" affordance
   *  for detail pages. Optional; list pages leave it unset. */
  copyId?: string;
  /** Tooltip/label for the copy button. Defaults to "Copy ID". */
  copyLabel?: string;
  /** When set, a quiet pencil sits next to the title that renames the entity
   *  in place. Pass only where the name is genuinely editable (a Procela-owned
   *  entity, not an IdP-sourced person). Optional. */
  onRename?: (name: string) => void | Promise<void>;
  /** Tooltip/label for the rename affordance. Defaults to "Rename". */
  renameLabel?: string;
  /** Right-aligned action cluster (buttons, menus). */
  actions?: ReactNode;
  /** Row below the subtitle for status chips, counts, badges, etc. */
  meta?: ReactNode;
}

export default function PageHeader({ kicker, title, subtitle, children, copyId, copyLabel, onRename, renameLabel, actions, meta }: PageHeaderProps) {
  return (
    <div
      className="procela-stack-on-mobile"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 16,
        marginBottom: '1rem',
        paddingBottom: 10,
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {kicker && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              marginBottom: 4,
            }}
          >
            {kicker}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <EditableTitle title={title} onRename={onRename} renameLabel={renameLabel} />
          {copyId && <CopyButton value={copyId} label={copyLabel} />}
          {children}
        </div>
        {subtitle && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4, marginBottom: 0, lineHeight: 1.5 }}>{subtitle}</p>
        )}
        {meta && <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{meta}</div>}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>{actions}</div>
      )}
    </div>
  );
}
