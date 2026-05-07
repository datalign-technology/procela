import { useEffect, useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useRefreshOnFocus — fire `callback` when the tab regains focus or
// becomes visible. Useful for pages that show data which can change in
// another tab (e.g. a person picker that goes stale when the user adds
// a person on /people). The callback is held in a ref so identity
// changes don't churn the listeners.
// ──────────────────────────────────────────────────────────────────────────

export function useRefreshOnFocus(callback: () => void, enabled: boolean = true) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled) return;
    // visibilitychange covers tab switches; focus covers window focus.
    // Both can fire in quick succession on some browsers; the callback
    // is expected to be idempotent so the duplicate is harmless.
    const onWake = () => {
      if (document.visibilityState === 'visible') savedCallback.current();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled]);
}

// ──────────────────────────────────────────────────────────────────────────
// usePolling — invoke `callback` every `intervalMs` ms while `enabled`.
// `pauseWhen` lets callers suspend the cycle without unmounting (e.g.
// while an edit form is open, so the user's work isn't clobbered by a
// refetch). The callback is kept in a ref so changes to it don't restart
// the interval.
//
// `refreshOnFocus` (default true) also fires the callback when the tab
// regains focus, so users who add a record in another tab see fresh
// data on return without waiting `intervalMs` for the next poll.
// ──────────────────────────────────────────────────────────────────────────

interface PollingOptions {
  enabled?: boolean;
  pauseWhen?: boolean;
  refreshOnFocus?: boolean;
}

export function usePolling(callback: () => void, intervalMs: number, optionsOrEnabled: boolean | PollingOptions = true) {
  const { enabled = true, pauseWhen = false, refreshOnFocus = true } = typeof optionsOrEnabled === 'boolean'
    ? { enabled: optionsOrEnabled, pauseWhen: false, refreshOnFocus: true }
    : optionsOrEnabled;

  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled || pauseWhen) return;
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, pauseWhen]);

  // Reuse the same focus-refresh logic so polling pages get it for free.
  useRefreshOnFocus(() => savedCallback.current(), enabled && !pauseWhen && refreshOnFocus);
}

// setStateIfChanged — wrap a React `setState` so polled refetches don't
// trigger a re-render when the server returned byte-identical data.
// Use in a polling handler:
//
//   const res = await apiClient.get('/systems');
//   setStateIfChanged(setSystems, res.data, prevSystemsRef);
//
// For the common case of plain-data arrays/objects, a JSON.stringify
// compare is "good enough" — the prototype's server payloads are small
// and Date strings are already serialised.
export function setStateIfChanged<T>(setter: (value: T) => void, next: T, prevRef: { current: string | null }) {
  const nextJson = JSON.stringify(next);
  if (nextJson === prevRef.current) return;
  prevRef.current = nextJson;
  setter(next);
}
