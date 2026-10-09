import type { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// ListToolbar — the shared header action cluster for entity-list pages.
//
// Every list page used to hand-assemble its own `<>…</>` of SavedViewsMenu /
// ExportMenu / ColumnPicker / import / add buttons inside `<PageHeader
// actions={…}>`. Because nothing owned the composition, the affordance SET
// and the ORDER drifted page to page (Views on some, Columns on others, the
// Add button sometimes before the utilities, sometimes after). This wraps the
// cluster so the ordering and spacing are defined in one place and new pages
// adopt the convention instead of re-deriving it.
//
// It owns ORDER and SPACING only — never which affordances a page has. The
// caller passes the controls it supports into named slots (any slot omitted
// simply isn't rendered); ListToolbar lays them out left→right in the canonical
// sequence and separates the primary action (the "+ Add" button) with a thin
// divider so the main call-to-action always reads as distinct from the
// secondary utilities.
//
// Canonical order (left → right, right-aligned in the header):
//   [view] [views] [import] [export] [columns] [share] [extra] │ [primary]
//
// `view` leads the cluster — a page-level view switch (the "eye" that opens a
// visualization/alternate view of the whole list). It anchors the far left so
// the way you *look at* the list sits apart from the utilities that act on it.
// Then the standard utilities in a fixed block, then `extra` — the slot for
// other page-specific secondary actions (an AI-generate wand, a "connect to
// source" button, a print button). Pass a fragment if a page has more than one.
// ──────────────────────────────────────────────────────────────────────────

interface ListToolbarProps {
  /** Leading page-level view switch — the "eye"/visualize affordance that
   *  opens an alternate view of the whole list. Anchors the far left. */
  view?: ReactNode;
  /** Saved-views menu (SavedViewsMenu). */
  views?: ReactNode;
  /** Page-specific secondary actions (AI generate, print, …). */
  extra?: ReactNode;
  /** Bulk-import trigger (present only where the entity has an import path). */
  import?: ReactNode;
  /** ExportMenu. */
  export?: ReactNode;
  /** Column-visibility picker (ColumnPicker). */
  columns?: ReactNode;
  /** Copy-link / share affordance. */
  share?: ReactNode;
  /** The primary call-to-action — almost always the "+ Add" button. Split
   *  from the secondaries by a divider so it always reads as the main action. */
  primary?: ReactNode;
}

export default function ListToolbar({
  view,
  views,
  extra,
  import: imp,
  export: exp,
  columns,
  share,
  primary,
}: ListToolbarProps) {
  const secondaries = [view, views, imp, exp, columns, share, extra].filter(Boolean);
  const hasSecondary = secondaries.length > 0;
  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {view}
      {views}
      {imp}
      {exp}
      {columns}
      {share}
      {extra}
      {hasSecondary && primary && (
        <span
          aria-hidden="true"
          style={{
            width: 1,
            alignSelf: 'stretch',
            minHeight: 20,
            background: 'var(--color-border)',
            margin: '0 2px',
          }}
        />
      )}
      {primary}
    </div>
  );
}
