import { useState, useCallback } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useColumnPicker — generic visible-columns state for table pages.
//
// The state is parameterised by a string union T that names every
// toggleable column on the page. A page using it declares its column
// list once (id, label, defaultVisible), and the hook returns:
//   - `isVisible(id)` for gating <th>/<td> renders
//   - `visibleCount` for computing colSpans on expanded rows
//   - `toggle(id)`, `reset()`, plus the raw set + setter so callers can
//     wire the popover UI however they prefer
//
// Selection is persisted under the supplied `storageKey` so a user's
// preference survives reloads. Unknown column ids in the stored payload
// (older versions, removed columns) are silently filtered out.
// ──────────────────────────────────────────────────────────────────────────

export interface ColumnSpec<T extends string> {
  id: T;
  label: string;
  defaultVisible: boolean;
}

export interface ColumnPickerState<T extends string> {
  /** All declared column specs in render order. */
  columns: ColumnSpec<T>[];
  /** Set of currently visible ids. Mirrors `isVisible` for callers
   *  that want direct membership checks. */
  visible: Set<T>;
  visibleCount: number;
  isVisible: (id: T) => boolean;
  toggle: (id: T) => void;
  reset: () => void;
  setVisible: (next: Set<T>) => void;
}

export function useColumnPicker<T extends string>(
  storageKey: string,
  columns: ColumnSpec<T>[],
): ColumnPickerState<T> {
  const defaults = (): Set<T> =>
    new Set(columns.filter((c) => c.defaultVisible).map((c) => c.id));

  const load = (): Set<T> => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaults();
      const arr = JSON.parse(raw) as T[];
      const known = new Set(columns.map((c) => c.id));
      return new Set(arr.filter((id) => known.has(id)));
    } catch {
      return defaults();
    }
  };

  const [visible, setVisibleState] = useState<Set<T>>(() => load());

  const persist = useCallback((next: Set<T>) => {
    setVisibleState(next);
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* quota / private mode */ }
  }, [storageKey]);

  const toggle = useCallback((id: T) => {
    const next = new Set(visible);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next);
  }, [visible, persist]);

  const reset = useCallback(() => persist(defaults()), [columns, persist]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    columns,
    visible,
    visibleCount: visible.size,
    isVisible: (id: T) => visible.has(id),
    toggle,
    reset,
    setVisible: persist,
  };
}
