import { create } from 'zustand';
import { apiClient } from '@/api/client';

// ──────────────────────────────────────────────────────────────────────────
// AI-config store — holds the deployment's AI integration switch, fetched
// once on app mount (like brandingStore). When AI is turned off
// (AI_FEATURES_ENABLED=false on the backend) every AI surface is hidden:
// the assistant, industry-template generation, data/asset suggestions, the
// sensitivity classifier, and the AI agents. The backend also refuses the
// AI endpoints, so hiding is purely a UX nicety over the real enforcement.
//
// Defaults to enabled until the fetch resolves, so a slow/failed config
// call never briefly hides AI for a deployment that has it on. Components
// should read `loaded` when they need to avoid a flash before the answer.
// ──────────────────────────────────────────────────────────────────────────

interface HealthConfig {
  aiConfigured: boolean;
  aiFeaturesEnabled: boolean;
}

interface AiConfigState {
  /** True when AI integration features are available in this deployment. */
  aiEnabled: boolean;
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useAiConfigStore = create<AiConfigState>()((set) => ({
  aiEnabled: true,
  loaded: false,

  fetch: async () => {
    try {
      const res = await apiClient.get<HealthConfig>('/health/config');
      set({ aiEnabled: res.aiFeaturesEnabled !== false, loaded: true });
    } catch {
      // Leave the default (enabled) on failure so a config hiccup never
      // hides AI for a deployment that actually has it on.
      set({ loaded: true });
    }
  },
}));

/** Convenience hook: whether AI integration features are on. */
export function useAiEnabled(): boolean {
  return useAiConfigStore((s) => s.aiEnabled);
}
