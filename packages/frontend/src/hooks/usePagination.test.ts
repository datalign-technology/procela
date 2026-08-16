import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination } from './usePagination';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('usePagination', () => {
  it('shows the first page and reports the total page count', () => {
    const { result } = renderHook(() => usePagination(range(120), 50));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageItems).toHaveLength(50);
    expect(result.current.pageItems[0]).toBe(0);
    expect(result.current.pageItems[49]).toBe(49);
    expect(result.current.startIndex).toBe(1);
    expect(result.current.endIndex).toBe(50);
    expect(result.current.canPrev).toBe(false);
    expect(result.current.canNext).toBe(true);
  });

  it('reports a single page for a list that fits', () => {
    const { result } = renderHook(() => usePagination(range(30), 50));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.pageItems).toHaveLength(30);
    expect(result.current.canNext).toBe(false);
  });

  it('next / prev / last / first move between pages', () => {
    const { result } = renderHook(() => usePagination(range(120), 50));
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    expect(result.current.pageItems[0]).toBe(50);
    expect(result.current.startIndex).toBe(51);
    expect(result.current.endIndex).toBe(100);
    act(() => result.current.last());
    expect(result.current.page).toBe(3);
    expect(result.current.pageItems).toHaveLength(20); // 120 - 100
    expect(result.current.endIndex).toBe(120);
    expect(result.current.canNext).toBe(false);
    act(() => result.current.first());
    expect(result.current.page).toBe(1);
  });

  it('setPage clamps into range', () => {
    const { result } = renderHook(() => usePagination(range(120), 50));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
    act(() => result.current.setPage(-5));
    expect(result.current.page).toBe(1);
  });

  it('resets to page 1 when the result set size changes', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: number[] }) => usePagination(items, 25),
      { initialProps: { items: range(200) } },
    );
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    rerender({ items: range(30) }); // a filter narrowed the list
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(2);
  });

  it('changing the page size resets to page 1 with the new size', () => {
    const { result } = renderHook(() => usePagination(range(300), 50));
    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(25));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.pageItems).toHaveLength(25);
    expect(result.current.totalPages).toBe(12);
  });
});
