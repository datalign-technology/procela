import { Router, Request, Response } from 'express';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { dataDomains } from './data-domains';
import { people } from './people';
import { connections, systemIdsForConnection } from './connections';
import { systems } from './systems';
import { getVisibleOrgScope, filterByOrgScope } from '../lib/org-scope';

const router = Router();

const MAPPABLE_LEVELS = new Set(['ACTIVITY', 'TASK', 'EXECUTION']);

function findAncestorPath(nodeId: string): { valueStream?: string; process?: string; activity?: string } {
  const result: Record<string, string> = {};
  let current = processNodes.find((n) => n.id === nodeId);
  while (current) {
    const level = current.level.toLowerCase().replace('_', ' ');
    if (current.level === 'VALUE_STREAM') result.valueStream = current.name;
    else if (current.level === 'PROCESS') result.process = current.name;
    else if (current.level === 'SUBPROCESS') result.subProcess = current.name;
    if (!current.parentId) break;
    current = processNodes.find((n) => n.id === current!.parentId);
  }
  return result;
}

router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;

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

  // Load mappings lazily to avoid circular deps
  let mappings: any[] = [];
  try { mappings = require('./mappings').mappings || []; } catch { /* */ }
  const filteredMappings = orgId
    ? filterByOrgScope(mappings, orgId as string)
    : mappings;

  const mappedStepIds = new Set(filteredMappings.map((m: any) => m.processStepId));
  const mappedAssetIds = new Set(filteredMappings.map((m: any) => m.dataAssetId));

  // 1. Unmapped activities — process nodes at mappable levels with no mapping
  const unmappedSteps = nodes
    .filter((n) => MAPPABLE_LEVELS.has(n.level) && !mappedStepIds.has(n.id))
    .map((n) => {
      const path = findAncestorPath(n.id);
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
  const unassignedConnections = orgScopedConnections
    .filter((c) => systemIdsForConnection(c.id).length === 0)
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

  const summary = {
    unmappedSteps: unmappedSteps.length,
    ungovernedAssets: ungovernedAssets.length,
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
      + duplicateAssetNames.length,
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
    },
    summary,
  });
});

export default router;
