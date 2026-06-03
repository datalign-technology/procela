import { create } from 'zustand';
import { apiClient } from '@/api/client';

// ──────────────────────────────────────────────────────────────────────────
// Branding store — holds the customer's theme (company name, logo, colors)
// and applies it to the document as CSS custom properties. Fetched once on
// app mount (including before login so the login screen is themed).
//
// Colors override the CSS variables defined in styles/global.css. The
// `applyTheme` method walks a fixed mapping from store keys → CSS var
// names; anything not set falls back to the built-in default.
//
// The sidebar uses two extra derived shades (text and active-text) that
// we compute from the base sidebar color so a customer only has to pick
// one value. Everything else is set explicitly.
// ──────────────────────────────────────────────────────────────────────────

export interface BrandingConfig {
  companyName: string;
  logoUrl: string;
  primaryColor: string;
  primaryHoverColor: string;
  primaryLightColor: string;
  sidebarColor: string;
  sidebarHoverColor: string;
  updatedAt: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  companyName:        'Procela',
  logoUrl:            '/procela-icon.png',
  primaryColor:       '#1a7a6d',
  primaryHoverColor:  '#15655a',
  primaryLightColor:  '#d1f0eb',
  sidebarColor:       '#0f172a',
  sidebarHoverColor:  '#1e293b',
  updatedAt:          new Date(0).toISOString(),
};

// CSS variable name → branding field. Only listed keys get overridden;
// everything else (surface, border, text) stays on the default palette
// since those are neutral and not usually part of brand identity.
const VAR_MAP: Array<[cssVar: string, key: keyof BrandingConfig]> = [
  ['--color-primary',       'primaryColor'],
  ['--color-primary-hover', 'primaryHoverColor'],
  ['--color-primary-light', 'primaryLightColor'],
  ['--color-sidebar',       'sidebarColor'],
  ['--color-sidebar-hover', 'sidebarHoverColor'],
];

function applyTheme(branding: BrandingConfig) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [cssVar, key] of VAR_MAP) {
    const value = branding[key] as string;
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
  // Update <title> suffix so the browser tab shows the customer's name.
  if (branding.companyName) {
    const base = document.title.split(' — ')[0] || 'Procela';
    document.title = branding.companyName === 'Procela' ? base : `${base} — ${branding.companyName}`;
  }
}

interface BrandingState {
  branding: BrandingConfig;
  loaded: boolean;
  fetch: () => Promise<void>;
  save: (updates: Partial<BrandingConfig>) => Promise<void>;
  reset: () => Promise<void>;
  preview: (updates: Partial<BrandingConfig>) => void;   // local-only, no persist
}

export const useBrandingStore = create<BrandingState>()((set, get) => ({
  branding: DEFAULT_BRANDING,
  loaded: false,

  fetch: async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: BrandingConfig }>('/branding');
      const next = { ...DEFAULT_BRANDING, ...res.data };
      applyTheme(next);
      set({ branding: next, loaded: true });
    } catch {
      // Apply defaults on failure so the UI still renders.
      applyTheme(DEFAULT_BRANDING);
      set({ loaded: true });
    }
  },

  save: async (updates) => {
    const next = { ...get().branding, ...updates };
    const res = await apiClient.put<{ success: boolean; data: BrandingConfig }>('/branding', updates);
    const saved = { ...DEFAULT_BRANDING, ...res.data };
    applyTheme(saved);
    set({ branding: saved });
    return;
    void next;
  },

  reset: async () => {
    const res = await apiClient.post<{ success: boolean; data: BrandingConfig }>('/branding/reset', {});
    const saved = { ...DEFAULT_BRANDING, ...res.data };
    applyTheme(saved);
    set({ branding: saved });
  },

  // For the settings page's live preview: apply locally without hitting
  // the server. The parent form re-renders with the pending values but
  // the theme stays pending-preview until Save is clicked.
  preview: (updates) => {
    const next = { ...get().branding, ...updates };
    applyTheme(next);
    set({ branding: next });
  },
}));
