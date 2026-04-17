import { Router, Request, Response } from 'express';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { dataDomains } from './data-domains';
import { people } from './people';

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
    ? processNodes.filter((n) => n.orgId === orgId || n.orgIds?.includes(orgId as string))
    : processNodes;
  const assets = orgId
    ? dataAssets.filter((a) => a.orgId === orgId)
    : dataAssets;
  const domains = orgId
    ? dataDomains.filter((d) => d.orgId === orgId)
    : dataDomains;

  // Load mappings lazily to avoid circular deps
  let mappings: any[] = [];
  try { mappings = require('./mappings').mappings || []; } catch { /* */ }
  const filteredMappings = orgId
    ? mappings.filter((m: any) => m.orgId === orgId)
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
    ? people.filter((p) => p.orgIds?.includes(orgId as string))
    : people;
  const unassignedPeople = allPeople
    .filter((p) => !ownerIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));

  const summary = {
    unmappedSteps: unmappedSteps.length,
    ungovernedAssets: ungovernedAssets.length,
    lowHealthAssets: lowHealthAssets.length,
    ownerlessProcesses: ownerlessProcesses.length,
    unownedDomains: unownedDomains.length,
    orphanedAssets: orphanedAssets.length,
    unlinkedAssets: unlinkedAssets.length,
    unassignedPeople: unassignedPeople.length,
    totalGaps: unmappedSteps.length + ungovernedAssets.length + ownerlessProcesses.length
      + unownedDomains.length + orphanedAssets.length + unlinkedAssets.length,
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
    },
    summary,
  });
});

export default router;
