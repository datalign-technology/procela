import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRowSelection } from './useRowSelection';

interface Row { id: string; name: string; }
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, name: id }));
const key = (r: Row) => r.id;

describe('useRowSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useRowSelection(rows('a', 'b', 'c'), key));
    expect(result.current.count).toBe(0);
    expect(result.current.allSelected).toBe(false);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('toggles a single row on and off', () => {
    const { result } = renderHook(() => useRowSelection(rows('a', 'b', 'c'), key));
    act(() => result.current.toggle('b'));
    expect(result.current.isSelected('b')).toBe(true);
    expect(result.current.count).toBe(1);
    expect(result.current.someSelected).toBe(true);
    expect(result.current.allSelected).toBe(false);
    act(() => result.current.toggle('b'));
    expect(result.current.isSelected('b')).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('toggleAll selects every visible row, then clears them', () => {
    const { result } = renderHook(() => useRowSelection(rows('a', 'b', 'c'), key));
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(3);
    expect(result.current.allSelected).toBe(true);
    expect(result.current.someSelected).toBe(false);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
    expect(result.current.allSelected).toBe(false);
  });

  it('allSelected/someSelected track ONLY the visible set, not stale selections (the select-all/filter bug)', () => {
    // Start with the full list visible and select everything.
    const { result, rerender } = renderHook(
      ({ items }) => useRowSelection(items, key),
      { initialProps: { items: rows('a', 'b', 'c') } },
    );
    act(() => result.current.toggleAll());
    expect(result.current.allSelected).toBe(true);

    // Now a filter narrows the visible set to just [a, b]. Even though 'c'
    // is still selected under the hood, the header state reflects the
    // visible rows — all of which are selected — so it stays "all".
    rerender({ items: rows('a', 'b') });
    expect(result.current.allSelected).toBe(true);
    expect(result.current.count).toBe(3); // 'c' selection preserved off-screen

    // Deselect one visible row → header drops to indeterminate, not "all".
    act(() => result.current.toggle('a'));
    expect(result.current.allSelected).toBe(false);
    expect(result.current.someSelected).toBe(true);
  });

  it('toggleAll on a filtered set preserves selections that are out of view', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useRowSelection(items, key),
      { initialProps: { items: rows('a', 'b', 'c') } },
    );
    act(() => result.current.toggle('c')); // select an item...
    rerender({ items: rows('a', 'b') });   // ...then filter it out of view

    // Select all visible → a, b, c all selected (c untouched).
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(3);

    // Deselect all visible → only the off-screen 'c' remains.
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('c')).toBe(true);
  });

  it('clear drops everything', () => {
    const { result } = renderHook(() => useRowSelection(rows('a', 'b'), key));
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(2);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('allSelected is false when there are no visible rows', () => {
    const { result } = renderHook(() => useRowSelection(rows(), key));
    expect(result.current.allSelected).toBe(false);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
  });
});
