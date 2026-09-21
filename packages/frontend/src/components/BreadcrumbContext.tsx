import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// BreadcrumbContext — lets a routed detail page register the human-readable
// name of the entity it's showing, so the global <Breadcrumbs> trail can end
// on that name (e.g. "Dashboard › People › Ada Lovelace") instead of dropping
// the last path segment (which on a detail route is a raw id/slug).
//
// A detail page calls `useBreadcrumbLeaf(entity?.name)` near the top of its
// component. The hook writes the label on mount / when it changes and clears
// it on unmount, so:
//   • while the entity is still loading (label undefined) the trail shows just
//     the ancestor links, exactly as before;
//   • once the name resolves it becomes the current (non-link) crumb;
//   • navigating away clears it, so a list page never inherits a stale leaf.
// ──────────────────────────────────────────────────────────────────────────

interface BreadcrumbCtx {
  leaf: string | null;
  setLeaf: (label: string | null) => void;
}

const Ctx = createContext<BreadcrumbCtx>({ leaf: null, setLeaf: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [leaf, setLeaf] = useState<string | null>(null);
  return <Ctx.Provider value={{ leaf, setLeaf }}>{children}</Ctx.Provider>;
}

/**
 * Register the current page's leaf breadcrumb. Pass the entity's display name
 * (or null/undefined while it's still loading). Call it unconditionally at the
 * top of the component — it obeys the rules of hooks and no-ops until a real
 * label arrives.
 */
export function useBreadcrumbLeaf(label: string | null | undefined): void {
  const { setLeaf } = useContext(Ctx);
  useEffect(() => {
    setLeaf(label ?? null);
    return () => setLeaf(null);
  }, [label, setLeaf]);
}

/** Read the registered leaf. Used by <Breadcrumbs>. */
export function useBreadcrumbLeafValue(): string | null {
  return useContext(Ctx).leaf;
}
