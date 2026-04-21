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
import { loadStore, saveStore } from '../lib/persistence';
import { AuthenticatedRequest } from '../middleware/auth';

// ── RACI Overrides ──
interface RaciOverride {
  nodeId: string;
  personId: string;
  value: string; // R, A, C, I
  reason?: string;
}
const raciOverrides: RaciOverride[] = loadStore<RaciOverride>('raciOverrides');

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

  // ── Per-process RACI derivation ──
  //
  // Instead of assigning global roles (CDO=A everywhere), derive
  // R/A/C/I for each process row based on actual ownership data:
  //
  // R (Responsible): The process/activity OWNER (ownerId on the node).
  //   If the node has no owner, inherit from the nearest parent that does.
  //
  // A (Accountable): The domain OWNER of data assets mapped to this
  //   process. If multiple domains, the first match wins.
  //   Falls back to CDO for rows with no mapped assets.
  //
  // C (Consulted): Stewards of data assets mapped to this process,
  //   plus Data Architects and Technical Data Stewards assigned to the org.
  //
  // I (Informed): Governance group members whose groups govern the
  //   relevant domains, plus the Data Governance Lead and DQ Analysts.

  // Build lookup: processNodeId -> mapped data asset IDs
  const filteredMappings = oid
    ? mappings.filter((m: any) => m.orgId === oid)
    : mappings;
  const assetsByNode: Record<string, string[]> = {};
  for (const m of filteredMappings) {
    if (!assetsByNode[m.processStepId]) assetsByNode[m.processStepId] = [];
    assetsByNode[m.processStepId].push(m.dataAssetId);
  }

  // Get mapped assets for a node, including inherited from children
  function getAssetsForNode(nodeId: string): string[] {
    const direct = assetsByNode[nodeId] || [];
    const childNodes = filteredNodes.filter((n) => n.parentId === nodeId);
    const childAssets = childNodes.flatMap((c) => getAssetsForNode(c.id));
    return [...new Set([...direct, ...childAssets])];
  }

  // Get owner for a node, inheriting from parent if not set
  function getOwner(nodeId: string): string | null {
    const node = rows.find((r) => r.id === nodeId);
    if (!node) return null;
    if (node.ownerId) return node.ownerId;
    if (node.parentId) return getOwner(node.parentId);
    return null;
  }

  // Build per-row RACI and collect all relevant people
  const matrix: Record<string, Record<string, string>> = {};
  const reasons: Record<string, Record<string, string>> = {};
  const allRelevantIds = new Set<string>();

  // Global fallback roles
  const cdoIds = rolePersonMap['CDO'] || new Set<string>();
  const govLeadIds = rolePersonMap['DATA_GOVERNANCE_LEAD'] || new Set<string>();
  const dqAnalystIds = rolePersonMap['DATA_QUALITY_ANALYST'] || new Set<string>();
  const architectIds = rolePersonMap['DATA_ARCHITECT'] || new Set<string>();
  const techStewardIds = rolePersonMap['TECHNICAL_DATA_STEWARD'] || new Set<string>();

  // ── Governance Group → Process mapping ──
  // For governance rows only, RACI is derived from governance group
  // membership and group roles instead of individual assignments.
  const GOV_GROUP_PROCESS_MAP: Record<string, string[]> = {
    'COUNCIL': ['Data Strategy & Policy'],
    'OFFICE': ['Data Strategy & Policy', 'Data Quality Management', 'Data Domain Management', 'Metadata & Catalog Management', 'Data Access & Security', 'Issue & Change Management'],
    'COMMITTEE': ['Data Domain Management', 'Metadata & Catalog Management'],
    'STEWARDSHIP_TEAM': ['Data Quality Management', 'Data Domain Management'],
    'WORKING_GROUP': ['Issue & Change Management', 'Data Access & Security'],
  };

  // Group role → RACI letter
  const GROUP_ROLE_TO_RACI: Record<string, string> = {
    CHAIR: 'A',
    VICE_CHAIR: 'R',
    MEMBER: 'R',
    SECRETARY: 'I',
    ADVISOR: 'C',
  };

  // Check if a row is under the governance value stream
  const govVsIds = new Set(filteredNodes.filter((n) =>
    n.level === 'VALUE_STREAM' && (n.name.includes('Governance') || n.name.includes('Data Management')),
  ).map((n) => n.id));

  function isGovernanceNode(nodeId: string): boolean {
    if (govVsIds.has(nodeId)) return true;
    const node = filteredNodes.find((n) => n.id === nodeId);
    if (!node?.parentId) return false;
    return isGovernanceNode(node.parentId);
  }

  // Find the process name for a governance node (walk up to PROCESS level)
  function getGovProcessName(nodeId: string): string | null {
    const node = filteredNodes.find((n) => n.id === nodeId);
    if (!node) return null;
    if (node.level === 'PROCESS') return node.name;
    if (node.level === 'VALUE_STREAM') return null;
    if (node.parentId) return getGovProcessName(node.parentId);
    return null;
  }

  for (const row of rows) {
    const cellMap: Record<string, string> = {};
    const reasonMap: Record<string, string> = {};

    // For governance rows, derive RACI from governance group membership
    if (isGovernanceNode(row.id)) {
      const processName = row.level === 'VALUE_STREAM' ? null : (getGovProcessName(row.id) || row.name);

      for (const group of filteredGroups) {
        // Check if this group type maps to this governance process
        const mappedProcesses = GOV_GROUP_PROCESS_MAP[group.type] || [];
        const isVs = row.level === 'VALUE_STREAM';
        const matches = isVs ? mappedProcesses.length > 0 : mappedProcesses.some((p) => processName?.includes(p));

        if (matches) {
          for (const member of group.members) {
            const raciLetter = GROUP_ROLE_TO_RACI[member.groupRole] || GROUP_ROLE_TO_RACI[(member as any).role] || 'I';
            const personName = people.find((p) => p.id === member.personId)?.name || '';
            // Higher priority wins: A > R > C > I
            const priority: Record<string, number> = { A: 4, R: 3, C: 2, I: 1 };
            const existing = cellMap[member.personId];
            if (!existing || (priority[raciLetter] || 0) > (priority[existing] || 0)) {
              cellMap[member.personId] = raciLetter;
              reasonMap[member.personId] = `${raciLetter === 'A' ? 'Chair' : raciLetter === 'R' ? 'Member' : raciLetter === 'C' ? 'Advisor' : 'Secretary'} of ${group.name}`;
            }
            allRelevantIds.add(member.personId);
          }
        }
      }

      // Also add the node owner as R if set
      const nodeOwner = getOwner(row.id);
      if (nodeOwner && !cellMap[nodeOwner]) {
        cellMap[nodeOwner] = 'R';
        reasonMap[nodeOwner] = `Owns "${row.name}"`;
        allRelevantIds.add(nodeOwner);
      }

      // Apply overrides
      const nodeOverrides = raciOverrides.filter((o) => o.nodeId === row.id);
      for (const ov of nodeOverrides) {
        cellMap[ov.personId] = ov.value;
        reasonMap[ov.personId] = ov.reason || 'Manual override';
        allRelevantIds.add(ov.personId);
      }

      matrix[row.id] = cellMap;
      reasons[row.id] = reasonMap;
      continue;
    }

    // ── Business process RACI (existing logic) ──
    const nodeAssets = getAssetsForNode(row.id);
    const nodeOwner = getOwner(row.id);

    // R: process/activity owner
    if (nodeOwner) {
      cellMap[nodeOwner] = 'R';
      const ownerPerson = people.find((p) => p.id === nodeOwner);
      reasonMap[nodeOwner] = `Owns "${row.name}"${ownerPerson ? ` (${ownerPerson.name})` : ''}`;
      allRelevantIds.add(nodeOwner);
    }

    // A: domain owner(s) of mapped data assets
    const accountableForRow = new Set<string>();
    const accountableReasons: Record<string, string> = {};
    for (const aid of nodeAssets) {
      const asset = dataAssets.find((a) => a.id === aid);
      const domain = dataDomains.find((d) => d.dataAssetIds.includes(aid));
      if (domain?.ownerId) {
        accountableForRow.add(domain.ownerId);
        accountableReasons[domain.ownerId] = `Owns domain "${domain.name}" containing "${asset?.name || aid}"`;
      }
      if (asset?.owner && !accountableForRow.has(asset.owner)) {
        accountableForRow.add(asset.owner);
        accountableReasons[asset.owner] = `Owns data asset "${asset.name}"`;
      }
    }
    if (accountableForRow.size === 0) {
      for (const id of cdoIds) { accountableForRow.add(id); accountableReasons[id] = 'CDO (fallback — no domain owner for mapped assets)'; }
    }
    for (const pid of accountableForRow) {
      if (!cellMap[pid]) { cellMap[pid] = 'A'; reasonMap[pid] = accountableReasons[pid] || 'Domain/asset owner'; }
      allRelevantIds.add(pid);
    }

    // C: stewards of mapped assets + architects + tech stewards
    const consultedForRow = new Set<string>();
    for (const aid of nodeAssets) {
      const asset = dataAssets.find((a) => a.id === aid);
      if (asset?.stewardIds) {
        for (const sid of asset.stewardIds) consultedForRow.add(sid);
      }
      const domain = dataDomains.find((d) => d.dataAssetIds.includes(aid));
      if (domain?.stewardIds) {
        for (const sid of domain.stewardIds) consultedForRow.add(sid);
      }
    }
    for (const id of architectIds) consultedForRow.add(id);
    for (const id of techStewardIds) consultedForRow.add(id);
    for (const pid of consultedForRow) {
      if (!cellMap[pid]) { cellMap[pid] = 'C'; reasonMap[pid] = architectIds.has(pid) ? 'Data Architect' : techStewardIds.has(pid) ? 'Technical Data Steward' : 'Steward of mapped data asset'; }
      allRelevantIds.add(pid);
    }

    // I: governance group members for relevant domains + gov leads + DQ analysts
    const informedForRow = new Set<string>();
    for (const aid of nodeAssets) {
      const domain = dataDomains.find((d) => d.dataAssetIds.includes(aid));
      if (domain) {
        // Find governance groups that might govern this domain
        for (const g of filteredGroups) {
          for (const m of g.members) informedForRow.add(m.personId);
        }
      }
    }
    for (const id of govLeadIds) informedForRow.add(id);
    for (const id of dqAnalystIds) informedForRow.add(id);
    for (const pid of informedForRow) {
      if (!cellMap[pid]) { cellMap[pid] = 'I'; reasonMap[pid] = govLeadIds.has(pid) ? 'Data Governance Lead' : dqAnalystIds.has(pid) ? 'Data Quality Analyst' : 'Governance group member'; }
      allRelevantIds.add(pid);
    }

    // Apply manual overrides — they take precedence over derived values
    const nodeOverrides = raciOverrides.filter((o) => o.nodeId === row.id);
    for (const ov of nodeOverrides) {
      cellMap[ov.personId] = ov.value;
      reasonMap[ov.personId] = ov.reason || 'Manual override';
      allRelevantIds.add(ov.personId);
    }

    matrix[row.id] = cellMap;
    reasons[row.id] = reasonMap;
  }

  // Build columns from people who appear in at least one cell
  const columns = filteredPeople
    .filter((p) => allRelevantIds.has(p.id))
    .map((p) => {
      const personRoles = filteredRoles.filter((r) => r.personId === p.id);
      const primaryRole = personRoles.length > 0 ? personRoles[0].roleType : p.role || '';
      const orgNames = (p.orgIds || [])
        .map((oid2) => organizations.find((o) => o.id === oid2)?.name)
        .filter(Boolean);
      return {
        personId: p.id,
        name: p.name,
        role: primaryRole,
        title: p.title || '',
        jobRole: p.jobRole || '',
        orgUnit: orgNames[0] || '',
      };
    });

  res.json({
    success: true,
    data: {
      rows: rows.map(({ ownerId, ...rest }) => rest),
      columns,
      matrix,
      reasons,
    },
  });
});

