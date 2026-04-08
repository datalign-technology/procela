import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

// ---------------------------------------------------------------------------
// Role-Based Permissions
// ---------------------------------------------------------------------------
//
// Permissions follow a "resource:action" convention.  Wildcards are supported:
//   '*'           — matches everything (SUPER_ADMIN)
//   'resource:*'  — matches any action on a resource (e.g. 'process:*')
//   'resource:action' — exact match
// ---------------------------------------------------------------------------

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ORG_ADMIN: ['org:*', 'process:*', 'system:*', 'data-asset:*', 'mapping:*', 'people:*'],
  PROCESS_OWNER: ['process:read', 'process:write', 'system:read', 'data-asset:read', 'mapping:read', 'mapping:write'],
  DATA_STEWARD: ['process:read', 'system:read', 'data-asset:read', 'data-asset:write', 'mapping:read', 'mapping:write'],
  CONTRIBUTOR: ['process:read', 'process:write', 'system:read', 'data-asset:read'],
  VIEWER: ['process:read', 'system:read', 'data-asset:read', 'mapping:read', 'org:read', 'people:read'],
};

/**
 * Check whether a given role has a specific permission.
 *
 * Supports wildcard matching:
 *   - Role with ['*'] has all permissions.
 *   - Role with ['process:*'] has 'process:read', 'process:write', etc.
 *   - Exact match: 'process:read' matches 'process:read'.
 */
export function hasPermission(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;

  // Full wildcard — matches everything
  if (perms.includes('*')) return true;

  // Exact match
  if (perms.includes(permission)) return true;

  // Resource-level wildcard: 'process:*' matches 'process:read'
  const [resource] = permission.split(':');
  if (resource && perms.includes(`${resource}:*`)) return true;

  return false;
}

/**
 * Express middleware factory that checks whether the authenticated user's
 * role grants the requested permission.
 *
 * Must be used **after** authenticateToken middleware so that `req.user`
 * is populated.
 *
 * Usage:
 *   router.post('/nodes', authenticateToken, requirePermission('process:write'), handler);
 */
export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!hasPermission(req.user.role, permission)) {
      return next(
        new AppError(
          `Insufficient permissions: '${permission}' required (your role: ${req.user.role})`,
          403,
        ),
      );
    }

    next();
  };
}

/** List all known roles. */
export const ROLES = Object.keys(ROLE_PERMISSIONS);

/** Get permissions for a role (returns empty array for unknown roles). */
export function getPermissionsForRole(role: string): string[] {
  return ROLE_PERMISSIONS[role] || [];
}
