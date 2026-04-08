import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
    (set) => ({
      activeOrgId: '',
      activeOrgName: '',
      activeOrgType: '',
      orgs: [],
      refreshKey: 0,
      canCreateValueStreams: false,
      setActiveOrg: (id, name, type) => set({
        activeOrgId: id,
        activeOrgName: name,
        activeOrgType: type,
        canCreateValueStreams: VALUE_STREAM_LEVELS.includes(type),
      }),
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
