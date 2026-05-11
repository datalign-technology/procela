import { create } from 'zustand';

// ──────────────────────────────────────────────────────────────────────────
// Terminology store — global "plain English" vs. "DAMA jargon" mode.
//
// Procela serves both business users (who don't know DAMA-DMBOK) and
// data professionals (who use DAMA vocabulary every day). The store
// holds a single `mode` that flips the visible labels for jargon-heavy
// terms via the `useTerm` hook in `lib/terminology.ts`. Plain mode is
// the default so first-time users aren't met with unfamiliar words.
//
// Persisted in localStorage so the user's preference survives reloads.
// ──────────────────────────────────────────────────────────────────────────

export type TerminologyMode = 'plain' | 'dama';

const STORAGE_KEY = 'procela:terminology';

function readInitial(): TerminologyMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dama' || raw === 'plain') return raw;
  } catch { /* localStorage may be unavailable */ }
  return 'plain';
}

interface TerminologyState {
  mode: TerminologyMode;
  setMode: (m: TerminologyMode) => void;
  toggle: () => void;
}

export const useTerminologyStore = create<TerminologyState>()((set, get) => ({
  mode: readInitial(),

  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* */ }
    set({ mode });
  },

  toggle: () => {
    const next: TerminologyMode = get().mode === 'plain' ? 'dama' : 'plain';
    get().setMode(next);
  },
}));
