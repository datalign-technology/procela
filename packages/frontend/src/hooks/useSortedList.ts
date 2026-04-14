import { useMemo } from 'react';
import { useUrlState } from './useUrlState';

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
  const [sortKey, setSortKeyParam] = useUrlState(sortParam, defaultKey);
  const [sortDirRaw, setSortDirParam] = useUrlState(dirParam, defaultDir);
  const sortDir: SortDir = sortDirRaw === 'desc' ? 'desc' : 'asc';

  const sorted = useMemo(() => {
    const cmp = comparators[sortKey];
    if (!cmp) return items;
    const out = [...items].sort(cmp);
    return sortDir === 'desc' ? out.reverse() : out;
  }, [items, comparators, sortKey, sortDir]);

  const toggleSort = (nextKey: string) => {
    if (nextKey === sortKey) {
      setSortDirParam(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKeyParam(nextKey);
      setSortDirParam('asc');
    }
  };

  const setSort = (key: string, dir: SortDir) => {
    setSortKeyParam(key);
    setSortDirParam(dir);
  };

  return { sorted, sortKey, sortDir, toggleSort, setSort };
}
