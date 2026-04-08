import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrgOption {
  id: string;
  name: string;
  type: string;
}

interface OrgContextState {
  activeOrgId: string;
  activeOrgName: string;
  orgs: OrgOption[];
  refreshKey: number;
  setActiveOrg: (id: string, name: string) => void;
  setOrgs: (orgs: OrgOption[]) => void;
  clearActiveOrg: () => void;
  triggerRefresh: () => void;
}

export const useOrgContext = create<OrgContextState>()(
  persist(
    (set) => ({
      activeOrgId: '',
      activeOrgName: '',
      orgs: [],
      refreshKey: 0,
      setActiveOrg: (id, name) => set({ activeOrgId: id, activeOrgName: name }),
      setOrgs: (orgs) => set({ orgs }),
      clearActiveOrg: () => set({ activeOrgId: '', activeOrgName: '' }),
      triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
    }),
    { name: 'org-context' }
  )
);
