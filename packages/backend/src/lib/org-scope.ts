import { organizations, type StoredOrg } from '../routes/organizations';
import { getOrganizationsRepository } from '../db/organizations.repo';
import { hasDatabase } from '../db/prisma';

// Org types that are allowed to own scoped governance artefacts —
// value streams, data assets, systems. Departments and teams
// inherit visibility from their parent company/division but can't
// themselves be owners. Lives here so every route enforcing the
// rule reads from one place rather than redefining ['company',
// 'division'] locally.
export const OWNERSHIP_LEVELS: readonly string[] = ['company', 'division'];

// ──────────────────────────────────────────────────────────────────────────
// Org source (Postgres cutover, PR 4)
//
// org-scope is called synchronously from ~24 route modules to enforce org
// visibility. In JSON mode it reads the live in-memory `organizations` array.
// In Postgres mode that array is stale boot-state, so we serve a cached
// snapshot refreshed from the repository: hydrated at boot via initOrgScope(),
// then refreshed in the background on a short TTL. The org tree is small,
// slowly-changing reference data, so a few seconds of staleness is an
// acceptable trade-off for keeping the read path synchronous — and the cache is
// only ever *under*-inclusive while cold (never over-inclusive), so a brief
// gap can hide rolled-down items but can never leak another org's data.
//
// The scoping logic itself is factored into pure `*In(orgs, …)` helpers that
// take the org list explicitly; the exported API wraps them over orgSource().
// ──────────────────────────────────────────────────────────────────────────
type OrgLike = Pick<StoredOrg, 'id' | 'parentId' | 'type'>;

const orgRepo = getOrganizationsRepository(organizations);
let orgCache: StoredOrg[] | null = null;
let orgCacheAt = 0;
const ORG_CACHE_TTL_MS = 5000;

/** Refresh the cached org snapshot from the repository. */
export async function refreshOrgScopeCache(): Promise<void> {
  orgCache = await orgRepo.list();
  orgCacheAt = Date.now();
}

/** Hydrate the cache at boot. No-op in JSON mode (the live array is the source). */
export async function initOrgScope(): Promise<void> {
  if (hasDatabase()) await refreshOrgScopeCache();
}

/**
 * Refresh the cache immediately after an org mutation so the synchronous
 * scope checks (isOwnershipLevel / getVisibleOrgScope) reflect the change on
 * the very next request instead of waiting out the TTL. Without this, a
 * caller that creates an org and then creates a system owned by it in the
 * same burst (e.g. the seed scripts) is rejected because the new org isn't in
 * the cached snapshot yet. No-op in JSON mode, where orgSource() already reads
 * the live array.
 */
export async function invalidateOrgScopeCache(): Promise<void> {
  if (hasDatabase()) await refreshOrgScopeCache();
}

function orgSource(): readonly OrgLike[] {
  if (!hasDatabase()) return organizations;
  if (orgCache && Date.now() - orgCacheAt <= ORG_CACHE_TTL_MS) return orgCache;
  // Stale or cold: kick a background refresh and serve the last snapshot
  // (or the array as a cold-start fallback) meanwhile.
  void refreshOrgScopeCache();
  return orgCache ?? organizations;
}

/**
 * The full cached org list (StoredOrg, not the narrowed OrgLike) for callers
 * that need names/etc. and do their own tree-walking — notably the exported
 * access-control helpers in routes/people.ts, which must see PG orgs in DB
 * mode. Same cache + TTL as orgSource(); returns the live array in JSON mode.
 */
export function getCachedOrgList(): readonly StoredOrg[] {
  if (!hasDatabase()) return organizations;
  if (orgCache && Date.now() - orgCacheAt <= ORG_CACHE_TTL_MS) return orgCache;
  void refreshOrgScopeCache();
  return orgCache ?? organizations;
}

// ── Pure scoping logic — operate on an explicit org list (exported for tests) ──

export function ownershipLevelIn(orgs: readonly OrgLike[], orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  const org = orgs.find((o) => o.id === orgId);
  if (!org) return false;
  return OWNERSHIP_LEVELS.includes(org.type);
}

export function visibleOrgScopeIn(
  orgs: readonly OrgLike[],
  scopeOrgId: string | null | undefined,
): Set<string> | null {
  if (!scopeOrgId) return null;
  const visible = new Set<string>([scopeOrgId]);

  // Walk UP to ancestors — items at parent levels are in scope.
  let current = orgs.find((o) => o.id === scopeOrgId);
  while (current?.parentId) {
    visible.add(current.parentId);
    current = orgs.find((o) => o.id === current!.parentId);
  }

  // Walk DOWN to descendants — items at child levels are in scope.
  const queue = [scopeOrgId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of orgs) {
      if (child.parentId === id && !visible.has(child.id)) {
        visible.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return visible;
}

export function ancestorOrgIdsIn(
  orgs: readonly OrgLike[],
  scopeOrgId: string | null | undefined,
): Set<string> | null {
  if (!scopeOrgId) return null;
  const ancestors = new Set<string>();
  let current = orgs.find((o) => o.id === scopeOrgId);
  while (current?.parentId) {
    ancestors.add(current.parentId);
    current = orgs.find((o) => o.id === current!.parentId);
  }
  return ancestors;
}

// ── Public API (unchanged signatures — callers are untouched) ──

export function isOwnershipLevel(orgId: string | null | undefined): boolean {
  return ownershipLevelIn(orgSource(), orgId);
}

/**
 * Returns the set of org IDs visible from a given scope org, including the org
 * itself, all ancestors (items defined higher up roll down), and all
 * descendants (a parent-level user sees everything below). Bidirectional
 * cascading. Returns null when scopeOrgId is falsy (caller treats as "no
 * filter").
 */
export function getVisibleOrgScope(scopeOrgId: string | null | undefined): Set<string> | null {
  return visibleOrgScopeIn(orgSource(), scopeOrgId);
}

/**
 * Filter a collection by org visibility. If no scope is set (no orgId in the
 * query), returns the full collection unchanged.
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

/**
 * Returns the set of org IDs that are STRICT ancestors of the given scope org —
 * parent up to root, but NOT the scope org itself and not any descendants. Used
 * by the process catalog to detect content defined above the current scope that
 * has merely rolled down to it. Returns null when no scope is set.
 */
export function getAncestorOrgIds(scopeOrgId: string | null | undefined): Set<string> | null {
  return ancestorOrgIdsIn(orgSource(), scopeOrgId);
}
