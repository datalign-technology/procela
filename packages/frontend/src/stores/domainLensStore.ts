import { create } from 'zustand';

// ──────────────────────────────────────────────────────────────────────────
// Domain lens — global "show governance, operational, or all" filter.
//
// Governance and operational work are different kinds of things with
// different audiences. Rather than two siloed apps or one undifferentiated
// list, every surface that mixes them reads this lens and filters its
// rows accordingly, so a process owner and the data office each get a
// focused, low-noise view of the same underlying model.
//
// Persisted in localStorage so the preference survives a reload. Pages
// may override the *default* for their primary audience (e.g. the
// Process Catalog defaults to OPERATIONAL) — see useDomainLens(default).
// ──────────────────────────────────────────────────────────────────────────

export type DomainValue = 'GOVERNANCE' | 'OPERATIONAL';
export type DomainLens = 'ALL' | DomainValue;

const STORAGE_KEY = 'procela:domain-lens';

function readInitial(): DomainLens {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'ALL' || raw === 'GOVERNANCE' || raw === 'OPERATIONAL') return raw;
  } catch { /* localStorage may be unavailable */ }
  return 'ALL';
}

interface DomainLensState {
  lens: DomainLens;
  setLens: (l: DomainLens) => void;
}

export const useDomainLensStore = create<DomainLensState>((set) => ({
  lens: readInitial(),
  setLens: (lens) => {
    try { localStorage.setItem(STORAGE_KEY, lens); } catch { /* */ }
    set({ lens });
  },
}));

// Does an item with the given domain pass the active lens? A missing
// domain is treated as OPERATIONAL (matches the backend default and the
// one-time process backfill), so legacy rows never vanish unexpectedly.
export function passesLens(lens: DomainLens, domain: DomainValue | null | undefined): boolean {
  if (lens === 'ALL') return true;
  return (domain || 'OPERATIONAL') === lens;
}
