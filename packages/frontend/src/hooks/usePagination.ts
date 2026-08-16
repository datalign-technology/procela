import { useEffect, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// usePagination — the shared "show the first N, load more on demand" hook for
// long list pages. Client-side only: the page passes its already
// filtered + sorted array; the hook hands back the visible slice plus the
// controls a <LoadMoreBar> renders.
//
// Why "load more" and not numbered pages: the app's lists are filtered live
// in the browser, so there is no server round-trip to page against — the goal
// is just to cap how many rows land in the DOM (and how long the scrollbar
// gets) for a large org, while keeping select-all / sort / search operating
// over the whole result set. A big org's People or Data Assets list renders a
// screenful, and "Load more" reveals the next chunk.
//
// The visible count resets to one page whenever the result-set size changes
// (a filter narrowed or widened the list) or the page size changes, so you
// never land mid-way down a stale, much longer list.
// ──────────────────────────────────────────────────────────────────────────

export interface Pagination<T> {
  /** The rows to actually render (a prefix of `items`). */
  pageItems: T[];
  /** How many are currently shown. */
  shown: number;
  /** Total in the (filtered) result set. */
  total: number;
  /** True when there are more rows than are shown. */
  hasMore: boolean;
  /** Reveal the next page worth of rows. */
  loadMore: () => void;
  /** Reveal everything at once. */
  showAll: () => void;
  /** Current page size and its setter (for the "Rows: [N]" control). */
  pageSize: number;
  setPageSize: (n: number) => void;
}

export function usePagination<T>(items: T[], initialPageSize = 50): Pagination<T> {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [visible, setVisible] = useState(initialPageSize);
  const total = items.length;

  // Snap back to a single page when the result set resizes (a filter/search
  // changed) or the page size changes. Keyed on `total` — a same-size
  // re-filter is rare and not worth tracking row identities for.
  useEffect(() => { setVisible(pageSize); }, [total, pageSize]);

  const shown = Math.min(visible, total);
  const pageItems = visible >= total ? items : items.slice(0, visible);
  const hasMore = shown < total;
  const loadMore = () => setVisible((v) => v + pageSize);
  const showAll = () => setVisible(total);

  return { pageItems, shown, total, hasMore, loadMore, showAll, pageSize, setPageSize };
}
