import type { ReactNode } from 'react';
import CopyButton from './CopyButton';
import EditableTitle from './EditableTitle';
import HelpPopover from './HelpPopover';

// ──────────────────────────────────────────────────────────────────────────
// PageHeader — the band at the top of every page. Establishes hierarchy
// (kicker → title → meta row), keeps actions right-aligned, and separates
// the header from page content with a faint divider so the page reads as a
// clear "section break" rather than a floating title.
//
//   <PageHeader
//     kicker="Policy · POL-007"
//     title="Data Retention Policy"
//     subtitle="Defines how long each data class is retained."
//     meta={<StatusBadge variant="success">Active</StatusBadge>}
//     actions={<Button>Edit</Button>}
//   />
//
// A section/list page's `subtitle` is a boilerplate description of the page.
// Rather than sitting as a line under the title (which pushed content down on
// every page), it now rides behind a "?" next to the title — click to read
// it. A page that already passes its own "?" (children) keeps that instead.
// Detail / entity headers — those with a `kicker`, a copyable `copyId`, or an
// inline `onRename` — carry entity-specific text in the subtitle (a person's
// role, a group's charter), so there the subtitle stays visible as a line.
//
// `children` renders inline next to the title (the slot for a page's own "?"
// help-popover); `actions` is the right-aligned button cluster.
// ──────────────────────────────────────────────────────────────────────────

/** Stable slug for the per-page help-popover dismissal key. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'page';
}

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
  // Detail / entity headers keep the subtitle as a visible line (it's
  // entity content, not page boilerplate). Everywhere else the subtitle is a
  // page description that moves behind the title's "?". A page that already
  // supplies its own "?" (children) keeps it, so we only synthesize one from
  // the subtitle when there isn't one already.
  const isDetail = !!(kicker || copyId || onRename);
  const subtitleInline = !!subtitle && isDetail;
  const subtitleAsHelp = !!subtitle && !isDetail && !children;
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
          {subtitleAsHelp && (
            <HelpPopover id={`page-help:${slugify(title)}`} title={title}>{subtitle}</HelpPopover>
          )}
        </div>
        {subtitleInline && (
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
