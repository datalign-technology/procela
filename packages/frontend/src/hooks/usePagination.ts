import { useEffect, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// usePagination — shared numbered pagination for long list pages. The page
// passes its already filtered + sorted array; the hook hands back the current
// page's slice plus the controls a <Pager> renders (First / Prev / numbers /
// Next / Last + page size).
//
// Client-side only: the lists are filtered live in the browser, so there is no
// server round-trip to page against — the goal is to cap how many rows land in
// the DOM (and keep the page a fixed height, one scrollbar) for a large org,
// while sort / search / select-all keep operating over the whole result set.
//
// The current page resets to 1 whenever the result-set size changes (a filter
// narrowed/widened the list) or the page size changes, and `page` is always
// clamped into range so the returned slice is valid even mid-update.
// ──────────────────────────────────────────────────────────────────────────

export interface Pagination<T> {
  /** 1-indexed current page (already clamped into [1, totalPages]). */
  page: number;
  pageSize: number;
  totalPages: number;
  /** Total rows in the (filtered) result set. */
  total: number;
  /** The rows on the current page. */
  pageItems: T[];
  /** 1-indexed first / last row shown (startIndex is 0 when empty). */
  startIndex: number;
  endIndex: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  first: () => void;
  prev: () => void;
  next: () => void;
  last: () => void;
  canPrev: boolean;
  canNext: boolean;
}

export function usePagination<T>(items: T[], initialPageSize = 50): Pagination<T> {
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Snap back to the first page when the result set resizes (a filter/search
  // changed) or the page size changes, so you never land on a now-empty page.
  useEffect(() => { setPage(1); }, [total, pageSize]);

  // Clamp defensively so the slice is valid even on the render before the
  // reset effect runs.
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start0 = (clampedPage - 1) * pageSize;
  const pageItems = items.slice(start0, start0 + pageSize);
  const startIndex = total === 0 ? 0 : start0 + 1;
  const endIndex = Math.min(start0 + pageSize, total);

  const goto = (p: number) => setPage(Math.min(Math.max(1, p), totalPages));

  return {
    page: clampedPage,
    pageSize,
    totalPages,
    total,
    pageItems,
    startIndex,
    endIndex,
    setPage: goto,
    setPageSize: (n: number) => { setPageSizeRaw(n); setPage(1); },
    first: () => goto(1),
    prev: () => goto(clampedPage - 1),
    next: () => goto(clampedPage + 1),
    last: () => goto(totalPages),
    canPrev: clampedPage > 1,
    canNext: clampedPage < totalPages,
  };
}
