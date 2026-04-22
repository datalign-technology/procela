import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { dataDomains } from './data-domains';
import { people } from './people';
import logger from '../lib/logger';

// Governance Hierarchy Tiers (aligned with data governance best practices)
const GROUP_TYPES = [
  'COUNCIL',              // Executive steering — sets strategy, policy, funding
  'OFFICE',               // Data Governance Office — day-to-day program management
  'COMMITTEE',            // Cross-functional implementation, standards
  'STEWARDSHIP_TEAM',     // Domain-specific data quality and standards
  'WORKING_GROUP',        // Temporary, initiative-focused
  'COMMUNITY_OF_PRACTICE', // Knowledge sharing, informal
] as const;

// Valid parent-child relationships (governance hierarchy)
const VALID_CHILDREN: Record<string, string[]> = {
  COUNCIL:               ['OFFICE', 'COMMITTEE', 'WORKING_GROUP'],
  OFFICE:                ['COMMITTEE', 'STEWARDSHIP_TEAM', 'WORKING_GROUP'],
  COMMITTEE:             ['STEWARDSHIP_TEAM', 'WORKING_GROUP', 'COMMUNITY_OF_PRACTICE'],
  STEWARDSHIP_TEAM:      ['WORKING_GROUP', 'COMMUNITY_OF_PRACTICE'],
  WORKING_GROUP:         ['COMMUNITY_OF_PRACTICE'],
  COMMUNITY_OF_PRACTICE: [],
};

const GROUP_TYPE_LABELS: Record<string, string> = {
  COUNCIL: 'Data Governance Council',
  OFFICE: 'Data Governance Office',
  COMMITTEE: 'Data Governance Committee',
  STEWARDSHIP_TEAM: 'Data Stewardship Team',
  WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'Community of Practice',
};

const GROUP_ROLES = ['CHAIR', 'VICE_CHAIR', 'MEMBER', 'SECRETARY', 'ADVISOR'] as const;

interface GroupMember {
  personId: string;
  groupRole: string;
  since: string;
}

interface StoredGovernanceGroup {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  createdAt: string;
  updatedAt: string;
}

export const governanceGroups: StoredGovernanceGroup[] = loadStore<StoredGovernanceGroup>('governanceGroups');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// Deduplicate on startup: keep the first occurrence of each name+orgId+type combo
{
  const seen = new Set<string>();
  const dupeIds: string[] = [];
  for (const g of governanceGroups) {
    const key = `${g.orgId}|${g.name.toLowerCase()}|${g.type}`;
    if (seen.has(key)) { dupeIds.push(g.id); } else { seen.add(key); }
  }
  if (dupeIds.length > 0) {
    const dupeSet = new Set(dupeIds);
    for (let i = governanceGroups.length - 1; i >= 0; i--) {
      if (dupeSet.has(governanceGroups[i].id)) governanceGroups.splice(i, 1);
    }
    saveStore('governanceGroups', governanceGroups);
    logger.info({ removed: dupeIds.length }, 'Removed duplicate governance groups');
  }
}

// ── Tree builder ──

