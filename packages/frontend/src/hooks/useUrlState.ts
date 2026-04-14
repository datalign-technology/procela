import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// ──────────────────────────────────────────────────────────────────────────
// useUrlState — keep small bits of UI state (filter, sort, tab) in the URL
// so back/forward and shareable links Just Work. Treats the param as a
// single string; for arrays/objects, JSON-encode at the call site.
//
// const [sort, setSort] = useUrlState('sort', 'name');
// ──────────────────────────────────────────────────────────────────────────

export function useUrlState(key: string, defaultValue: string = ''): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? defaultValue;
  const setValue = useCallback(
    (next: string) => {
      const nextParams = new URLSearchParams(searchParams);
      if (!next || next === defaultValue) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, next);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [key, defaultValue, searchParams, setSearchParams],
  );
  return [value, setValue];
}
