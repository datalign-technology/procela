import { useEffect, useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// usePolling — invoke `callback` every `intervalMs` ms while `enabled`.
// `pauseWhen` lets callers suspend the cycle without unmounting (e.g.
// while an edit form is open, so the user's work isn't clobbered by a
// refetch). The callback is kept in a ref so changes to it don't restart
// the interval.
// ──────────────────────────────────────────────────────────────────────────

interface PollingOptions {
  enabled?: boolean;
  pauseWhen?: boolean;
}

export function usePolling(callback: () => void, intervalMs: number, optionsOrEnabled: boolean | PollingOptions = true) {
  const { enabled = true, pauseWhen = false } = typeof optionsOrEnabled === 'boolean'
    ? { enabled: optionsOrEnabled, pauseWhen: false }
    : optionsOrEnabled;

  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled || pauseWhen) return;
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, pauseWhen]);
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
