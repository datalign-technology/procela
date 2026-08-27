import { Router, Request, Response } from 'express';
import { processNodes } from './process-catalog';
import { dataAssets, dataAssetColumns } from './data-assets';
import { getDataAssetColumnsRepository } from '../db/data-asset-columns.repo';
import { getDataQualityRulesRepository } from '../db/data-quality-rules.repo';
import { dataDomains } from './data-domains';
import { people } from './people';
import { connections, connectionSystemLinks } from './connections';
import { getConnectionSystemLinksRepository } from '../db/connection-system-links.repo';
import { systems } from './systems';
import { getVisibleOrgScope, filterByOrgScope } from '../lib/org-scope';
// Gap detection is a read aggregator across 7 stores; each is read through
// its repository so gaps are computed from Postgres in DB mode and the
// in-memory array in JSON mode (the factory wraps the same array these
// modules export). PR 9b.8.
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getConnectionsRepository } from '../db/connections.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getMappingsRepository } from '../db/mappings.repo';
import { mappings } from './mappings';

const processNodesRepo = getProcessNodesRepository(processNodes);
const dataAssetsRepo = getDataAssetsRepository(dataAssets);
const dataDomainsRepo = getDataDomainsRepository(dataDomains);
const peopleRepo = getPeopleRepository(people);
const connectionsRepo = getConnectionsRepository(connections);
const systemsRepo = getSystemsRepository(systems);
const mappingsRepo = getMappingsRepository(mappings);
const connectionSystemLinksRepo = getConnectionSystemLinksRepository(connectionSystemLinks);
const dataAssetColumnsRepo = getDataAssetColumnsRepository(dataAssetColumns);

const router = Router();

const MAPPABLE_LEVELS = new Set(['ACTIVITY', 'TASK', 'EXECUTION']);

// Takes the (repo-loaded) node set so it walks the same snapshot the
// handler read, rather than the stale module array.
function findAncestorPath(nodeId: string, nodes: typeof processNodes): { valueStream?: string; process?: string; activity?: string } {
  const result: Record<string, string> = {};
  let current = nodes.find((n) => n.id === nodeId);
  while (current) {
    const level = current.level.toLowerCase().replace('_', ' ');
    if (current.level === 'VALUE_STREAM') result.valueStream = current.name;
    else if (current.level === 'PROCESS') result.process = current.name;
    else if (current.level === 'SUBPROCESS') result.subProcess = current.name;
    if (!current.parentId) break;
    current = nodes.find((n) => n.id === current!.parentId);
  }
  return result;
}

