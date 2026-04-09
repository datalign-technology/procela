import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import { people } from './people';
import logger from '../lib/logger';

// DAMA-DMBOK2 Governance Hierarchy Tiers
const GROUP_TYPES = [
  'COUNCIL',              // Executive steering — sets strategy, policy, funding
  'OFFICE',               // Data Governance Office — day-to-day program management
  'COMMITTEE',            // Cross-functional implementation, standards
  'STEWARDSHIP_TEAM',     // Domain-specific data quality and standards
  'WORKING_GROUP',        // Temporary, initiative-focused
  'COMMUNITY_OF_PRACTICE', // Knowledge sharing, informal
] as const;

// Valid parent-child relationships (DAMA hierarchy)
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

/** GET /api/v1/governance-groups */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? governanceGroups.filter((g) => g.orgId === orgId) : governanceGroups;
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

/** POST /api/v1/governance-groups */
router.post('/', (req: Request, res: Response) => {
  const { name, type, description, charter, status, orgId, parentId } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!type || !GROUP_TYPES.includes(type as any)) {
    res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${GROUP_TYPES.join(', ')}` });
    return;
  }

  // Validate parent-child relationship
  if (parentId) {
    const parent = governanceGroups.find((g) => g.id === parentId);
    if (!parent) { res.status(400).json({ success: false, error: 'Parent group not found' }); return; }
    const validChildren = VALID_CHILDREN[parent.type] || [];
    if (!validChildren.includes(type)) {
      res.status(400).json({
        success: false,
        error: `Cannot add ${GROUP_TYPE_LABELS[type] || type} under ${GROUP_TYPE_LABELS[parent.type] || parent.type}. Valid children: ${validChildren.map((t: string) => GROUP_TYPE_LABELS[t] || t).join(', ')}`,
      });
      return;
    }
  } else if (type !== 'COUNCIL' && type !== 'OFFICE') {
    // Non-top-level types should ideally have a parent, but allow it with a warning
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
  res.status(201).json({ success: true, data: group, validChildTypes: VALID_CHILDREN[group.type] || [] });
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