function buildTree(groups: StoredGovernanceGroup[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];

  for (const g of groups) {
    map.set(g.id, { ...g, children: [] });
  }
  for (const g of groups) {
    const node = map.get(g.id);
    if (g.parentId && map.has(g.parentId)) {
      map.get(g.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const router = Router();

/** DELETE /api/v1/governance-groups/all — delete all governance groups */
router.delete('/all', (_req: Request, res: Response) => {
  const count = governanceGroups.length;
  governanceGroups.splice(0, governanceGroups.length);
  saveStore('governanceGroups', governanceGroups);
  auditService.log(DEV_ORG_ID, null, 'GovernanceGroup', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all governance groups');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/governance-groups */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  let filtered = filterByOrgScope(governanceGroups, orgId as string | undefined);
  // Deduplicate by name+type within the result set
  const seen = new Set<string>();
  filtered = filtered.filter((g) => {
    const key = `${g.name.toLowerCase()}|${g.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  res.json({
    success: true,
    data: filtered,
    tree: buildTree(filtered),
    groupTypes: GROUP_TYPES,
    groupTypeLabels: GROUP_TYPE_LABELS,
    validChildren: VALID_CHILDREN,
    groupRoles: GROUP_ROLES,
  });
});

/**
 * POST /api/v1/governance-groups/generate-template
 * Generate a standard governance structure as a starting point.
 * Must be registered BEFORE /:id to avoid route conflict.
 */
router.post('/generate-template', (req: Request, res: Response) => {
  const { orgId } = req.body;
  const targetOrgId = orgId || DEV_ORG_ID;
  const now = new Date().toISOString();
  const created: StoredGovernanceGroup[] = [];

  const template = [
    { type: 'COUNCIL', name: 'Data Governance Council', description: 'Executive steering committee that sets data governance strategy, policy, and priorities.', charter: 'Define data governance vision, approve policies, allocate resources, resolve escalations.' },
    { type: 'OFFICE', name: 'Data Governance Office', description: 'Day-to-day program management and coordination of governance activities.', charter: 'Coordinate governance initiatives, track compliance, manage governance tools, support stewardship teams.', parentType: 'COUNCIL' },
    { type: 'COMMITTEE', name: 'Enterprise Data Committee', description: 'Cross-functional working group that implements governance standards and practices.', charter: 'Develop data standards, review data issues, coordinate across domains, report to the Council.', parentType: 'OFFICE' },
  ];

  // Skip items that already exist in this org (prevents duplicates on re-run)
  const existingNames = new Set(
    governanceGroups.filter((g) => g.orgId === targetOrgId).map((g) => g.name.toLowerCase()),
  );

  const typeToId: Record<string, string> = {};
  // Seed typeToId from existing groups so parent lookups work even when skipping
  for (const g of governanceGroups.filter((g) => g.orgId === targetOrgId)) {
    if (!typeToId[g.type]) typeToId[g.type] = g.id;
  }

  for (const t of template) {
    if (existingNames.has(t.name.toLowerCase())) continue;
    const parentId = t.parentType ? typeToId[t.parentType] || null : null;
    const group: StoredGovernanceGroup = {
      id: uuid(), orgId: targetOrgId, parentId,
      name: t.name, type: t.type, description: t.description, charter: t.charter,
      status: 'ACTIVE', members: [], createdAt: now, updatedAt: now,
    };
    governanceGroups.push(group);
    created.push(group);
    if (!typeToId[t.type]) typeToId[t.type] = group.id;
  }

  saveStore('governanceGroups', governanceGroups);
  logger.info({ count: created.length, orgId: targetOrgId }, 'Generated governance template');
  res.status(201).json({ success: true, data: created, tree: buildTree(governanceGroups.filter((g) => g.orgId === targetOrgId)) });
});

/** GET /api/v1/governance-groups/:id */
router.get('/:id', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }

  const enrichedMembers = group.members.map((m) => {
    const person = people.find((p) => p.id === m.personId);
    return { ...m, personName: person?.name || 'Unknown' };
  });

  const parent = group.parentId ? governanceGroups.find((g) => g.id === group.parentId) : null;
  const children = governanceGroups.filter((g) => g.parentId === group.id);

  res.json({
    success: true,
    data: {
      ...group,
      members: enrichedMembers,
      parentName: parent?.name || null,
      children: children.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      validChildTypes: VALID_CHILDREN[group.type] || [],
    },
  });
});

/** GET /api/v1/governance-groups/:id/recommendations */
router.get('/:id/recommendations', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Group not found' }); return; }

  const validChildTypes = VALID_CHILDREN[group.type] || [];
  const orgGroups = governanceGroups.filter((g) => g.orgId === group.orgId);
  const allOrgGroupNames = new Set(orgGroups.map((g) => g.name.toLowerCase()));

  interface Recommendation {
    name: string;
    type: string;
    typeLabel: string;
    description: string;
    charter: string;
    reason: string;
    exists: boolean;
  }

  const recommendations: Recommendation[] = [];

  if (group.type === 'COMMITTEE' || group.type === 'OFFICE') {
    // Recommend a stewardship team for each data domain
    const orgDomains = dataDomains.filter((d) => d.orgId === group.orgId);
    for (const domain of orgDomains) {
      const teamName = `${domain.name} Stewardship Team`;
      recommendations.push({
        name: teamName,
        type: 'STEWARDSHIP_TEAM',
        typeLabel: GROUP_TYPE_LABELS['STEWARDSHIP_TEAM'],
        description: `Data stewardship team responsible for the ${domain.name} domain. Ensures data quality, standards compliance, and issue resolution.`,
        charter: `Define ${domain.name.toLowerCase()} data standards, resolve data quality issues, manage master data definitions.`,
        reason: `Recommended for the "${domain.name}" data domain`,
        exists: allOrgGroupNames.has(teamName.toLowerCase()),
      });
    }

    // Recommend a working group for data quality
    if (validChildTypes.includes('WORKING_GROUP')) {
      const dqName = 'Data Quality Improvement';
      recommendations.push({
        name: dqName,
        type: 'WORKING_GROUP',
        typeLabel: GROUP_TYPE_LABELS['WORKING_GROUP'],
        description: 'Initiative-focused group driving data quality improvements across the organization.',
        charter: 'Identify data quality issues, implement fixes, measure improvement, report progress.',
        reason: 'DAMA best practice — temporary group for quality initiatives',
        exists: allOrgGroupNames.has(dqName.toLowerCase()),
      });
    }
  }

  if (group.type === 'COUNCIL') {
    // Recommend Office and Committee if not present
    if (!orgGroups.some((c) => c.type === 'OFFICE')) {
      recommendations.push({
        name: 'Data Governance Office',
        type: 'OFFICE',
        typeLabel: GROUP_TYPE_LABELS['OFFICE'],
        description: 'Day-to-day program management and coordination of governance activities.',
        charter: 'Coordinate governance initiatives, track compliance, manage governance tools, support stewardship teams.',
        reason: 'DAMA best practice — manages the governance program day-to-day',
        exists: false,
      });
    }
    if (!orgGroups.some((c) => c.type === 'COMMITTEE')) {
      recommendations.push({
        name: 'Enterprise Data Committee',
        type: 'COMMITTEE',
        typeLabel: GROUP_TYPE_LABELS['COMMITTEE'],
        description: 'Cross-functional working group that implements governance standards and practices.',
        charter: 'Develop data standards, review data issues, coordinate across domains, report to the Council.',
        reason: 'DAMA best practice — implements standards across domains',
        exists: false,
      });
    }
  }

  res.json({ success: true, data: recommendations.filter((r) => !r.exists) });
});

/** POST /api/v1/governance-groups */
router.post('/', (req: Request, res: Response) => {
  const { name, type, description, charter, status, orgId, parentId } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!type || !GROUP_TYPES.includes(type as any)) {
    res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${GROUP_TYPES.join(', ')}` });
    return;
  }

  // Check parent-child relationship (soft warning, not a block)
  let warning: string | null = null;
  if (parentId) {
    const parent = governanceGroups.find((g) => g.id === parentId);
    if (!parent) { res.status(400).json({ success: false, error: 'Parent group not found' }); return; }
    const recommended = VALID_CHILDREN[parent.type] || [];
    if (!recommended.includes(type)) {
      warning = `Governance best practices suggest ${GROUP_TYPE_LABELS[type] || type} typically reports to ${recommended.map((t: string) => GROUP_TYPE_LABELS[t] || t).join(' or ') || 'a higher-level body'}, not ${GROUP_TYPE_LABELS[parent.type] || parent.type}. Saved anyway.`;
    }
  } else if (type !== 'COUNCIL' && type !== 'OFFICE' && !parentId) {
    warning = `Governance best practices suggest ${GROUP_TYPE_LABELS[type] || type} be placed under a higher-level governance body.`;
  }

  // Check if no top-level council exists
  if (type !== 'COUNCIL' && !parentId) {
    const hasCouncil = governanceGroups.some((g) => g.type === 'COUNCIL');
    if (!hasCouncil && !warning) {
      warning = 'Governance best practices suggest establishing a Data Governance Council as the top-level governing body first.';
    }
  }

  const now = new Date().toISOString();
  const group: StoredGovernanceGroup = {
    id: uuid(), orgId: orgId || DEV_ORG_ID, parentId: parentId || null,
    name, type, description: description || '', charter: charter || '',
    status: status || 'ACTIVE', members: [], createdAt: now, updatedAt: now,
  };
  governanceGroups.push(group);
  saveStore('governanceGroups', governanceGroups);
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'CREATE', null, group);
  logger.info({ groupId: group.id, name: group.name, type: group.type, parentId }, 'Created governance group');
  res.status(201).json({ success: true, data: group, warning, validChildTypes: VALID_CHILDREN[group.type] || [] });
});

/** PUT /api/v1/governance-groups/:id */
router.put('/:id', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const before = { ...group };
  const { name, type, description, charter, status, parentId } = req.body;
  if (name !== undefined) group.name = name;
  if (type !== undefined) {
    if (!GROUP_TYPES.includes(type as any)) {
      res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${GROUP_TYPES.join(', ')}` });
      return;
    }
    group.type = type;
  }
  if (description !== undefined) group.description = description;
  if (charter !== undefined) group.charter = charter;
  if (status !== undefined) group.status = status;
  if (parentId !== undefined) group.parentId = parentId;
  group.updatedAt = new Date().toISOString();
  saveStore('governanceGroups', governanceGroups);
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'UPDATE', before, group);
  res.json({ success: true, data: group });
});

/** DELETE /api/v1/governance-groups/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = governanceGroups.findIndex((g) => g.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const removed = governanceGroups[idx];
  // Re-parent children
  for (const g of governanceGroups) {
    if (g.parentId === removed.id) g.parentId = removed.parentId;
  }
  auditService.log(removed.orgId, null, 'GovernanceGroup', removed.id, 'DELETE', removed, null);
  governanceGroups.splice(idx, 1);
  saveStore('governanceGroups', governanceGroups);
  res.status(204).send();
});

/** POST /api/v1/governance-groups/:id/members */
router.post('/:id/members', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const { personId, groupRole } = req.body;
  if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
  if (!groupRole || !GROUP_ROLES.includes(groupRole as any)) {
    res.status(400).json({ success: false, error: `Invalid groupRole. Must be one of: ${GROUP_ROLES.join(', ')}` });
    return;
  }
  if (group.members.find((m) => m.personId === personId)) {
    res.status(409).json({ success: false, error: 'This person is already a member' });
    return;
  }
  const person = people.find((p) => p.id === personId);
  if (!person) { res.status(400).json({ success: false, error: 'Person not found' }); return; }
  group.members.push({ personId, groupRole, since: new Date().toISOString() });
  group.updatedAt = new Date().toISOString();
  saveStore('governanceGroups', governanceGroups);
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'ADD_MEMBER', null, { personId, groupRole });
  res.status(201).json({ success: true, data: { personId, groupRole, personName: person.name, since: group.members[group.members.length - 1].since } });
});

/** DELETE /api/v1/governance-groups/:id/members/:personId */
router.delete('/:id/members/:personId', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const idx = group.members.findIndex((m) => m.personId === req.params.personId);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Member not found' }); return; }
  group.members.splice(idx, 1);
  group.updatedAt = new Date().toISOString();
  saveStore('governanceGroups', governanceGroups);
  res.status(204).send();
});

export default router;
