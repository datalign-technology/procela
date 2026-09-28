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
  mcpServerEnabled?: boolean;
  mcpWriteEnabled?: boolean;
}

interface AiConfigState {
  /** True when AI integration features are available in this deployment. */
  aiEnabled: boolean;
  /** True when the MCP surface is enabled at the deployment level (the
   *  per-tenant toggle only takes effect on top of this). */
  mcpServerEnabled: boolean;
  /** True when the MCP write tools are enabled at the deployment level. */
  mcpWriteEnabled: boolean;
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useAiConfigStore = create<AiConfigState>()((set) => ({
  aiEnabled: true,
  // MCP is off by default at the deployment level (opt-in), so — unlike AI —
  // default these to false until the config fetch confirms otherwise.
  mcpServerEnabled: false,
  mcpWriteEnabled: false,
  loaded: false,

  fetch: async () => {
    try {
      const res = await apiClient.get<HealthConfig>('/health/config');
      set({
        aiEnabled: res.aiFeaturesEnabled !== false,
        mcpServerEnabled: res.mcpServerEnabled === true,
        mcpWriteEnabled: res.mcpWriteEnabled === true,
        loaded: true,
      });
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

/** Deployment-level MCP surface state (server enabled, write tools enabled). */
export function useMcpDeployment(): { serverEnabled: boolean; writeEnabled: boolean } {
  return useAiConfigStore((s) => ({ serverEnabled: s.mcpServerEnabled, writeEnabled: s.mcpWriteEnabled }));
}
