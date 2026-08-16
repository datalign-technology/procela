import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination } from './usePagination';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('usePagination', () => {
  it('shows only the first page and reports the rest as more', () => {
    const { result } = renderHook(() => usePagination(range(120), 50));
    expect(result.current.pageItems).toHaveLength(50);
    expect(result.current.shown).toBe(50);
    expect(result.current.total).toBe(120);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.pageItems[0]).toBe(0);
    expect(result.current.pageItems[49]).toBe(49);
  });

  it('does not paginate when the list fits in a page', () => {
    const { result } = renderHook(() => usePagination(range(30), 50));
    expect(result.current.pageItems).toHaveLength(30);
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore reveals the next page worth of rows', () => {
    const { result } = renderHook(() => usePagination(range(120), 50));
    act(() => result.current.loadMore());
    expect(result.current.shown).toBe(100);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    expect(result.current.shown).toBe(120);
    expect(result.current.hasMore).toBe(false);
  });

  it('showAll reveals the whole list at once', () => {
    const { result } = renderHook(() => usePagination(range(500), 50));
    act(() => result.current.showAll());
    expect(result.current.shown).toBe(500);
    expect(result.current.hasMore).toBe(false);
  });

  it('snaps back to the first page when the result set size changes', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: number[] }) => usePagination(items, 50),
      { initialProps: { items: range(200) } },
    );
    act(() => result.current.loadMore()); // now showing 100
    expect(result.current.shown).toBe(100);
    // A filter narrows the list — visible count resets to one page.
    rerender({ items: range(80) });
    expect(result.current.shown).toBe(50);
    expect(result.current.hasMore).toBe(true);
  });

  it('changing the page size resets to one page of the new size', () => {
    const { result } = renderHook(() => usePagination(range(300), 50));
    act(() => result.current.loadMore()); // 100
    act(() => result.current.setPageSize(25));
    expect(result.current.shown).toBe(25);
    expect(result.current.pageItems).toHaveLength(25);
  });
});
