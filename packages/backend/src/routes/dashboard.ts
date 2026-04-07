import { Router, Request, Response } from 'express';
import { valueStreams } from './process-catalog';
import { dataAssets } from './data-assets';
import { mappings } from './mappings';
import { systems } from './systems';
import { organizations } from './organizations';
import { people } from './people';

const router = Router();

/** GET /api/v1/dashboard/stats */
router.get('/stats', (_req: Request, res: Response) => {
  // Count all process hierarchy levels
  let processCount = 0;
  let subProcessCount = 0;
  let stepCount = 0;
  const allStepIds: string[] = [];

  for (const vs of valueStreams) {
    for (const proc of vs.processes) {
      processCount++;
      for (const sp of proc.subProcesses) {
        subProcessCount++;
        for (const step of sp.steps) {
          stepCount++;
          allStepIds.push(step.id);
        }
      }
    }
  }

  // Coverage: which steps have at least one mapping
  const mappedStepIds = new Set(mappings.map((m) => m.processStepId));
  const mappedCount = allStepIds.filter((id) => mappedStepIds.has(id)).length;
  const unmappedCount = stepCount - mappedCount;
  const coveragePercentage = stepCount > 0 ? Math.round((mappedCount / stepCount) * 100) : 0;

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
  const unmappedSteps = unmappedCount;

  // Ungoverned assets: BRONZE-tier assets that are linked to process steps
  const linkedAssetIds = new Set(mappings.map((m) => m.dataAssetId));
  const ungovernedAssets = dataAssets.filter(
    (a) => a.governanceTier === 'BRONZE' && linkedAssetIds.has(a.id),
  ).length;

  // Ownerless items: value streams with no owner (check if owner field exists)
  // Value streams and processes don't have owner fields in current schema,
  // so we count those without any assigned owner
  let ownerlessItems = 0;
  for (const vs of valueStreams) {
    if (!(vs as any).ownerId) ownerlessItems++;
    for (const proc of vs.processes) {
      if (!(proc as any).ownerId) ownerlessItems++;
    }
  }

  res.json({
    success: true,
    data: {
      valueStreams: valueStreams.length,
      processes: processCount,
      subProcesses: subProcessCount,
      steps: stepCount,
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
        unmappedSteps,
        ungovernedAssets,
        ownerlessItems,
      },
    },
  });
});

export default router;
