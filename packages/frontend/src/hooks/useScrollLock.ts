import { useEffect } from 'react';

// useScrollLock — freezes the page behind a modal so the body can't
// scroll while the dialog is open. Pair with `useFocusTrap` to keep the
// keyboard inside the dialog and the visual focus on it.
//
// Restores the original overflow on unmount or when `enabled` flips off.
// Multiple concurrent modals: each one stashes the *previous* value, so
// the last to close puts the original back.

export function useScrollLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [enabled]);
}
