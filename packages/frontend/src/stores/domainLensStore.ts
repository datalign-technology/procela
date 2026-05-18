import { create } from 'zustand';

// ──────────────────────────────────────────────────────────────────────────
// Domain lens — "show governance, operational, or all" filter.
//
// Governance and operational work are different kinds of things with
// different audiences. Surfaces that mix them read a lens and filter
// accordingly so each audience gets a focused, low-noise view.
//
// The lens is now PER PAGE, not one global value. A single shared value
// caused a real bug: Process Catalog force-set it to All on mount, which
// silently wiped the choice a user had made on Data Assets. Each page
// keyed by `pageKey` keeps its own persisted lens, so no page can clobber
// another's. Persisted as one JSON blob in localStorage.
// ──────────────────────────────────────────────────────────────────────────

export type DomainValue = 'GOVERNANCE' | 'OPERATIONAL';
export type DomainLens = 'ALL' | DomainValue;

const STORAGE_KEY = 'procela:domain-lens-by-page';

function readInitial(): Record<string, DomainLens> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const clean: Record<string, DomainLens> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'ALL' || v === 'GOVERNANCE' || v === 'OPERATIONAL') clean[k] = v;
      }
      return clean;
    }
  } catch { /* localStorage may be unavailable / malformed */ }
  return {};
}

interface DomainLensState {
  /** lens per page key. Absent key ⇒ that page hasn't been set yet. */
  lenses: Record<string, DomainLens>;
  setLens: (pageKey: string, lens: DomainLens) => void;
}

export const useDomainLensStore = create<DomainLensState>((set) => ({
  lenses: readInitial(),
  setLens: (pageKey, lens) =>
    set((state) => {
      const next = { ...state.lenses, [pageKey]: lens };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* */ }
      return { lenses: next };
    }),
}));

/** Read the active lens for a page, falling back to `fallback` (default
 *  ALL) when the page has no stored value yet. */
export function useDomainLens(pageKey: string, fallback: DomainLens = 'ALL'): DomainLens {
  return useDomainLensStore((s) => s.lenses[pageKey] ?? fallback);
}

/** Does an item with the given domain pass the active lens? A missing
 *  domain is treated as OPERATIONAL (matches the backend default and the
 *  one-time process backfill), so legacy rows never vanish unexpectedly. */
export function passesLens(lens: DomainLens, domain: DomainValue | null | undefined): boolean {
  if (lens === 'ALL') return true;
  return (domain || 'OPERATIONAL') === lens;
}
