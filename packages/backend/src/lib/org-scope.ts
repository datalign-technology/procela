import { organizations } from '../routes/organizations';

/**
 * Returns the set of org IDs visible from a given scope org, including
 * the org itself and all of its descendants in the org tree.
 *
 * This implements "cascading visibility" — a user viewing a company-level
 * org sees everything across its divisions, departments, teams, and units.
 * A user viewing a specific division sees only that division's subtree.
 *
 * When scopeOrgId is falsy, returns null (caller should treat as "no filter").
 */
export function getVisibleOrgScope(scopeOrgId: string | null | undefined): Set<string> | null {
  if (!scopeOrgId) return null;
  const visible = new Set<string>([scopeOrgId]);
  const queue = [scopeOrgId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of organizations) {
      if (child.parentId === current && !visible.has(child.id)) {
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
