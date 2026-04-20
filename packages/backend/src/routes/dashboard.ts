import { Router, Request, Response } from 'express';
import { processNodes, flowRelationships, NODE_LEVELS } from './process-catalog';
import { dataAssets } from './data-assets';
import { mappings } from './mappings';
import { systems } from './systems';
import { organizations } from './organizations';
import { people } from './people';
import { dataDomains } from './data-domains';
import { governanceGroups } from './governance-groups';
import { damaRoles } from './dama-roles';
import { AuthenticatedRequest } from '../middleware/auth';

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

/** GET /api/v1/dashboard/raci — Auto-generated RACI matrix */
router.get('/raci', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  // Filter data by org
  const filteredNodes = oid
    ? processNodes.filter((n) => n.orgIds.includes(oid) || n.orgId === oid)
    : processNodes;
  const filteredPeople = oid
    ? people.filter((p) => (p as any).orgId === oid || p.orgIds?.includes(oid))
    : people;
  const filteredRoles = oid
    ? damaRoles.filter((r) => r.scopeType === 'ORG' && r.scopeId === oid)
    : damaRoles;
  const filteredGroups = oid
    ? governanceGroups.filter((g) => g.orgId === oid)
    : governanceGroups;

  // Rows: all process hierarchy levels with parent info for tree building
  const rows = filteredNodes
    .filter((n) => ['VALUE_STREAM', 'PROCESS', 'SUBPROCESS', 'ACTIVITY'].includes(n.level))
    .map((n) => ({
      id: n.id,
      name: n.name,
      level: n.level,
      parentId: n.parentId,
      parentName: n.parentId ? filteredNodes.find((p) => p.id === n.parentId)?.name || null : null,
      ownerId: (n as any).ownerId || null,
    }));

  // Build lookup sets for DAMA role types -> person IDs
  const rolePersonMap: Record<string, Set<string>> = {};
  for (const r of filteredRoles) {
    if (!rolePersonMap[r.roleType]) rolePersonMap[r.roleType] = new Set();
    rolePersonMap[r.roleType].add(r.personId);
  }

  // Governance group members -> person IDs (for Informed)
  const groupMemberIds = new Set<string>();
  for (const g of filteredGroups) {
    for (const m of g.members) {
      groupMemberIds.add(m.personId);
    }
  }

  // Determine which people are relevant (appear in at least one RACI cell)
  // R: process owners + Business Data Stewards
  const responsibleIds = new Set<string>([
    ...(rolePersonMap['BUSINESS_DATA_STEWARD'] || []),
  ]);
  for (const row of rows) {
    if (row.ownerId) responsibleIds.add(row.ownerId);
  }

  // A: CDO + Data Owners
  const accountableIds = new Set<string>([
    ...(rolePersonMap['CDO'] || []),
    ...(rolePersonMap['DATA_OWNER'] || []),
  ]);

  // C: Data Architects + Technical Data Stewards
  const consultedIds = new Set<string>([
    ...(rolePersonMap['DATA_ARCHITECT'] || []),
    ...(rolePersonMap['TECHNICAL_DATA_STEWARD'] || []),
  ]);

  // I: Org Admins + Data Quality Analysts + governance group members + Viewers
  const informedIds = new Set<string>([
    ...(rolePersonMap['DATA_QUALITY_ANALYST'] || []),
    ...(rolePersonMap['DATA_GOVERNANCE_LEAD'] || []),
    ...groupMemberIds,
    ...filteredPeople.filter((p) => p.role === 'ORG_ADMIN' || p.role === 'VIEWER').map((p) => p.id),
  ]);

  // Collect all relevant person IDs
  const allRelevantIds = new Set<string>([
    ...responsibleIds,
    ...accountableIds,
    ...consultedIds,
    ...informedIds,
  ]);

  // Build columns (one per relevant person)
  const columns = filteredPeople
    .filter((p) => allRelevantIds.has(p.id))
    .map((p) => {
      const personRoles = filteredRoles.filter((r) => r.personId === p.id);
      const primaryRole = personRoles.length > 0 ? personRoles[0].roleType : p.role || '';
      const orgNames = (p.orgIds || [])
        .map((oid) => organizations.find((o) => o.id === oid)?.name)
        .filter(Boolean);
      return {
        personId: p.id,
        name: p.name,
        role: primaryRole,
        title: p.title || '',
        orgUnit: orgNames[0] || '',
      };
    });

  // Build matrix
  const matrix: Record<string, Record<string, string>> = {};

  for (const row of rows) {
    const cellMap: Record<string, string> = {};

    for (const col of columns) {
      const pid = col.personId;
      // Priority: A > R > C > I (a person gets the highest-priority designation)
      if (accountableIds.has(pid)) {
        cellMap[pid] = 'A';
      } else if (responsibleIds.has(pid) || row.ownerId === pid) {
        cellMap[pid] = 'R';
      } else if (consultedIds.has(pid)) {
        cellMap[pid] = 'C';
      } else if (informedIds.has(pid)) {
        cellMap[pid] = 'I';
      }
    }

    matrix[row.id] = cellMap;
  }

  res.json({
    success: true,
    data: {
      rows: rows.map(({ ownerId, ...rest }) => rest),
      columns,
      matrix,
    },
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/my-items
//
// Returns ownership-based data for the person whose email matches the
// logged-in JWT. Feeds the "My Items" widget on the Dashboard so a user
// instantly sees what they own, steward, belong to, and need to act on.
// ──────────────────────────────────────────────────────────────────────────

function flattenNodes(nodes: typeof processNodes): typeof processNodes {
  const out: typeof processNodes = [];
  function walk(n: any) {
    out.push(n);
    if (n.children) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return out;
}

router.get('/my-items', (req: AuthenticatedRequest, res: Response) => {
  const email = (req.user?.email || '').toLowerCase();
  if (!email) {
    res.json({ success: true, data: { person: null } });
    return;
  }

  const person = people.find((p) => p.email?.toLowerCase() === email);
  if (!person) {
    res.json({ success: true, data: { person: null } });
    return;
  }

  // Flatten nested process tree to a flat list for ownership lookups.
  const allNodes = flattenNodes(processNodes);

  // Owned process nodes.
  const ownedProcesses = allNodes
    .filter((n) => n.ownerId === person.id)
    .map((n) => ({ id: n.id, name: n.name, level: n.level, status: n.status }));

  // Owned / stewarded data assets.
  const myAssets = dataAssets
    .filter((a) => (a as any).ownerId === person.id || (a as any).stewardId === person.id)
    .map((a) => ({ id: a.id, name: a.name, relation: (a as any).ownerId === person.id ? 'owner' : 'steward' }));

  // DAMA governance roles.
  const myRoles = damaRoles
    .filter((r) => r.personId === person.id)
    .map((r) => {
      let scopeName = r.scopeId;
      if (r.scopeType === 'ORG') {
        scopeName = organizations.find((o) => o.id === r.scopeId)?.name || r.scopeId;
      } else {
        scopeName = dataDomains.find((d) => d.id === r.scopeId)?.name || r.scopeId;
      }
      return { id: r.id, roleType: r.roleType, scopeType: r.scopeType, scopeName };
    });

  // Governance group memberships.
  const myGroups = governanceGroups
    .filter((g) => g.members?.some((m: any) => m.personId === person.id))
    .map((g) => {
      const membership = g.members?.find((m: any) => m.personId === person.id);
      return { id: g.id, name: g.name, type: g.type, groupRole: membership?.groupRole || 'MEMBER' };
    });

  // Domain owner / steward.
  const myDomains = dataDomains
    .filter((d) => d.ownerId === person.id || (d.stewardIds || []).includes(person.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      relation: d.ownerId === person.id ? 'owner' : 'steward',
    }));

  // Action items — things that may need attention.
  const actionItems: Array<{ type: string; message: string; link: string }> = [];
  // Owned processes in DRAFT status.
  for (const p of ownedProcesses) {
    if (p.status === 'DRAFT') {
      actionItems.push({
        type: 'review',
        message: `"${p.name}" is still in DRAFT.`,
        link: '/processes',
      });
    }
  }
  // Governance groups where person is CHAIR with no meetings or pending items (simplified: just flag it).
  for (const g of myGroups) {
    if (g.groupRole === 'CHAIR') {
      actionItems.push({
        type: 'governance',
        message: `You chair "${g.name}".`,
        link: '/governance?tab=groups',
      });
    }
  }

  res.json({
    success: true,
    data: {
      person: { id: person.id, name: person.name, email: person.email, role: person.role, title: (person as any).title || '' },
      ownedProcesses,
      myAssets,
      myRoles,
      myGroups,
      myDomains,
      actionItems,
    },
  });
});

export default router;
