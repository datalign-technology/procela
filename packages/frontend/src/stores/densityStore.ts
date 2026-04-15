import { create } from 'zustand';

// ──────────────────────────────────────────────────────────────────────────
// Density store — global "cozy" vs. "compact" setting. The active mode is
// applied as a `data-density` attribute on the <body>, so CSS can adjust
// padding / row-height for any component that opts in:
//
//   body[data-density="compact"] .some-table td { padding: 4px 10px; }
//
// Persisted in localStorage so the user's preference survives a reload.
// ──────────────────────────────────────────────────────────────────────────

export type Density = 'cozy' | 'compact';

const STORAGE_KEY = 'procela:density';

function readInitial(): Density {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'compact' || raw === 'cozy') return raw;
  } catch { /* localStorage may be unavailable */ }
  return 'cozy';
}

function applyToBody(density: Density) {
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-density', density);
  }
}

interface DensityState {
  density: Density;
  setDensity: (d: Density) => void;
  toggleDensity: () => void;
}

// Apply the initial value synchronously so the first paint has the right
// attribute set (avoids a flash of cozy on a compact reload).
if (typeof document !== 'undefined') {
  applyToBody(readInitial());
}

export const useDensityStore = create<DensityState>()((set, get) => ({
  density: readInitial(),

  setDensity: (density) => {
    try { localStorage.setItem(STORAGE_KEY, density); } catch { /* */ }
    applyToBody(density);
    set({ density });
  },

  toggleDensity: () => {
    const next: Density = get().density === 'cozy' ? 'compact' : 'cozy';
    get().setDensity(next);
  },
}));