/** POST /api/v1/dashboard/raci/override — set or clear a manual RACI override */
router.post('/raci/override', (req: Request, res: Response) => {
  const { nodeId, personId, value } = req.body;
  if (!nodeId || !personId) {
    res.status(400).json({ success: false, error: 'nodeId and personId are required' });
    return;
  }
  // Remove existing override for this cell
  const idx = raciOverrides.findIndex((o) => o.nodeId === nodeId && o.personId === personId);
  if (idx !== -1) raciOverrides.splice(idx, 1);
  // Add new override (unless clearing)
  if (value && ['R', 'A', 'C', 'I'].includes(value)) {
    raciOverrides.push({ nodeId, personId, value, reason: 'Manual override' });
  }
  saveStore('raciOverrides', raciOverrides);
  res.json({ success: true });
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

/**
 * GET /api/v1/dashboard/governance-status — check if governance framework
 * has been set up for the current org (processes, groups, domains).
 */
router.get('/governance-status', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  // Check each component
  const hasGovProcesses = processNodes.some((n) =>
    n.level === 'VALUE_STREAM' && (n.name.includes('Governance') || n.name.includes('Data Management')) &&
    (oid ? n.orgId === oid || n.orgIds?.includes(oid) : true),
  );
  const hasGovGroups = governanceGroups.some((g) => oid ? g.orgId === oid : true);
  const hasDomains = dataDomains.some((d) => oid ? d.orgId === oid : true);

  res.json({
    success: true,
    data: {
      hasGovProcesses,
      hasGovGroups,
      hasDomains,
      isComplete: hasGovProcesses && hasGovGroups && hasDomains,
    },
  });
});

export default router;
