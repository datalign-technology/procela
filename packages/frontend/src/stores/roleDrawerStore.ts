import { create } from 'zustand';

// ──────────────────────────────────────────────────────────────────────────
// Role drawer store - tracks which governance role (if any) is being
// inspected in the side drawer. Lives at the app level so any role chip,
// badge, or label anywhere in the UI can open the drawer without prop
// drilling.
// ──────────────────────────────────────────────────────────────────────────

interface RoleDrawerState {
  roleType: string | null;
  open: (roleType: string) => void;
  close: () => void;
}

export const useRoleDrawerStore = create<RoleDrawerState>()((set) => ({
  roleType: null,
  open: (roleType) => set({ roleType }),
  close: () => set({ roleType: null }),
}));
