import { useCallback, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useRowSelection — the shared checkbox-selection state for list pages.
//
// Every list page (Data Assets, People, Systems, Governance Issues, Business
// Glossary, …) had re-implemented the identical machinery by hand: a
// `Set<string>` of ids, a per-row toggle, a select-all, and a "clear". The
// copies drifted — most damagingly, several computed select-all against the
// *unfiltered* source list (`selectedIds.size === assets.length`) while the
// table body rendered the *filtered* list, so "select all" quietly ticked
// hidden rows and the header checkbox showed the wrong state whenever a
// filter was active.
//
// This hook fixes that by construction: it is told the currently-visible,
// selectable rows and derives `allSelected` / `someSelected` / `toggleAll`
// from *that* set. Selections that scroll out of view under a filter are
// preserved (bulk actions still operate on the full `selectedIds`), but the
// header checkbox only ever governs the rows the user can actually see.
//
//   const sel = useRowSelection(visibleRows, (r) => r.id);
//   sel.count            // total selected (incl. any now filtered out of view)
//   sel.isSelected(id)   // row checkbox `checked`
//   sel.toggle(id)       // row checkbox onChange
//   sel.allSelected      // header checkbox `checked`
//   sel.someSelected     // header checkbox `indeterminate`
//   sel.toggleAll()      // header checkbox onChange
//   sel.clear()          // "Clear selection" / post-action reset
//
// Pass only the rows the user is allowed to select as `visibleItems` (e.g.
// filter out inherited / read-only rows) so select-all matches what the row
// checkboxes permit.
// ──────────────────────────────────────────────────────────────────────────

export interface RowSelection {
  /** The full set of selected ids, including any currently filtered out of view. */
  selectedIds: Set<string>;
  /** Size of `selectedIds`. */
  count: number;
  isSelected: (id: string) => boolean;
  /** Toggle a single row. */
  toggle: (id: string) => void;
  /** Drop one id from the selection — e.g. after deleting that row, so a
   *  phantom selection doesn't linger in the count / bulk-action bar. */
  remove: (id: string) => void;
  /** Select every visible row, or — if all visible rows are already
   *  selected — deselect them (preserving any off-screen selections). */
  toggleAll: () => void;
  /** Drop all selections. */
  clear: () => void;
  /** True when every currently-visible row is selected. Header checkbox `checked`. */
  allSelected: boolean;
  /** True when some — but not all — visible rows are selected. Header checkbox `indeterminate`. */
  someSelected: boolean;
}

export function useRowSelection<T>(
  visibleItems: T[],
  getKey: (item: T) => string,
): RowSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Latest visible keys, recomputed each render. Held in a ref as well so
  // toggleAll stays referentially stable while always acting on the current
  // filtered set.
  const visibleKeys = visibleItems.map(getKey);
  const visibleKeysRef = useRef(visibleKeys);
  visibleKeysRef.current = visibleKeys;

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const keys = visibleKeysRef.current;
    setSelectedIds((prev) => {
      const everyVisibleSelected = keys.length > 0 && keys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (everyVisibleSelected) {
        keys.forEach((k) => next.delete(k));
      } else {
        keys.forEach((k) => next.add(k));
      }
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selectedIds.has(k));
  const someSelected = !allSelected && visibleKeys.some((k) => selectedIds.has(k));

  return { selectedIds, count: selectedIds.size, isSelected, toggle, remove, toggleAll, clear, allSelected, someSelected };
}
