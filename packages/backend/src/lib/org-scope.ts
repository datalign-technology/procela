import { organizations } from '../routes/organizations';

// Org types that are allowed to own scoped governance artefacts —
// value streams, data assets, systems. Departments and teams
// inherit visibility from their parent company/division but can't
// themselves be owners. Lives here so every route enforcing the
// rule reads from one place rather than redefining ['company',
// 'division'] locally.
export const OWNERSHIP_LEVELS: readonly string[] = ['company', 'division'];

export function isOwnershipLevel(orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  const org = organizations.find((o) => o.id === orgId);
  if (!org) return false;
  return OWNERSHIP_LEVELS.includes(org.type);
}

/**
 * Returns the set of org IDs visible from a given scope org, including:
 * - The org itself
 * - All ancestors (parent, grandparent, up to root) — items defined at
 *   a higher level are "in scope" for children
 * - All descendants (children, grandchildren, etc.) — a parent-level
 *   user sees everything below
 *
 * This implements bidirectional cascading: a system defined at the
 * company level is visible to every division, and a company-level user
 * sees every division's items.
 *
 * When scopeOrgId is falsy, returns null (caller should treat as "no filter").
 */
export function getVisibleOrgScope(scopeOrgId: string | null | undefined): Set<string> | null {
  if (!scopeOrgId) return null;
  const visible = new Set<string>([scopeOrgId]);

  // Walk UP to ancestors — items at parent levels are in scope
  let current = organizations.find((o) => o.id === scopeOrgId);
  while (current?.parentId) {
    visible.add(current.parentId);
    current = organizations.find((o) => o.id === current!.parentId);
  }

  // Walk DOWN to descendants — items at child levels are in scope
  const queue = [scopeOrgId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of organizations) {
      if (child.parentId === id && !visible.has(child.id)) {
        visible.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return visible;
}

/**
 * Filter a collection by org visibility. If no scope is set (no orgId in
 * the query), returns the full collection unchanged.
 */
export function filterByOrgScope<T extends { orgId?: string; orgIds?: string[] }>(
  items: T[],
  scopeOrgId: string | null | undefined,
): T[] {
  const scope = getVisibleOrgScope(scopeOrgId);
  if (!scope) return items;
  return items.filter((item) => {
    if (item.orgId && scope.has(item.orgId)) return true;
    if (item.orgIds && item.orgIds.some((id) => scope.has(id))) return true;
    return false;
  });
}
