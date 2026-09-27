// ──────────────────────────────────────────────────────────────────────────
// MCP read model — the org-scoped catalog the read-only tools serve.
//
// This reuses the SAME repositories, org-tree scoping, governance-scope engine,
// and health helpers the rest of the backend (and the in-app AI assistant) use,
// so an MCP tool can never see anything a Viewer on that org couldn't, and can
// never diverge from the in-product truth. Repos are built once at module load
// (as routes/chat.ts does) and reused.
// ──────────────────────────────────────────────────────────────────────────

import { processNodes, type ProcessNode } from '../routes/process-catalog';
import { dataAssets, type StoredDataAsset } from '../routes/data-assets';
import { systems, type StoredSystem } from '../routes/systems';
import { dataDomains, type StoredDataDomain } from '../routes/data-domains';
import { mappings, type StoredMapping } from '../routes/mappings';
import { people, type StoredPerson } from '../routes/people';
import { dataQualityRules } from '../routes/data-quality';

import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getMappingsRepository } from '../db/mappings.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getDataQualityRulesRepository } from '../db/data-quality-rules.repo';

import { filterByOrgScope } from '../lib/org-scope';
import { countMeasuredRulesByAsset, effectiveHealthScore } from '../lib/asset-health';
import { resolveProgramScope, type ResolvedScope } from '../lib/governance-scope';
import { getProgramScopeForOrg } from '../routes/governance-program';

// One repo per store, built once (Prisma-backed when DATABASE_URL is set, else
// the JSON-array store) — never rebuilt per request.
const nodesRepo = getProcessNodesRepository(processNodes);
const assetsRepo = getDataAssetsRepository(dataAssets);
const systemsRepo = getSystemsRepository(systems);
const domainsRepo = getDataDomainsRepository(dataDomains);
const mappingsRepo = getMappingsRepository(mappings);
const peopleRepo = getPeopleRepository(people);
const dqRepo = getDataQualityRulesRepository(dataQualityRules);

export type { ProcessNode, StoredDataAsset, StoredSystem, StoredDataDomain, StoredMapping };
/** The resolved governed-entity sets (or null ⇒ govern everything). */
export type ResolvedScopeLike = ResolvedScope;

export interface OrgCatalog {
  orgId: string;
  nodes: ProcessNode[];
  assets: StoredDataAsset[];
  systems: StoredSystem[];
  domains: StoredDataDomain[];
  mappings: StoredMapping[];
  /** Resolve a person id to a display name (or null if unknown/unset). */
  nameOf(personId: string | null | undefined): string | null;
  /** Effective health for an asset: the measured DQ score, or 0 when no rule
   *  backs it — with a flag saying which. */
  healthOf(asset: StoredDataAsset): { score: number; measured: boolean };
}

/** Load every entity the tools need, scoped to `orgId` by the same org-tree
 *  cascade the rest of the app uses (`filterByOrgScope`). */
export async function loadOrgCatalog(orgId: string): Promise<OrgCatalog> {
  const [allNodes, allAssets, allSystems, allDomains, allMaps, allPeople, allDq] = await Promise.all([
    nodesRepo.list(), assetsRepo.list(), systemsRepo.list(), domainsRepo.list(),
    mappingsRepo.list(), peopleRepo.list(), dqRepo.list(),
  ]);
  const nodes = filterByOrgScope(allNodes, orgId);
  const assets = filterByOrgScope(allAssets, orgId);
  const systemsScoped = filterByOrgScope(allSystems, orgId);
  const domains = filterByOrgScope(allDomains, orgId);
  const maps = filterByOrgScope(allMaps, orgId);
  const peopleScoped = filterByOrgScope(allPeople as Array<StoredPerson & { orgId?: string }>, orgId);
  const dq = filterByOrgScope(allDq as Array<{ orgId?: string }>, orgId) as typeof allDq;

  const nameById = new Map(peopleScoped.map((p) => [p.id, p.name]));
  const measuredByAsset = countMeasuredRulesByAsset(dq);

  return {
    orgId,
    nodes, assets, systems: systemsScoped, domains, mappings: maps,
    nameOf: (id) => (id ? nameById.get(id) ?? null : null),
    healthOf: (asset) => {
      const measured = measuredByAsset.get(asset.id) ?? 0;
      return { score: effectiveHealthScore(asset.healthScore, measured), measured: measured > 0 };
    },
  };
}

