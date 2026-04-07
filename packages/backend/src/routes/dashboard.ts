import { Router, Request, Response } from 'express';
import { processNodes, flowRelationships, NODE_LEVELS } from './process-catalog';
import { dataAssets } from './data-assets';
import { mappings } from './mappings';
import { systems } from './systems';
import { organizations } from './organizations';
import { people } from './people';

const router = Router();

/** GET /api/v1/dashboard/stats */
router.get('/stats', (_req: Request, res: Response) => {
  // Count by level
  const byLevel = Object.fromEntries(
    NODE_LEVELS.map((l) => [l, processNodes.filter((n) => n.level === l).length])
  );

  const activityIds = processNodes.filter((n) => n.level === 'ACTIVITY').map((n) => n.id);

  // Coverage: which activities have at least one mapping
  const mappedActivityIds = new Set(mappings.map((m) => m.processStepId));
  const mappedCount = activityIds.filter((id) => mappedActivityIds.has(id)).length;
  const unmappedCount = activityIds.length - mappedCount;
  const coveragePercentage = activityIds.length > 0 ? Math.round((mappedCount / activityIds.length) * 100) : 0;

  // Governance tiers
  const bronze = dataAssets.filter((a) => a.governanceTier === 'BRONZE').length;
  const silver = dataAssets.filter((a) => a.governanceTier === 'SILVER').length;
  const gold = dataAssets.filter((a) => a.governanceTier === 'GOLD').length;

  // Average health
  const averageHealth =
    dataAssets.length > 0
      ? Math.round(dataAssets.reduce((sum, a) => sum + a.healthScore, 0) / dataAssets.length)
      : 0;

  // Gaps
  const linkedAssetIds = new Set(mappings.map((m) => m.dataAssetId));
  const ungovernedAssets = dataAssets.filter(
    (a) => a.governanceTier === 'BRONZE' && linkedAssetIds.has(a.id),
  ).length;

  const ownerlessItems = processNodes.filter(
    (n) => ['VALUE_STREAM', 'PROCESS'].includes(n.level) && !n.ownerId
  ).length;

  res.json({
    success: true,
    data: {
      totalNodes: processNodes.length,
      byLevel,
      valueStreams: byLevel.VALUE_STREAM || 0,
      processes: byLevel.PROCESS || 0,
      activities: byLevel.ACTIVITY || 0,
      flows: flowRelationships.length,
      systems: systems.length,
      dataAssets: dataAssets.length,
      mappings: mappings.length,
      organizations: organizations.length,
      people: people.length,
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
