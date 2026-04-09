import { Router, Request, Response } from 'express';
import { processNodes, flowRelationships, NODE_LEVELS } from './process-catalog';
import { dataAssets } from './data-assets';
import { mappings } from './mappings';
import { systems } from './systems';
import { organizations } from './organizations';
import { people } from './people';
import { dataDomains } from './data-domains';
import { governanceGroups } from './governance-groups';

const router = Router();

/** GET /api/v1/dashboard/stats */
router.get('/stats', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  const filteredNodes = oid ? processNodes.filter((n) => n.orgIds.includes(oid) || n.orgId === oid) : processNodes;
  const filteredAssets = oid ? dataAssets.filter((a) => a.orgId === oid) : dataAssets;
  const filteredMappings = oid ? mappings.filter((m) => m.orgId === oid) : mappings;
  const filteredSystems = oid ? systems.filter((s) => s.orgId === oid) : systems;
  const filteredPeople = oid ? people.filter((p) => p.orgIds?.includes(oid)) : people;
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

  const filteredDomains = oid ? dataDomains.filter((d) => d.orgId === oid) : dataDomains;
  const ungovernedDomains = filteredDomains.filter((d) => !d.ownerId).length;

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
        ungovernedDomains,
      },
    },
  });
});

/** GET /api/v1/dashboard/scorecard — Governance Maturity Scorecard */
router.get('/scorecard', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  const filteredNodes = oid ? processNodes.filter((n) => n.orgIds.includes(oid) || n.orgId === oid) : processNodes;
  const filteredAssets = oid ? dataAssets.filter((a) => a.orgId === oid) : dataAssets;
  const filteredDomains = oid ? dataDomains.filter((d) => d.orgId === oid) : dataDomains;
  const filteredGroups = oid ? governanceGroups.filter((g) => g.orgId === oid) : governanceGroups;
  const filteredPeople = oid ? people.filter((p) => (p as any).orgId === oid || p.orgIds?.includes(oid)) : people;

  // 1. processDocumentation: % of value streams with ACTIVE status that have complete paths
  //    (complete path = VS has at least one PROCESS descendant which has at least one ACTIVITY descendant)
  const valueStreams = filteredNodes.filter((n) => n.level === 'VALUE_STREAM');
  let vsWithCompletePaths = 0;
  for (const vs of valueStreams) {
    if (vs.status !== 'ACTIVE') continue;
    // Find descendant processes
    const descendantProcesses = filteredNodes.filter(
      (n) => n.level === 'PROCESS' && hasAncestor(n, vs.id, filteredNodes)
    );
    // Check if any process has an activity descendant
    const hasActivity = descendantProcesses.some((proc) =>
      filteredNodes.some(
        (n) => n.level === 'ACTIVITY' && hasAncestor(n, proc.id, filteredNodes)
      )
    );
    if (hasActivity) vsWithCompletePaths++;
  }
  const processDocumentation = valueStreams.length > 0
    ? Math.round((vsWithCompletePaths / valueStreams.length) * 100)
    : 0;

  // 2. dataGovernance: % of data assets at SILVER or GOLD tier
  const silverOrGold = filteredAssets.filter(
    (a) => a.governanceTier === 'SILVER' || a.governanceTier === 'GOLD'
  ).length;
  const dataGovernance = filteredAssets.length > 0
    ? Math.round((silverOrGold / filteredAssets.length) * 100)
    : 0;

  // 3. domainCoverage: % of data domains with assigned owners
  const domainsWithOwners = filteredDomains.filter((d) => d.ownerId).length;
  const domainCoverage = filteredDomains.length > 0
    ? Math.round((domainsWithOwners / filteredDomains.length) * 100)
    : 0;

  // 4. governanceStructure: has council + has office + has committee + has stewardship teams (25 each)
  const hasCouncil = filteredGroups.some((g) => g.type === 'COUNCIL') ? 25 : 0;
  const hasOffice = filteredGroups.some((g) => g.type === 'OFFICE') ? 25 : 0;
  const hasCommittee = filteredGroups.some((g) => g.type === 'COMMITTEE') ? 25 : 0;
  const hasStewardship = filteredGroups.some((g) => g.type === 'STEWARDSHIP_TEAM') ? 25 : 0;
  const governanceStructure = hasCouncil + hasOffice + hasCommittee + hasStewardship;

  // 5. peopleCoverage: % of governance groups with at least one member
  const groupsWithMembers = filteredGroups.filter((g) => g.members.length > 0).length;
  const peopleCoverage = filteredGroups.length > 0
    ? Math.round((groupsWithMembers / filteredGroups.length) * 100)
    : 0;

  const overall = Math.round(
    (processDocumentation + dataGovernance + domainCoverage + governanceStructure + peopleCoverage) / 5
  );

  const dimensions = [
    {
      name: 'Process Documentation',
      score: processDocumentation,
      description: 'Percentage of value streams with ACTIVE status and complete process paths (Value Stream > Process > Activity).',
      color: scoreColor(processDocumentation),
    },
    {
      name: 'Data Governance',
      score: dataGovernance,
      description: 'Percentage of data assets at Silver or Gold governance tier.',
      color: scoreColor(dataGovernance),
    },
    {
      name: 'Domain Coverage',
      score: domainCoverage,
      description: 'Percentage of data domains with assigned owners.',
      color: scoreColor(domainCoverage),
    },
    {
      name: 'Governance Structure',
      score: governanceStructure,
      description: 'Presence of key governance bodies: Council, Office, Committee, and Stewardship Teams (25 points each).',
      color: scoreColor(governanceStructure),
    },
    {
      name: 'People Coverage',
      score: peopleCoverage,
      description: 'Percentage of governance groups with at least one member assigned.',
      color: scoreColor(peopleCoverage),
    },
  ];

  res.json({ success: true, data: { overall, dimensions } });
});

/** Check if node has a given ancestor */
function hasAncestor(node: any, ancestorId: string, allNodes: any[]): boolean {
  let current = node;
  while (current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = allNodes.find((n: any) => n.id === current.parentId);
    if (!current) break;
  }
  return false;
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

export default router;