/** The person id accountable for an entity, across the differing field names
 *  (process/domain use `ownerId`; asset/system use `ownerPersonId`). */
export function ownerIdOf(
  kind: 'process' | 'asset' | 'system' | 'domain',
  e: ProcessNode | StoredDataAsset | StoredSystem | StoredDataDomain,
): string | null {
  if (kind === 'process') return (e as ProcessNode).ownerId ?? null;
  if (kind === 'domain') return (e as StoredDataDomain).ownerId ?? null;
  if (kind === 'asset') return (e as StoredDataAsset).ownerPersonId ?? null;
  return (e as StoredSystem).ownerPersonId ?? null;
}

/** Resolve the governance program scope for an org against a loaded catalog.
 *  Returns null when no scope is defined ⇒ the whole catalog is governed. */
export async function resolveOrgScope(cat: OrgCatalog): Promise<ResolvedScope | null> {
  const anchors = await getProgramScopeForOrg(cat.orgId);
  return resolveProgramScope(anchors, {
    nodes: cat.nodes.map((n) => ({ id: n.id, parentId: n.parentId, systemIds: (n as { systemIds?: string[] }).systemIds })),
    domains: cat.domains.map((d) => ({ id: d.id, parentDomainId: d.parentDomainId, dataAssetIds: d.dataAssetIds })),
    assets: cat.assets.map((a) => ({ id: a.id, systemId: a.systemId })),
    systems: cat.systems.map((s) => ({ id: s.id })),
  });
}

// ── Gap computation (mirrors routes/chat.ts's inline logic) ────────────────

export interface CatalogGaps {
  unmappedActivities: ProcessNode[];       // activities with no data mapped
  ownerlessProcesses: ProcessNode[];       // value streams / processes with no owner
  ungovernedCriticalAssets: StoredDataAsset[]; // Bronze-tier assets that support a process
  lowHealthAssets: StoredDataAsset[];      // measured health < 80
  orphanAssets: StoredDataAsset[];         // catalogued but no process step uses them
  ownerlessDomains: StoredDataDomain[];    // domains with no owner
}

export function computeGaps(cat: OrgCatalog): CatalogGaps {
  const mappedActivityIds = new Set(cat.mappings.map((m) => m.processStepId));
  const linkedAssetIds = new Set(cat.mappings.filter((m) => !!m.dataAssetId).map((m) => m.dataAssetId as string));
  const activities = cat.nodes.filter((n) => n.level === 'ACTIVITY');
  return {
    unmappedActivities: activities.filter((n) => !mappedActivityIds.has(n.id)),
    ownerlessProcesses: cat.nodes.filter((n) => (n.level === 'VALUE_STREAM' || n.level === 'PROCESS') && !n.ownerId),
    ungovernedCriticalAssets: cat.assets.filter((a) => a.governanceTier === 'BRONZE' && linkedAssetIds.has(a.id)),
    lowHealthAssets: cat.assets.filter((a) => { const h = cat.healthOf(a); return h.measured && h.score < 80; }),
    orphanAssets: cat.assets.filter((a) => !linkedAssetIds.has(a.id)),
    ownerlessDomains: cat.domains.filter((d) => !d.ownerId),
  };
}

/** Ancestor chain (value stream → … → node) for a process node, for context in
 *  reverse lookups. Returns names from the node up to its value stream. */
export function ancestorTrail(cat: OrgCatalog, nodeId: string): string[] {
  const byId = new Map(cat.nodes.map((n) => [n.id, n]));
  const trail: string[] = [];
  let cur = byId.get(nodeId) ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    trail.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null;
  }
  return trail;
}
