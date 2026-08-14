import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import PageHeader from './PageHeader';

// ──────────────────────────────────────────────────────────────────────────
// EmbeddablePageHeader — a PageHeader that knows how to live inside a tabbed
// hub (Tabs / the Data Assets hub).
//
//   • Standalone  → renders a normal <PageHeader> (title + subtitle + actions
//                   + inline help), exactly as before.
//   • embedded    → the hub owns the page title and the tab strip, so the
//                   title/subtitle/help are suppressed and only the action
//                   toolbar is portaled onto the hub's tab-strip row
//                   (`actionsPortal`) — level with the tabs, not on a second
//                   line below them.
//
// This keeps every tabbed sub-page's header behaviour identical instead of
// each page hand-rolling the embedded/portal branch.
// ──────────────────────────────────────────────────────────────────────────

interface EmbeddablePageHeaderProps {
  /** True when rendered inside a hub that owns the title + tab strip. */
  embedded?: boolean;
  /** Tab-strip slot to portal the actions into when embedded. */
  actionsPortal?: HTMLElement | null;
  title: string;
  subtitle?: ReactNode;
  /** Right-aligned action cluster (buttons, menus). */
  actions?: ReactNode;
  /** Inline next to the title on the standalone header (e.g. HelpPopover). */
  children?: ReactNode;
}

export default function EmbeddablePageHeader({
  embedded = false,
  actionsPortal,
  title,
  subtitle,
  actions,
  children,
}: EmbeddablePageHeaderProps) {
  if (embedded) {
    // The hub renders the title + tabs; portal just the toolbar onto the
    // tab-strip row. Renders nothing until the slot mounts (or if the page
    // has no actions).
    if (!actions || !actionsPortal) return null;
    return createPortal(<>{actions}</>, actionsPortal);
  }

  return (
    <PageHeader title={title} subtitle={subtitle} actions={actions}>
      {children}
    </PageHeader>
  );
}
