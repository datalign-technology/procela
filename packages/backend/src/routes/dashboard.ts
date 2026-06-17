import { Router, Request, Response } from 'express';
import { processNodes, flowRelationships, NODE_LEVELS, isGovernanceNode as isGovernanceProcess } from './process-catalog';
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

/** GET /api/v1/dashboard/stats
 *
 * Accepts an optional `domain` query parameter ("OPERATIONAL" or
 * "GOVERNANCE") that narrows the process-side counts (value streams,
 * processes, activities, flows, coverage) to one domain. Data assets,
 * systems and people are not domain-tagged so they remain unfiltered
 * — the dashboard treats those as cross-cutting.
 */
router.get('/stats', (req: Request, res: Response) => {
  const { orgId, domain } = req.query;
  const oid = orgId as string | undefined;
  const dom = domain === 'OPERATIONAL' || domain === 'GOVERNANCE' ? domain : undefined;

  // Missing domain on a node is treated as OPERATIONAL (matches the
  // backfill and frontend `passesLens` convention) so legacy rows
  // never silently disappear when the user picks the Operational lens.
  const nodeMatchesDomain = (n: any) => !dom || (n.domain || 'OPERATIONAL') === dom;

  const filteredNodes = (oid ? processNodes.filter((n) => n.orgIds.includes(oid) || n.orgId === oid) : processNodes)
    .filter(nodeMatchesDomain);
  const filteredAssets = oid ? dataAssets.filter((a) => a.orgId === oid) : dataAssets;
  const filteredMappings = oid ? mappings.filter((m) => m.orgId === oid) : mappings;
  const filteredSystems = oid ? systems.filter((s) => s.orgId === oid) : systems;
  const filteredPeople = oid ? people.filter((p) => p.orgIds?.includes(oid)) : people;
  const filteredFlows = (oid ? flowRelationships.filter((f) => {
    const from = processNodes.find((n) => n.id === f.fromNodeId);
    return from && (from.orgIds.includes(oid) || from.orgId === oid);
  }) : flowRelationships).filter((f) => {
    if (!dom) return true;
    const from = processNodes.find((n) => n.id === f.fromNodeId);
    return from ? nodeMatchesDomain(from) : true;
  });

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

  // Gaps. Only data-asset-shaped mapping rows count here; policy
  // and attachment rows aren't "assets that have been linked".
  const linkedAssetIds = new Set(filteredMappings.filter((m) => !!m.dataAssetId).map((m) => m.dataAssetId!));
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
      dataDomains: filteredDomains.length,
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

  // Rows: every planning-level node in the hierarchy. EXECUTION is a
  // run-time logging level (instances of a TASK), not something you
  // assign responsibility for, so it's the only level intentionally
  // dropped here. DOMAIN, CAPABILITY, and TASK were previously
  // silently filtered out as well; bring them back so processes with
  // task-level detail aren't invisible in the matrix.
  const rows = filteredNodes
    .filter((n) => n.level !== 'EXECUTION')
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
    if (!r.personId) continue;  // agent-held roles have null personId and don't belong in a *person* map
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
    if (!m.dataAssetId) continue; // policy / attachment rows aren't assets
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
    n.level === 'VALUE_STREAM' && isGovernanceProcess(n),
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
        // Check if this group type maps to this governance process.
        // Previously this used substring match (.includes), so e.g.
        // "Data Domain Management" matched any process containing the
        // phrase - including unrelated names with that substring.
        // Switch to case-insensitive equality on a trimmed name so a
        // typo in the process name cleanly breaks the mapping rather
        // than silently pulling in wrong members.
        const mappedProcesses = GOV_GROUP_PROCESS_MAP[group.type] || [];
        const isVs = row.level === 'VALUE_STREAM';
        const normalizedProcess = processName?.trim().toLowerCase() || '';
        const matches = isVs
          ? mappedProcesses.length > 0
          : mappedProcesses.some((p) => p.trim().toLowerCase() === normalizedProcess);

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

    // ── Enforce one A per row ────────────────────────────────────────
    // RACI's first rule is exactly one Accountable. Auto-derivation can
    // produce multiple (e.g. domain owner + asset owner are different
    // people; multiple CDOs with no domain owner; the governance branch
    // matching two groups whose chairs are different people). Without
    // demotion the matrix violates RACI on every row that does.
    //
    // Manual overrides are sacrosanct: if a user explicitly set someone
    // to A we keep that. Otherwise we pick a deterministic winner
    // (lexicographic by name) and demote the rest to R - they were the
    // next-tightest relationship in the auto-derived chain and stay
    // visible in the cell.
    const aPersons = Object.keys(cellMap).filter((id) => cellMap[id] === 'A');
    if (aPersons.length > 1) {
      const overrideA = aPersons.find((pid) =>
        nodeOverrides.some((o) => o.personId === pid && o.value === 'A'),
      );
      const sortByName = (a: string, b: string) =>
        (filteredPeople.find((p) => p.id === a)?.name || a)
          .localeCompare(filteredPeople.find((p) => p.id === b)?.name || b);
      const winner = overrideA || aPersons.sort(sortByName)[0];
      for (const pid of aPersons) {
        if (pid === winner) continue;
        cellMap[pid] = 'R';
        reasonMap[pid] = (reasonMap[pid] || 'Accountable candidate')
          + ' (demoted to Responsible — RACI allows only one Accountable per row)';
      }
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
    .filter((a) => a.owner === person.id || a.owner === person.name || (a.stewardIds || []).includes(person.id))
    .map((a) => ({
      id: a.id, name: a.name, governanceTier: a.governanceTier, healthScore: a.healthScore,
      relation: (a.owner === person.id || a.owner === person.name) ? 'owner' : 'steward',
    }));

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
  // Low-health assets I own/steward.
  for (const a of myAssets) {
    if (a.healthScore > 0 && a.healthScore < 50) {
      actionItems.push({
        type: 'health',
        message: `"${a.name}" health is ${a.healthScore}% — needs attention.`,
        link: '/data-quality',
      });
    }
  }
  // Domains I own without stewards.
  for (const d of myDomains) {
    if (d.relation === 'owner') {
      const domain = dataDomains.find((dd) => dd.id === d.id);
      if (domain && (!domain.stewardIds || domain.stewardIds.length === 0)) {
        actionItems.push({
          type: 'gap',
          message: `Domain "${d.name}" has no stewards assigned.`,
          link: '/governance?tab=domains',
        });
      }
    }
  }
  // Governance groups where person is CHAIR.
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

// ──────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/my-dashboard
//
// Personalized dashboard for the logged-in user. Aggregates tasks, issues,
// domains, upcoming events, and pending policy reviews into a single call
// so the frontend can render a "My Dashboard" page in one fetch.
// ──────────────────────────────────────────────────────────────────────────

// Defensive imports — these stores may not exist yet in all deployments.
let governanceTasks: any[] = [];
let governanceIssues: any[] = [];
let calendarEvents: any[] = [];
let governancePolicies: any[] = [];
try { governanceTasks = require('./governance-tasks').governanceTasks; } catch {}
try { governanceIssues = require('./governance-issues').governanceIssues; } catch {}
try { calendarEvents = require('./governance-calendar').calendarEvents; } catch {}
try { governancePolicies = require('./governance-policies').governancePolicies; } catch {}

const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

router.get('/my-dashboard', (req: AuthenticatedRequest, res: Response) => {
  const email = (req.user?.email || '').toLowerCase();
  if (!email) {
    res.json({
      success: true,
      data: {
        person: null,
        myTasks: [],
        myIssues: [],
        myDomains: [],
        upcomingEvents: [],
        pendingReviews: [],
        summary: {
          openTasks: 0, overdueTasks: 0, openIssues: 0, criticalIssues: 0,
          domainsOwned: 0, domainsSteward: 0, upcomingEventsCount: 0, pendingReviewsCount: 0,
        },
      },
    });
    return;
  }

  const person = people.find((p) => p.email?.toLowerCase() === email);
  if (!person) {
    res.json({
      success: true,
      data: {
        person: null,
        myTasks: [],
        myIssues: [],
        myDomains: [],
        upcomingEvents: [],
        pendingReviews: [],
        summary: {
          openTasks: 0, overdueTasks: 0, openIssues: 0, criticalIssues: 0,
          domainsOwned: 0, domainsSteward: 0, upcomingEventsCount: 0, pendingReviewsCount: 0,
        },
      },
    });
    return;
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // ── Tasks assigned to me (not completed/cancelled) ──
  const CLOSED_TASK_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
  const myTasks = governanceTasks
    .filter((t: any) => t.assigneeId === person.id && !CLOSED_TASK_STATUSES.has(t.status))
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      taskType: t.taskType,
      dueDate: t.dueDate || null,
      isOverdue: t.dueDate ? t.dueDate < todayStr : false,
    }))
    .sort((a: any, b: any) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      // Nulls sort last
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

  // ── Issues assigned to me (not closed/resolved/wont_fix) ──
  const CLOSED_ISSUE_STATUSES = new Set(['CLOSED', 'RESOLVED', 'WONT_FIX']);
  const myIssues = governanceIssues
    .filter((i: any) => i.assignedTo === person.id && !CLOSED_ISSUE_STATUSES.has(i.status))
    .map((i: any) => {
      const domain = i.domainId ? dataDomains.find((d) => d.id === i.domainId) : null;
      return {
        id: i.id,
        title: i.title,
        status: i.status,
        severity: i.severity,
        issueType: i.issueType,
        domainName: domain?.name || null,
      };
    })
    .sort((a: any, b: any) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 99;
      const sb = SEVERITY_ORDER[b.severity] ?? 99;
      return sa - sb;
    });

  // ── Domains I own or steward ──
  const myDomains = dataDomains
    .filter((d) => d.ownerId === person.id || (d.stewardIds || []).includes(person.id))
    .map((d) => {
      const domainAssets = dataAssets.filter((a) => d.dataAssetIds.includes(a.id));
      const healthyAssets = domainAssets.filter((a) => a.healthScore >= 80).length;
      return {
        id: d.id,
        name: d.name,
        relation: (d.ownerId === person.id ? 'owner' : 'steward') as 'owner' | 'steward',
        assetCount: d.dataAssetIds.length,
        healthyAssets,
        totalAssets: domainAssets.length,
      };
    });

  // ── Upcoming calendar events (within 14 days, status ACTIVE) ──
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const upcomingEvents = calendarEvents
    .filter((e: any) => {
      if (e.status !== 'ACTIVE') return false;
      if (!e.attendees || !e.attendees.includes(person.id)) return false;
      if (!e.nextOccurrence) return false;
      const occDate = new Date(e.nextOccurrence);
      const diffMs = occDate.getTime() - now.getTime();
      return diffMs >= 0 && diffMs <= fourteenDaysMs;
    })
    .map((e: any) => {
      const occDate = new Date(e.nextOccurrence);
      const daysAway = Math.ceil((occDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return {
        name: e.name,
        eventType: e.eventType,
        nextOccurrence: e.nextOccurrence,
        daysAway: Math.max(0, daysAway),
      };
    })
    .sort((a: any, b: any) => a.daysAway - b.daysAway);

  // ── Policies pending my review (I own them and nextReviewDate is within 30 days or overdue) ──
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const pendingReviews = governancePolicies
    .filter((p: any) => {
      if (p.ownerAssignmentId !== person.id) return false;
      if (!p.nextReviewDate) return false;
      const reviewDate = new Date(p.nextReviewDate);
      const diffMs = reviewDate.getTime() - now.getTime();
      // Overdue (past) or within 30 days (future)
      return diffMs <= thirtyDaysMs;
    })
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      nextReviewDate: p.nextReviewDate || null,
      isOverdue: p.nextReviewDate ? p.nextReviewDate < todayStr : false,
    }));

  // ── Summary counts ──
  const overdueTasks = myTasks.filter((t: any) => t.isOverdue).length;
  const criticalIssues = myIssues.filter((i: any) => i.severity === 'CRITICAL').length;
  const domainsOwned = myDomains.filter((d) => d.relation === 'owner').length;
  const domainsSteward = myDomains.filter((d) => d.relation === 'steward').length;

  const summary = {
    openTasks: myTasks.length,
    overdueTasks,
    openIssues: myIssues.length,
    criticalIssues,
    domainsOwned,
    domainsSteward,
    upcomingEventsCount: upcomingEvents.length,
    pendingReviewsCount: pendingReviews.length,
  };

  res.json({
    success: true,
    data: {
      person: {
        id: person.id,
        name: person.name,
        email: person.email,
        role: person.role,
        title: (person as any).title || '',
      },
      myTasks,
      myIssues,
      myDomains,
      upcomingEvents,
      pendingReviews,
      summary,
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
    n.level === 'VALUE_STREAM' && isGovernanceProcess(n) &&
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
