import { create } from 'zustand';
import { apiClient } from '@/api/client';

// ──────────────────────────────────────────────────────────────────────────
// Active regulatory-classification regimes for the current tenant.
//
// An org admin chooses which of CUI / ITAR / EXPORT_CONTROLLED are active for
// their tenant (Settings). Assets can only carry a regulatory tag whose regime
// is active. This store resolves the effective set for the active org by
// walking up to the first ancestor that carries an explicit config; an org
// that was never configured (no field) falls back to all regimes active
// (back-compat with the built-in set). The universal data-sensitivity tags
// (PII/PHI/…) are never gated by this.
// ──────────────────────────────────────────────────────────────────────────

export const ALL_REGIMES = ['CUI', 'ITAR', 'EXPORT_CONTROLLED'] as const;

interface OrgRow { id: string; parentId?: string | null; activeSensitivityRegimes?: string[] }

interface RegimeState {
  regimes: string[];
  loaded: boolean;
  fetch: (activeOrgId?: string) => Promise<void>;
}

export const useRegimeStore = create<RegimeState>()((set) => ({
  regimes: [...ALL_REGIMES],
  loaded: false,
  fetch: async (activeOrgId) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: OrgRow[] }>('/organizations');
      const orgs = res.data || [];
      let cur = activeOrgId ? orgs.find((o) => o.id === activeOrgId) : undefined;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (Array.isArray(cur.activeSensitivityRegimes)) {
          set({ regimes: cur.activeSensitivityRegimes, loaded: true });
          return;
        }
        cur = cur.parentId ? orgs.find((o) => o.id === cur!.parentId) : undefined;
      }
      set({ regimes: [...ALL_REGIMES], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

/** The regulatory regimes active for the current tenant (defaults to all). */
export function useActiveRegimes(): string[] {
  return useRegimeStore((s) => s.regimes);
}
