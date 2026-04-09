import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { people } from './people';
import logger from '../lib/logger';

const GROUP_TYPES = ['COUNCIL', 'COMMITTEE', 'STEWARDSHIP_TEAM', 'WORKING_GROUP', 'CUSTOM'] as const;
const GROUP_ROLES = ['CHAIR', 'MEMBER', 'SECRETARY'] as const;

interface GroupMember {
  personId: string;
  groupRole: 'CHAIR' | 'MEMBER' | 'SECRETARY';
  since: string;
}

interface StoredGovernanceGroup {
  id: string;
  orgId: string;
  name: string;
  type: 'COUNCIL' | 'COMMITTEE' | 'STEWARDSHIP_TEAM' | 'WORKING_GROUP' | 'CUSTOM';
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  createdAt: string;
  updatedAt: string;
}

export const governanceGroups: StoredGovernanceGroup[] = [];
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/** GET /api/v1/governance-groups */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? governanceGroups.filter((g) => g.orgId === orgId) : governanceGroups;
  res.json({ success: true, data: filtered, groupTypes: GROUP_TYPES, groupRoles: GROUP_ROLES });
});

/** GET /api/v1/governance-groups/:id */
router.get('/:id', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }

  // Enrich members with person names
  const enrichedMembers = group.members.map((m) => {
    const person = people.find((p) => p.id === m.personId);
    return { ...m, personName: person?.name || 'Unknown' };
  });

  res.json({ success: true, data: { ...group, members: enrichedMembers } });
});

/** POST /api/v1/governance-groups */
router.post('/', (req: Request, res: Response) => {
  const { name, type, description, charter, status, orgId } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!type) { res.status(400).json({ success: false, error: 'Type is required' }); return; }
  if (!GROUP_TYPES.includes(type)) {
    res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${GROUP_TYPES.join(', ')}` });
    return;
  }
  const now = new Date().toISOString();
  const group: StoredGovernanceGroup = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    name,
    type,
    description: description || '',
    charter: charter || '',
    status: status || 'ACTIVE',
    members: [],
    createdAt: now,
    updatedAt: now,
  };
  governanceGroups.push(group);
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'CREATE', null, group);
  logger.info({ groupId: group.id, name: group.name, type: group.type }, 'Created governance group');
  res.status(201).json({ success: true, data: group });
});

/** PUT /api/v1/governance-groups/:id */
router.put('/:id', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const before = { ...group };
  const { name, type, description, charter, status } = req.body;
  if (name !== undefined) group.name = name;
  if (type !== undefined) {
    if (!GROUP_TYPES.includes(type)) {
      res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${GROUP_TYPES.join(', ')}` });
      return;
    }
    group.type = type;
  }
  if (description !== undefined) group.description = description;
  if (charter !== undefined) group.charter = charter;
  if (status !== undefined) group.status = status;
  group.updatedAt = new Date().toISOString();
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'UPDATE', before, group);
  res.json({ success: true, data: group });
});

/** DELETE /api/v1/governance-groups/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = governanceGroups.findIndex((g) => g.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const removed = governanceGroups[idx];
  auditService.log(removed.orgId, null, 'GovernanceGroup', removed.id, 'DELETE', removed, null);
  governanceGroups.splice(idx, 1);
  res.status(204).send();
});

/** POST /api/v1/governance-groups/:id/members — add a member */
router.post('/:id/members', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const { personId, groupRole } = req.body;
  if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
  if (!groupRole || !GROUP_ROLES.includes(groupRole)) {
    res.status(400).json({ success: false, error: `Invalid groupRole. Must be one of: ${GROUP_ROLES.join(', ')}` });
    return;
  }
  // Prevent duplicate personId
  if (group.members.find((m) => m.personId === personId)) {
    res.status(409).json({ success: false, error: 'This person is already a member of this group' });
    return;
  }
  const person = people.find((p) => p.id === personId);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  const member: GroupMember = { personId, groupRole, since: new Date().toISOString() };
  group.members.push(member);
  group.updatedAt = new Date().toISOString();
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'ADD_MEMBER', null, { personId, groupRole });
  logger.info({ groupId: group.id, personId, groupRole }, 'Added member to governance group');
  res.status(201).json({ success: true, data: { ...member, personName: person.name } });
});

/** DELETE /api/v1/governance-groups/:id/members/:personId — remove a member */
router.delete('/:id/members/:personId', (req: Request, res: Response) => {
  const group = governanceGroups.find((g) => g.id === req.params.id);
  if (!group) { res.status(404).json({ success: false, error: 'Governance group not found' }); return; }
  const memberIdx = group.members.findIndex((m) => m.personId === req.params.personId);
  if (memberIdx === -1) { res.status(404).json({ success: false, error: 'Member not found in this group' }); return; }
  const removed = group.members[memberIdx];
  group.members.splice(memberIdx, 1);
  group.updatedAt = new Date().toISOString();
  auditService.log(group.orgId, null, 'GovernanceGroup', group.id, 'REMOVE_MEMBER', removed, null);
  res.status(204).send();
});

export default router;
