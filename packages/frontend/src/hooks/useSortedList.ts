import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// ──────────────────────────────────────────────────────────────────────────
// useSortedList — click-to-sort helper for tables. Backs the active sort
// column + direction in the URL (?sort=name&dir=desc) so reloading or
// sharing the link preserves the view.
//
// Usage:
//   const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
//     items,
//     {
//       name: (a, b) => a.name.localeCompare(b.name),
//       updated: (a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt),
//     },
//     'name',
//   );
//
//   <SortableTh label="Name" sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort} />
// ──────────────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

export type Comparators<T> = Record<string, (a: T, b: T) => number>;

interface UseSortedListReturn<T> {
  sorted: T[];
  sortKey: string;
  sortDir: SortDir;
  toggleSort: (nextKey: string) => void;
  setSort: (key: string, dir: SortDir) => void;
}

export function useSortedList<T>(
  items: T[],
  comparators: Comparators<T>,
  defaultKey: string,
  defaultDir: SortDir = 'asc',
  paramPrefix: string = '',
): UseSortedListReturn<T> {
  const sortParam = `${paramPrefix}sort`;
  const dirParam = `${paramPrefix}dir`;
  const [searchParams, setSearchParams] = useSearchParams();
  const sortKey = searchParams.get(sortParam) || defaultKey;
  const sortDir: SortDir = (searchParams.get(dirParam) || defaultDir) === 'desc' ? 'desc' : 'asc';

  const sorted = useMemo(() => {
    const cmp = comparators[sortKey];
    if (!cmp) return items;
    const out = [...items].sort(cmp);
    return sortDir === 'desc' ? out.reverse() : out;
  }, [items, comparators, sortKey, sortDir]);

  const toggleSort = useCallback((nextKey: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextKey === sortKey) {
        next.set(dirParam, sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        next.set(sortParam, nextKey);
        next.set(dirParam, 'asc');
      }
      return next;
    }, { replace: true });
  }, [sortKey, sortDir, sortParam, dirParam, setSearchParams]);

  const setSort = useCallback((key: string, dir: SortDir) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(sortParam, key);
      next.set(dirParam, dir);
      return next;
    }, { replace: true });
  }, [sortParam, dirParam, setSearchParams]);

  return { sorted, sortKey, sortDir, toggleSort, setSort };
}
