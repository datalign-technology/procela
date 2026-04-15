import { useEffect, type RefObject } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useFocusTrap — keep Tab / Shift-Tab inside a container while it's open.
// Used by modals so keyboard users can't accidentally tab out of the
// dialog into the page behind. Also focuses the container (or a first
// focusable element) on mount so the user starts inside it.
//
// Pass `enabled: false` to disable the trap without unmounting the hook.
// ──────────────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T>, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;

    // Focus the first focusable element on mount, falling back to the
    // root itself so `document.activeElement` lives inside the trap.
    const initialFocusables = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (initialFocusables.length > 0) initialFocusables[0].focus();
    else (root as HTMLElement).focus?.();

    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      // Restore focus to whatever was focused before the trap opened.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [ref, enabled]);
}
