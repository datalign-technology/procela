import { useCallback, useEffect, useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useUnsavedChanges — track whether a form has pending edits so closing
// or navigating away prompts for confirmation first. Forms call `markDirty`
// on every edit and `markClean` after a successful save or deliberate
// reset. Exposed `confirmIfDirty(onProceed)` prompts if needed, otherwise
// calls the callback directly — use it in close/cancel handlers.
//
// Also wires `beforeunload` so a browser tab close / reload during an
// in-flight edit gets the native "leave this page?" dialog.
// ──────────────────────────────────────────────────────────────────────────

interface UseUnsavedChangesReturn {
  isDirty: () => boolean;
  markDirty: () => void;
  markClean: () => void;
  confirmIfDirty: (onProceed: () => void, message?: string) => void;
}

export function useUnsavedChanges(): UseUnsavedChangesReturn {
  const dirtyRef = useRef(false);

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);
  const markClean = useCallback(() => { dirtyRef.current = false; }, []);
  const isDirty = useCallback(() => dirtyRef.current, []);

  const confirmIfDirty = useCallback((onProceed: () => void, message?: string) => {
    if (!dirtyRef.current) {
      onProceed();
      return;
    }
    const ok = window.confirm(
      message || 'You have unsaved changes. Are you sure you want to discard them?',
    );
    if (ok) {
      dirtyRef.current = false;
      onProceed();
    }
  }, []);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Required to trigger the native prompt in most browsers.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return { isDirty, markDirty, markClean, confirmIfDirty };
}
