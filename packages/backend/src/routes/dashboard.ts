import { Router, Request, Response } from 'express';
import { processNodes, flowRelationships, NODE_LEVELS } from './process-catalog';
import { dataAssets } from './data-assets';
import { mappings } from './mappings';
import { systems } from './systems';
import { organizations } from './organizations';
import { people } from './people';

const router = Router();

/** GET /api/v1/dashboard/stats */
router.get('/stats', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  const filteredNodes = oid ? processNodes.filter((n) => n.orgIds.includes(oid) || n.orgId === oid) : processNodes;
  const filteredAssets = oid ? dataAssets.filter((a) => a.orgId === oid) : dataAssets;
  const filteredMappings = oid ? mappings.filter((m) => m.orgId === oid) : mappings;
  const filteredSystems = oid ? systems.filter((s) => s.orgId === oid) : systems;
  const filteredPeople = oid ? people.filter((p) => p.orgId === oid) : people;
  const filteredFlows = oid ? flowRelationships.filter((f) => {
    const from = processNodes.find((n) => n.id === f.fromNodeId);
    return from && (from.orgIds.includes(oid) || from.orgId === oid);
  }) : flowRelationships;

  // Count by level
  const byLevel = Object.fromEntries(
    NODE_LEVELS.map((l) => [l, filteredNodes.filter((n) => n.level === l).length])
  );

  const activityIds = filteredNodes.filter((n) => n.level === 'ACTIVITY').map((n) => n.id);

  // Coverage: which activities have at least one mapping
  const mappedActivityIds = new Set(filteredMappings.map((m) => m.processStepId));
  const mappedCount = activityIds.filter((id) => mappedActivityIds.has(id)).length;
  const unmappedCount = activityIds.length - mappedCount;
  const coveragePercentage = activityIds.length > 0 ? Math.round((mappedCount / activityIds.length) * 100) : 0;

  // Governance tiers
  const bronze = filteredAssets.filter((a) => a.governanceTier === 'BRONZE').length;
  const silver = filteredAssets.filter((a) => a.governanceTier === 'SILVER').length;
  const gold = filteredAssets.filter((a) => a.governanceTier === 'GOLD').length;

  // Average health
  const averageHealth =
    filteredAssets.length > 0
      ? Math.round(filteredAssets.reduce((sum, a) => sum + a.healthScore, 0) / filteredAssets.length)
      : 0;

  // Gaps
  const linkedAssetIds = new Set(filteredMappings.map((m) => m.dataAssetId));
  const ungovernedAssets = filteredAssets.filter(
    (a) => a.governanceTier === 'BRONZE' && linkedAssetIds.has(a.id),
  ).length;

  const ownerlessItems = filteredNodes.filter(
    (n) => ['VALUE_STREAM', 'PROCESS'].includes(n.level) && !n.ownerId
  ).length;

  res.json({
    success: true,
    data: {
      totalNodes: filteredNodes.length,
      byLevel,
      valueStreams: byLevel.VALUE_STREAM || 0,
      processes: byLevel.PROCESS || 0,
      activities: byLevel.ACTIVITY || 0,
      flows: filteredFlows.length,
      systems: filteredSystems.length,
      dataAssets: filteredAssets.length,
      mappings: filteredMappings.length,
      organizations: organizations.length,
      people: filteredPeople.length,
      coverage: {
        mapped: mappedCount,
        unmapped: unmappedCount,
        percentage: coveragePercentage,
      },
      governance: { bronze, silver, gold },
      averageHealth,
      gaps: {
        unmappedActivities: unmappedCount,
        ungovernedAssets,
        ownerlessItems,
      },
    },
  });
});

export default router;
