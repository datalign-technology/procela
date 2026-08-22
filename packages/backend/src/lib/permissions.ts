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

// Read permissions every authenticated role gets. Higher roles are
// supersets of VIEWER, so the whole catalog stays readable to anyone
// signed in — the enforcement layer gates *writes*, not reads. The
// genuinely sensitive read surfaces (agent, audit, backup, admin) are
// deliberately absent here and granted only to elevated roles below.
const BASE_READS = [
  'process:read', 'system:read', 'data-asset:read', 'mapping:read',
  'org:read', 'people:read', 'governance:read', 'collaboration:read',
  'connection:read', 'skill:read',
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ORG_ADMIN: [
    'org:*', 'process:*', 'system:*', 'data-asset:*', 'mapping:*', 'people:*',
    'governance:*', 'connection:*', 'agent:*', 'collaboration:*', 'skill:*',
    'audit:*', 'admin:*',
  ],
  // EDITOR is the merged former PROCESS_OWNER + DATA_STEWARD: full
  // write over the process catalog and the data/system registry,
  // plus connections and the skills catalog. No governance/people/org
  // writes (admin only).
  EDITOR: [
    ...BASE_READS,
    'process:write', 'system:write', 'data-asset:write', 'mapping:write',
    'connection:write', 'collaboration:write', 'skill:write',
  ],
  // CONTRIBUTOR authors processes and collaborates, but does not
  // write the data/system registry, mappings, or governance.
  CONTRIBUTOR: [
    ...BASE_READS,
    'process:write', 'collaboration:write',
  ],
  // VIEWER is read-only across the catalog.
  VIEWER: [...BASE_READS],
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

/**
 * Map an HTTP method to the coarse action the permission model
 * understands. Reads never mutate; everything else is a write.
 * OPTIONS is treated as a read so CORS preflight is never gated.
 */
export function actionForMethod(method: string): 'read' | 'write' {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' ? 'read' : 'write';
}

/**
 * Router-level authorization guard, applied once at the mount point in
 * index.ts (e.g. `app.use('/api/v1/data-assets', authenticateToken,
 * requireResource('data-asset'), dataAssetsRouter)`).
 *
 * It derives the required permission from the request method —
 * GET/HEAD → `<resource>:read`, any mutating verb → `<resource>:write`
 * — and defers to hasPermission. This is the coarse first layer of
 * enforcement: it closes the "any authenticated user can write"
 * hole uniformly across a router without touching each handler.
 * Per-record ("assigned") checks, where needed, live in the handlers.
 *
 * Must run **after** authenticateToken so `req.user` is populated.
 */
export function requireResource(resource: string) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    const action = actionForMethod(req.method);
    const permission = `${resource}:${action}`;
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
