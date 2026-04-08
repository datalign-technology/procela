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
  setActiveOrg: (id: string, name: string) => void;
  setOrgs: (orgs: OrgOption[]) => void;
  clearActiveOrg: () => void;
}

export const useOrgContext = create<OrgContextState>()(
  persist(
    (set) => ({
      activeOrgId: '',
      activeOrgName: '',
      orgs: [],
      setActiveOrg: (id, name) => set({ activeOrgId: id, activeOrgName: name }),
      setOrgs: (orgs) => set({ orgs }),
      clearActiveOrg: () => set({ activeOrgId: '', activeOrgName: '' }),
    }),
    { name: 'org-context' }
  )
);