router.get('/', async (req: Request, res: Response) => {
  const { orgId } = req.query;

  // Each store read through its repository (Postgres in DB mode, the
  // in-memory array in JSON mode); local consts shadow the imports.
  const [processNodes, dataAssets, dataDomains, people, connections, systems, mappings] = await Promise.all([
    processNodesRepo.list(), dataAssetsRepo.list(), dataDomainsRepo.list(),
    peopleRepo.list(), connectionsRepo.list(), systemsRepo.list(), mappingsRepo.list(),
  ]);

  // Scope by org
  const nodes = orgId
    ? (() => {
        const scope = getVisibleOrgScope(orgId as string)!;
        return processNodes.filter((n) => scope.has(n.orgId) || (n.orgIds || []).some((id) => scope.has(id)));
      })()
    : processNodes;
  const assets = orgId
    ? filterByOrgScope(dataAssets, orgId as string)
    : dataAssets;
  const domains = orgId
    ? filterByOrgScope(dataDomains, orgId as string)
    : dataDomains;

  const filteredMappings = orgId
    ? filterByOrgScope(mappings, orgId as string)
    : mappings;

  const mappedStepIds = new Set(filteredMappings.map((m: any) => m.processStepId));
  const mappedAssetIds = new Set(filteredMappings.map((m: any) => m.dataAssetId));

  // 1. Unmapped activities — process nodes at mappable levels with no mapping
  const unmappedSteps = nodes
    .filter((n) => MAPPABLE_LEVELS.has(n.level) && !mappedStepIds.has(n.id))
    .map((n) => {
      const path = findAncestorPath(n.id, processNodes);
      return {
        id: n.id,
        name: n.name,
        level: n.level,
        status: n.status,
        path,
      };
    });

  // 2. Ungoverned assets — BRONZE tier assets linked to process steps
  const ungovernedAssets = assets
    .filter((a) => a.governanceTier === 'BRONZE' && mappedAssetIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      governanceTier: a.governanceTier,
      healthScore: a.healthScore,
    }));

  // 3. Low-health assets — assets with health < 50 that are linked to processes
  const lowHealthAssets = assets
    .filter((a) => a.healthScore < 50 && a.healthScore > 0 && mappedAssetIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      healthScore: a.healthScore,
      governanceTier: a.governanceTier,
    }));

  // 4. Ownership gaps — value streams and processes without an owner
  const ownerlessProcesses = nodes
    .filter((n) => (n.level === 'VALUE_STREAM' || n.level === 'PROCESS') && !n.ownerId)
    .map((n) => ({
      id: n.id,
      name: n.name,
      level: n.level,
      status: n.status,
    }));

  // 5. Unowned domains — domains without an owner
  const unownedDomains = domains
    .filter((d) => !d.ownerId)
    .map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      assetCount: d.dataAssetIds.length,
    }));

  // 6. Orphaned assets — assets not in any domain
  const allDomainAssetIds = new Set(domains.flatMap((d) => d.dataAssetIds));
  const orphanedAssets = assets
    .filter((a) => !allDomainAssetIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      governanceTier: a.governanceTier,
      healthScore: a.healthScore,
    }));

  // 7. Unlinked assets — assets with no mapping to any process
  const unlinkedAssets = assets
    .filter((a) => !mappedAssetIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      governanceTier: a.governanceTier,
    }));

  // 8. People without assignments — people with no ownership anywhere
  const ownerIds = new Set<string>();
  for (const n of nodes) { if (n.ownerId) ownerIds.add(n.ownerId); }
  for (const a of assets) {
    if (a.owner) ownerIds.add(a.owner);
    for (const sid of a.stewardIds || []) ownerIds.add(sid);
  }
  for (const d of domains) {
    if (d.ownerId) ownerIds.add(d.ownerId);
    for (const sid of d.stewardIds) ownerIds.add(sid);
  }

  const allPeople = orgId
    ? (() => {
        const scope = getVisibleOrgScope(orgId as string)!;
        return people.filter((p) => (p.orgIds || []).some((id) => scope.has(id)));
      })()
    : people;
  const unassignedPeople = allPeople
    .filter((p) => !ownerIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));

  // 9. Connections without a system — registered but not yet wired into
  // the business view. Filter to the visible org scope when one was
  // provided so the gap respects multi-tenant boundaries.
  const orgScopedConnections = orgId
    ? filterByOrgScope(connections, orgId as string)
    : connections;
  // Which connections have at least one linked system — read the link
  // table through its repository (the raw array is empty in Postgres mode).
  const allLinks = await connectionSystemLinksRepo.list();
  const connectionsWithSystems = new Set(allLinks.map((l) => l.connectionId));
  const unassignedConnections = orgScopedConnections
    .filter((c) => !connectionsWithSystems.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, connectionType: c.connectionType, status: c.status }));

  // 10. Ownerless systems — INTEGRATED systems with no business owner
  // assigned. MANUAL/EXTERNAL systems often live outside Procela's
  // ownership model so we don't penalise them here.
  const orgScopedSystems = orgId
    ? filterByOrgScope(systems, orgId as string)
    : systems;
  const ownerlessSystems = orgScopedSystems
    .filter((s) => (s.connectivity || 'INTEGRATED') === 'INTEGRATED' && !s.ownerPersonId)
    .map((s) => ({ id: s.id, name: s.name, systemType: s.systemType, businessCriticality: s.businessCriticality }));

  // 11. Duplicate-named data assets — same name (case-insensitive, trim)
  // appears on >1 asset in the same org. Sometimes legitimate (two
  // divisions both have "Customer Accounts") but worth surfacing so
  // the user can decide to merge or rename.
  const duplicateAssetNames: Array<{ name: string; assets: Array<{ id: string; name: string }> }> = [];
  const nameGroups = new Map<string, Array<{ id: string; name: string }>>();
  for (const a of assets) {
    const key = (a.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push({ id: a.id, name: a.name });
  }
  for (const [, members] of nameGroups) {
    if (members.length > 1) {
      duplicateAssetNames.push({ name: members[0].name, assets: members });
    }
  }

  // 12. Ungoverned bound columns — a column that carries a physical source
  // pointer (i.e. the asset was bound to it) but has NO data-quality rule.
  // Binding a column declares "this matters"; a bound column with no rule is
  // scope you claimed but never measure. This is the column-level coverage
  // gap that column-set bindings surface — asset-level linkage can look
  // complete while individual bound columns go unmeasured.
  // Read through the persistence-aware repo — the raw in-memory
  // `dataQualityRules` array is empty under Postgres (rules live in the DB),
  // which would make every bound column look ungoverned. Same fix as
  // enrichColumnsWithDq in data-assets.
  let dqRules: Array<{ dataAssetId: string; columnId?: string }> = [];
  try { dqRules = await getDataQualityRulesRepository(require('./data-quality').dataQualityRules).list(); } catch { /* */ }
  const ruledColumnIds = new Set(dqRules.map((r) => r.columnId).filter(Boolean) as string[]);
  const allColumns = await dataAssetColumnsRepo.list();
  const assetIdsInScope = new Set(assets.map((a) => a.id));
  const assetNameById = new Map(assets.map((a) => [a.id, a.name] as const));
  const ungovernedByAsset = new Map<string, string[]>();
  for (const col of allColumns) {
    if (!assetIdsInScope.has(col.dataAssetId)) continue;
    if (!col.sourceColumn) continue;            // only bound (physical) columns
    if (ruledColumnIds.has(col.id)) continue;   // already has at least one rule
    if (!ungovernedByAsset.has(col.dataAssetId)) ungovernedByAsset.set(col.dataAssetId, []);
    ungovernedByAsset.get(col.dataAssetId)!.push(col.columnName);
  }
  const ungovernedColumns = [...ungovernedByAsset.entries()].map(([assetId, columns]) => ({
    assetId,
    assetName: assetNameById.get(assetId) || assetId,
    columns,
    count: columns.length,
  }));

  const summary = {
    unmappedSteps: unmappedSteps.length,
    ungovernedAssets: ungovernedAssets.length,
    ungovernedColumns: ungovernedColumns.reduce((s, g) => s + g.count, 0),
    lowHealthAssets: lowHealthAssets.length,
    ownerlessProcesses: ownerlessProcesses.length,
    unownedDomains: unownedDomains.length,
    orphanedAssets: orphanedAssets.length,
    unlinkedAssets: unlinkedAssets.length,
    unassignedPeople: unassignedPeople.length,
    unassignedConnections: unassignedConnections.length,
    ownerlessSystems: ownerlessSystems.length,
    duplicateAssetNames: duplicateAssetNames.length,
    totalGaps: unmappedSteps.length + ungovernedAssets.length + ownerlessProcesses.length
      + unownedDomains.length + orphanedAssets.length + unlinkedAssets.length
      + unassignedConnections.length + ownerlessSystems.length
      + duplicateAssetNames.length
      + ungovernedColumns.reduce((s, g) => s + g.count, 0),
  };

  res.json({
    success: true,
    data: {
      unmappedSteps,
      ungovernedAssets,
      lowHealthAssets,
      ownerlessProcesses,
      unownedDomains,
      orphanedAssets,
      unlinkedAssets,
      unassignedPeople,
      unassignedConnections,
      ownerlessSystems,
      duplicateAssetNames,
      ungovernedColumns,
    },
    summary,
  });
});

export default router;
