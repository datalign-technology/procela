import { useEffect } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useKeyboardShortcut — register a global keyboard shortcut. Skips firing
// while the user is typing in an input/textarea/contenteditable so single-
// letter shortcuts ('n', '/') don't hijack normal text entry. Mod-keyed
// shortcuts (Cmd/Ctrl+K) bypass that guard.
//
// Usage:
//   useKeyboardShortcut('k', () => openPalette(), { mod: true });
//   useKeyboardShortcut('?', () => setShortcutsOpen(true), { shift: true });
//   useKeyboardShortcut('/', () => focusSearch());
// ──────────────────────────────────────────────────────────────────────────

interface ShortcutOptions {
  mod?: boolean;       // require Cmd (mac) or Ctrl (other) — true to require, false to forbid
  shift?: boolean;     // require Shift
  preventDefault?: boolean;
  enabled?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcut(key: string, handler: (e: KeyboardEvent) => void, options: ShortcutOptions = {}) {
  const { mod = false, shift = false, preventDefault = true, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modPressed = isMac ? e.metaKey : e.ctrlKey;

      if (mod && !modPressed) return;
      if (!mod && modPressed) return;
      if (shift !== e.shiftKey) return;
      if (e.key !== key) return;

      // Don't hijack typing for non-mod shortcuts.
      if (!mod && isTypingTarget(e.target)) return;

      if (preventDefault) e.preventDefault();
      handler(e);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, mod, shift, preventDefault, enabled, handler]);
}
