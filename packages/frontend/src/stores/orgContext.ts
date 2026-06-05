import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

interface OrgOption {
  id: string;
  name: string;
  type: string;
}

const VALUE_STREAM_LEVELS = ['company', 'division'];

interface OrgContextState {
  activeOrgId: string;
  activeOrgName: string;
  activeOrgType: string;
  orgs: OrgOption[];
  refreshKey: number;
  canCreateValueStreams: boolean;
  setActiveOrg: (id: string, name: string, type: string) => void;
  setOrgs: (orgs: OrgOption[]) => void;
  clearActiveOrg: () => void;
  triggerRefresh: () => void;
}

export const useOrgContext = create<OrgContextState>()(
  persist(
    (set, get) => ({
      activeOrgId: '',
      activeOrgName: '',
      activeOrgType: '',
      orgs: [],
      refreshKey: 0,
      canCreateValueStreams: false,
      setActiveOrg: (id, name, type) => {
        const previousOrgId = get().activeOrgId;
        set({
          activeOrgId: id,
          activeOrgName: name,
          activeOrgType: type,
          canCreateValueStreams: VALUE_STREAM_LEVELS.includes(type),
        });
        // Re-mint the access token bound to the new org so per-org
        // role overrides take effect immediately. Skip on the
        // initial assignment (no previous org) — that's part of
        // login bootstrap where the token already carries the right
        // org. Fire-and-forget; on failure the user keeps the old
        // role until their next /auth/refresh.
        if (previousOrgId && previousOrgId !== id && useAuthStore.getState().isAuthenticated) {
          apiClient.post<{ data: { accessToken: string; expiresIn: number; user: { role: string } } }>(
            '/auth/switch-org', { orgId: id },
          ).then((res) => {
            useAuthStore.getState().refreshSession(res.data.accessToken, res.data.expiresIn);
            const u = useAuthStore.getState().user;
            if (u && res.data.user?.role) {
              useAuthStore.setState({ user: { ...u, orgId: id, role: res.data.user.role as typeof u.role } });
            }
          }).catch(() => { /* user stays on the previous-org role until next refresh */ });
        }
      },
      setOrgs: (orgs) => set({ orgs }),
      clearActiveOrg: () => set({
        activeOrgId: '', activeOrgName: '', activeOrgType: '',
        canCreateValueStreams: false,
      }),
      triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
    }),
    { name: 'org-context' }
  )
);

export { VALUE_STREAM_LEVELS };
