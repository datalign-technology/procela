import { useAuthStore } from '@/stores/authStore';
import type { UserRole } from '@/types';

const ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN'];
const WRITE_ROLES: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR'];
const CONTRIBUTE_ROLES: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR'];

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const role: UserRole = user?.role ?? 'VIEWER';

  return {
    role,
    isSuperAdmin: role === 'SUPER_ADMIN',
    isAdmin: ADMIN_ROLES.includes(role),
    canWrite: WRITE_ROLES.includes(role),
    canContribute: CONTRIBUTE_ROLES.includes(role),
    isViewer: role === 'VIEWER',
  };
}
