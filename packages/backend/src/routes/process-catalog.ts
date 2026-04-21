import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { loadStore, saveStore } from '../lib/persistence';
import { getVisibleOrgScope } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import { organizations } from './organizations';
import { people } from './people';
import { createNotification } from './notifications';

const VALUE_STREAM_ORG_LEVELS = ['company', 'division'];

// ── Status state machine ────────────────────────────────────────────────
// Maps each status to the set of statuses it can transition to.
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT:      ['ACTIVE'],
  ACTIVE:     ['DRAFT', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};
const ADVANCED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PROPOSED'],
  PROPOSED:     ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED:     ['ACTIVE', 'DRAFT'],
  ACTIVE:       ['DRAFT', 'DEPRECATED'],
  DEPRECATED:   ['DRAFT'],
};
const SIMPLE_LOCKED = new Set(['ACTIVE', 'DEPRECATED']);
const ADVANCED_LOCKED = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED']);

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL PROCESS HIERARCHY
//
// Levels (in order):
//   VALUE_STREAM > DOMAIN > CAPABILITY > PROCESS > SUBPROCESS > ACTIVITY > TASK > EXECUTION
//
// Required for a valid process path:
//   VALUE_STREAM -> PROCESS -> ACTIVITY
//
// Optional levels:
//   DOMAIN, CAPABILITY, SUBPROCESS, TASK, EXECUTION
//
// Hierarchy = parent-child tree (structural containment)
// Flow = sequence relationships between activities (separate construct)
// ═══════════════════════════════════════════════════════════════════════════════

export const NODE_LEVELS = [
  'VALUE_STREAM',
  'DOMAIN',
  'CAPABILITY',
  'PROCESS',
  'SUBPROCESS',
  'ACTIVITY',
  'TASK',
  'EXECUTION',
] as const;

export type NodeLevel = typeof NODE_LEVELS[number];

// Valid parent -> child relationships
const VALID_CHILDREN: Record<NodeLevel, NodeLevel[]> = {
  VALUE_STREAM: ['DOMAIN', 'CAPABILITY', 'PROCESS'],  // can skip Domain/Capability
  DOMAIN:       ['CAPABILITY', 'PROCESS'],             // can skip Capability
  CAPABILITY:   ['PROCESS'],
  PROCESS:      ['SUBPROCESS', 'ACTIVITY'],            // can skip Subprocess
  SUBPROCESS:   ['ACTIVITY'],
  ACTIVITY:     ['TASK', 'EXECUTION'],                 // can skip Task
  TASK:         ['EXECUTION'],
  EXECUTION:    [],                                     // leaf
};

// Required levels
const REQUIRED_LEVELS: NodeLevel[] = ['VALUE_STREAM', 'PROCESS', 'ACTIVITY'];

export interface ProcessNode {
  id: string;
  parentId: string | null;
  level: NodeLevel;
  name: string;
  description: string;
  activityId: string | null;
  status: string;
  orderIndex: number;
  orgId: string;
  orgIds: string[];
  ownerId: string | null;
  version: number;
  // Documentation fields
  purpose?: string;
  businessOutcome?: string;
  stakeholders?: string;
  complianceTags?: string[];
  inputsOutputs?: string;
  responsibleRole?: string;
  statusJustification?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlowRelationship {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: 'SEQUENCE' | 'PARALLEL' | 'CONDITIONAL' | 'LOOP';
  condition: string | null;  // for conditional flows
  label: string | null;
  createdAt: string;
}

export interface ProcessVersion {
  id: string;
  nodeId: string;
  version: number;
  snapshot: ProcessNode;
  changedBy: string | null;
  changedAt: string;
  status: string;
  note: string;
}

// ── Persistent stores ──

export { SIMPLE_TRANSITIONS, ADVANCED_TRANSITIONS, SIMPLE_LOCKED, ADVANCED_LOCKED };
export const processNodes: ProcessNode[] = loadStore<ProcessNode>('processNodes');
export const flowRelationships: FlowRelationship[] = loadStore<FlowRelationship>('flowRelationships');
export const processVersions: ProcessVersion[] = loadStore<ProcessVersion>('processVersions');

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// Human-readable ID generators per level.
// Counters are initialized from existing data on startup so IDs
// never duplicate after a restart.
const ID_PREFIXES: Record<string, string> = {
  VALUE_STREAM: 'VS',
  PROCESS: 'PRO',
  SUBPROCESS: 'SP',
  ACTIVITY: 'ACT',
  TASK: 'TSK',
  DOMAIN: 'DOM',
  CAPABILITY: 'CAP',
  EXECUTION: 'EXE',
};

const levelCounters: Record<string, number> = {};
for (const [level, prefix] of Object.entries(ID_PREFIXES)) {
  const existing = processNodes
    .filter((n) => n.level === level && n.activityId)
    .map((n) => {
      const m = n.activityId?.match(new RegExp(`^${prefix}-(\\d+)$`));
      return m ? parseInt(m[1], 10) : 0;
    });
  levelCounters[level] = existing.length > 0 ? Math.max(...existing) : 0;
}

function generateNodeId(level: string): string {
  const prefix = ID_PREFIXES[level];
  if (!prefix) return '';
  levelCounters[level] = (levelCounters[level] || 0) + 1;
  return `${prefix}-${String(levelCounters[level]).padStart(4, '0')}`;
}

// Backfill existing nodes that lack a readable ID
{
  let backfilled = 0;
  for (const node of processNodes) {
    if (!node.activityId && ID_PREFIXES[node.level]) {
      node.activityId = generateNodeId(node.level);
      backfilled++;
    }
  }
  if (backfilled > 0) {
    saveStore('processNodes', processNodes);
    logger.info({ backfilled }, 'Backfilled readable IDs on existing process nodes');
  }
}

// Migrate legacy statuses (PROPOSED, UNDER_REVIEW, APPROVED) to DRAFT
{
  const legacyStatuses = new Set(['PROPOSED', 'UNDER_REVIEW', 'APPROVED']);
  let migrated = 0;
  for (const node of processNodes) {
    if (legacyStatuses.has(node.status)) {
      node.status = 'DRAFT';
      migrated++;
    }
  }
  if (migrated > 0) {
    saveStore('processNodes', processNodes);
    logger.info({ migrated }, 'Migrated legacy statuses to DRAFT');
  }
}

// ── Helpers ──

function param(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

function findNode(id: string): ProcessNode | undefined {
  return processNodes.find((n) => n.id === id);
}

function getChildren(parentId: string): ProcessNode[] {
  return processNodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

function getDescendants(nodeId: string): ProcessNode[] {
  const children = getChildren(nodeId);
  const result: ProcessNode[] = [...children];
  for (const child of children) {
    result.push(...getDescendants(child.id));
  }
  return result;
}

function isValidChild(parentLevel: NodeLevel, childLevel: NodeLevel): boolean {
  return VALID_CHILDREN[parentLevel].includes(childLevel);
}

function buildTree(nodes: ProcessNode[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];

  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  for (const node of nodes) {
    const treeNode = map.get(node.id);
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId).children.push(treeNode);
    } else if (!node.parentId) {
      roots.push(treeNode);
    }
  }

  // Sort children by orderIndex
  function sortChildren(node: any) {
    node.children.sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    node.children.forEach(sortChildren);
  }
  roots.sort((a, b) => a.orderIndex - b.orderIndex);
  roots.forEach(sortChildren);

  return roots;
}

function validateProcessIntegrity(vsId: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const vs = findNode(vsId);
  if (!vs || vs.level !== 'VALUE_STREAM') {
    return { valid: false, errors: ['Not a valid value stream'] };
  }

  const descendants = getDescendants(vsId);
  const processes = descendants.filter((n) => n.level === 'PROCESS');
  const activities = descendants.filter((n) => n.level === 'ACTIVITY');

  if (processes.length === 0) {
    errors.push(`Value stream "${vs.name}" has no processes`);
  }

  for (const proc of processes) {
    const procDescendants = getDescendants(proc.id);
    const procActivities = procDescendants.filter((n) => n.level === 'ACTIVITY');
    if (procActivities.length === 0) {
      errors.push(`Process "${proc.name}" has no activities`);
    }
  }

  // Check for orphan nodes (nodes whose parent doesn't exist)
  for (const node of descendants) {
    if (node.parentId && !findNode(node.parentId)) {
      errors.push(`Node "${node.name}" (${node.level}) has orphan parent reference`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════

const router = Router();

// ── HIERARCHY NODES ──

/** DELETE /all — delete all process nodes and flow relationships */
router.delete('/all', (_req: Request, res: Response) => {
  const count = processNodes.length;
  const flowCount = flowRelationships.length;
  processNodes.splice(0, processNodes.length);
  flowRelationships.splice(0, flowRelationships.length);
  saveStore('processNodes', processNodes);
  saveStore('flowRelationships', flowRelationships);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', '*', 'DELETE_ALL', null, { count, flowCount });
  logger.info({ count, flowCount }, 'Deleted all process nodes and flow relationships');
  res.json({ success: true, deleted: count + flowCount });
});

/** GET / — list all nodes as flat list + tree + metadata */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId
    ? (() => {
        const scope = getVisibleOrgScope(orgId as string)!;
        return processNodes.filter((n) => scope.has(n.orgId) || n.orgIds.some((id) => scope.has(id)));
      })()
    : processNodes;
  const valueStreams = filtered.filter((n) => n.level === 'VALUE_STREAM');
  // Enrich with owner names so the frontend can display them inline
  const enriched = filtered.map((n) => {
    const ownerName = n.ownerId ? people.find((p) => p.id === n.ownerId)?.name || null : null;
    return { ...n, ownerName };
  });
  res.json({
    success: true,
    data: enriched,
    tree: buildTree(enriched),
    levels: NODE_LEVELS,
    validChildren: VALID_CHILDREN,
    requiredLevels: REQUIRED_LEVELS,
    stats: {
      total: filtered.length,
      byLevel: Object.fromEntries(
        NODE_LEVELS.map((l) => [l, filtered.filter((n) => n.level === l).length])
      ),
      valueStreams: valueStreams.length,
    },
  });
});

/** GET /value-streams — backward-compatible: return value streams with nested tree */
router.get('/value-streams', (_req: Request, res: Response) => {
  const vsNodes = processNodes.filter((n) => n.level === 'VALUE_STREAM');
  const result = vsNodes.map((vs) => ({
    ...vs,
    children: buildTree(getDescendants(vs.id).concat()),
  }));
  res.json({ success: true, data: result });
});

/** GET /nodes/:id — get a single node with children and ancestry */
router.get('/nodes/:id', (req: Request, res: Response) => {
  const node = findNode(param(req.params.id));
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  // Build ancestry path
  const ancestry: ProcessNode[] = [];
  let current = node;
  while (current.parentId) {
    const parent = findNode(current.parentId);
    if (!parent) break;
    ancestry.unshift(parent);
    current = parent;
  }

  res.json({
    success: true,
    data: node,
    children: getChildren(node.id),
    ancestry,
    validChildLevels: VALID_CHILDREN[node.level],
  });
});

/** POST /nodes — create a node */
router.post('/nodes', (req: Request, res: Response) => {
  const { parentId, level, name, description, status, orgIds, ownerId,
    purpose, businessOutcome, stakeholders, complianceTags, inputsOutputs,
    responsibleRole, statusJustification } = req.body;

  if (!name) {
    res.status(400).json({ success: false, error: 'Name is required' });
    return;
  }
  if (!level || !NODE_LEVELS.includes(level)) {
    res.status(400).json({ success: false, error: `Invalid level. Must be one of: ${NODE_LEVELS.join(', ')}` });
    return;
  }

  // Validate parent-child relationship
  if (level === 'VALUE_STREAM') {
    if (parentId) {
      res.status(400).json({ success: false, error: 'Value streams cannot have a parent' });
      return;
    }
    // Validate org level — value streams only at company/division
    const orgIds = req.body.orgIds || [DEV_ORG_ID];
    for (const oid of orgIds) {
      const org = organizations.find((o) => o.id === oid);
      if (org && !VALUE_STREAM_ORG_LEVELS.includes(org.type)) {
        res.status(400).json({
          success: false,
          error: `Value streams can only be created at the company or division level. "${org.name}" is a ${org.type}.`,
        });
        return;
      }
    }
  } else {
    if (!parentId) {
      res.status(400).json({ success: false, error: `${level} requires a parent node` });
      return;
    }
    const parent = findNode(parentId);
    if (!parent) {
      res.status(400).json({ success: false, error: 'Parent node not found' });
      return;
    }
    if (!isValidChild(parent.level, level as NodeLevel)) {
      res.status(400).json({
        success: false,
        error: `Cannot add ${level} under ${parent.level}. Valid children: ${VALID_CHILDREN[parent.level].join(', ')}`,
      });
      return;
    }
  }

  const siblings = parentId
    ? processNodes.filter((n) => n.parentId === parentId)
    : processNodes.filter((n) => n.level === 'VALUE_STREAM');

  const now = new Date().toISOString();
  const node: ProcessNode = {
    id: uuid(),
    parentId: parentId || null,
    level: level as NodeLevel,
    name,
    description: description || '',
    activityId: generateNodeId(level as string) || null,
    status: status || 'DRAFT',
    orderIndex: siblings.length,
    orgId: DEV_ORG_ID,
    orgIds: orgIds || [DEV_ORG_ID],
    ownerId: ownerId || null,
    version: 1,
    ...(purpose ? { purpose } : {}),
    ...(businessOutcome ? { businessOutcome } : {}),
    ...(stakeholders ? { stakeholders } : {}),
    ...(complianceTags?.length ? { complianceTags } : {}),
    ...(inputsOutputs ? { inputsOutputs } : {}),
    ...(responsibleRole ? { responsibleRole } : {}),
    ...(statusJustification ? { statusJustification } : {}),
    createdAt: now,
    updatedAt: now,
  };

  processNodes.push(node);
  saveStore('processNodes', processNodes);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', node.id, 'CREATE', null, node);
  logger.info({ level, name, parentId }, 'Created process node');

  res.status(201).json({
    success: true,
    data: node,
    validChildLevels: VALID_CHILDREN[node.level],
  });
});

/** PUT /nodes/:id — update a node */
router.put('/nodes/:id', (req: Request, res: Response) => {
  const node = findNode(param(req.params.id));
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  const { name, description, status, orderIndex, orgIds, ownerId, parentId, version,
    purpose, businessOutcome, stakeholders, complianceTags, inputsOutputs,
    responsibleRole, statusJustification } = req.body;

  // Optimistic locking: if version is provided and doesn't match, reject the update
  if (version !== undefined && version !== (node.version ?? 1)) {
    res.status(409).json({
      success: false,
      error: 'This item has been modified by another user. Please refresh and try again.',
    });
    return;
  }

  // If moving to a new parent, validate
  if (parentId !== undefined && parentId !== node.parentId) {
    if (parentId === null && node.level !== 'VALUE_STREAM') {
      res.status(400).json({ success: false, error: 'Only value streams can be root nodes' });
      return;
    }
    if (parentId) {
      const newParent = findNode(parentId);
      if (!newParent) {
        res.status(400).json({ success: false, error: 'New parent not found' });
        return;
      }
      if (!isValidChild(newParent.level, node.level)) {
        res.status(400).json({
          success: false,
          error: `Cannot move ${node.level} under ${newParent.level}`,
        });
        return;
      }
      // Prevent circular references
      const descendants = getDescendants(node.id);
      if (descendants.some((d) => d.id === parentId)) {
        res.status(400).json({ success: false, error: 'Cannot move a node under its own descendant' });
        return;
      }
    }
    node.parentId = parentId;
  }

  // Block field edits when the node is in a locked status.
  // Status-only updates are still allowed (handled below).
  const hasFieldEdits = name !== undefined || description !== undefined
    || orderIndex !== undefined || orgIds !== undefined || ownerId !== undefined
    || purpose !== undefined || businessOutcome !== undefined || stakeholders !== undefined
    || complianceTags !== undefined || inputsOutputs !== undefined || responsibleRole !== undefined;
  // Resolve org's status mode to determine which transitions/locks apply
  const nodeOrg = organizations.find((o) => o.id === node.orgId);
  const isAdvanced = nodeOrg?.statusMode === 'advanced';
  const lockedSet = isAdvanced ? ADVANCED_LOCKED : SIMPLE_LOCKED;
  const transitionMap = isAdvanced ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS;

  if (hasFieldEdits && lockedSet.has(node.status)) {
    res.status(403).json({
      success: false,
      error: `Cannot edit "${node.name}" — it is currently ${node.status.replace('_', ' ')}. Change its status to Draft first.`,
    });
    return;
  }

  if (name !== undefined) node.name = name;
  if (description !== undefined) node.description = description;
  if (orderIndex !== undefined) node.orderIndex = orderIndex;
  if (orgIds !== undefined) node.orgIds = orgIds;
  if (ownerId !== undefined) node.ownerId = ownerId;
  if (purpose !== undefined) node.purpose = purpose;
  if (businessOutcome !== undefined) node.businessOutcome = businessOutcome;
  if (stakeholders !== undefined) node.stakeholders = stakeholders;
  if (complianceTags !== undefined) node.complianceTags = complianceTags;
  if (inputsOutputs !== undefined) node.inputsOutputs = inputsOutputs;
  if (responsibleRole !== undefined) node.responsibleRole = responsibleRole;
  if (statusJustification !== undefined) node.statusJustification = statusJustification;

  // Validate status transition against the state machine
  if (status !== undefined && status !== node.status) {
    const allowed = transitionMap[node.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        success: false,
        error: `Cannot transition from ${node.status.replace('_', ' ')} to ${status.replace('_', ' ')}. Valid transitions: ${allowed.map((s: string) => s.replace('_', ' ')).join(', ') || 'none'}.`,
      });
      return;
    }
    // Status is changing — create a version snapshot before applying the change
    const existingVersions = processVersions.filter((v) => v.nodeId === node.id);
    const nextVersion = existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version)) + 1
      : 1;
    const versionSnapshot: ProcessVersion = {
      id: uuid(),
      nodeId: node.id,
      version: nextVersion,
      snapshot: { ...node },
      changedBy: (req as any).user?.sub || null,
      changedAt: new Date().toISOString(),
      status: node.status,
      note: `Status changed from ${node.status} to ${status}`,
    };
    processVersions.push(versionSnapshot);
    saveStore('processVersions', processVersions);
  }

  if (status !== undefined) {
    if (status === 'ACTIVE') {
      if (node.level === 'VALUE_STREAM') {
        const descendants = getDescendants(node.id);
        const hasProcess = descendants.some((d) => d.level === 'PROCESS');
        const hasActivity = descendants.some((d) => d.level === 'ACTIVITY');
        if (!hasProcess || !hasActivity) {
          res.status(400).json({
            success: false,
            error: `Cannot set to ${status}. Value stream "${node.name}" requires at least one Process and one Activity.`,
          });
          return;
        }
      }
      if (node.level === 'PROCESS') {
        const descendants = getDescendants(node.id);
        const hasActivity = descendants.some((d) => d.level === 'ACTIVITY');
        if (!hasActivity) {
          res.status(400).json({
            success: false,
            error: `Cannot set to ${status}. Process "${node.name}" requires at least one Activity.`,
          });
          return;
        }
      }
    }
    const oldStatus = node.status;
    node.status = status;

    // Workflow notifications on status transitions
    if (status !== oldStatus) {
      const levelLabel = node.level.toLowerCase().replace('_', ' ');
      if (status === 'ACTIVE') {
        createNotification({
          orgId: node.orgId,
          type: 'INFO',
          title: `Process '${node.name}' is now active`,
          message: `The ${levelLabel} "${node.name}" is now active in the process catalog.`,
          link: '/processes',
        });
      } else if (status === 'DEPRECATED') {
        createNotification({
          orgId: node.orgId,
          type: 'WARNING',
          title: `Process '${node.name}' has been deprecated`,
          message: `The ${levelLabel} "${node.name}" has been marked as deprecated. Review any dependent data assets and mappings.`,
          link: '/processes',
        });
      }
    }
  }

  node.updatedAt = new Date().toISOString();
  node.version = (node.version ?? 1) + 1;

  saveStore('processNodes', processNodes);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', node.id, 'UPDATE', null, node);
  res.json({ success: true, data: node });
});

/** DELETE /nodes/:id — delete a node and all descendants */
router.delete('/nodes/:id', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  // Collect all descendants
  const descendants = getDescendants(nodeId);
  const idsToRemove = new Set([nodeId, ...descendants.map((d) => d.id)]);

  // Remove all nodes
  for (let i = processNodes.length - 1; i >= 0; i--) {
    if (idsToRemove.has(processNodes[i].id)) {
      processNodes.splice(i, 1);
    }
  }

  // Remove flow relationships involving deleted nodes
  for (let i = flowRelationships.length - 1; i >= 0; i--) {
    if (idsToRemove.has(flowRelationships[i].fromNodeId) || idsToRemove.has(flowRelationships[i].toNodeId)) {
      flowRelationships.splice(i, 1);
    }
  }

  saveStore('processNodes', processNodes);
  saveStore('flowRelationships', flowRelationships);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', nodeId, 'DELETE', node, null);
  logger.info({ id: nodeId, level: node.level, descendantsRemoved: descendants.length }, 'Deleted process node');

  res.status(204).send();
});

/** GET /nodes/:id/validate — validate a value stream's integrity */
router.get('/nodes/:id/validate', (req: Request, res: Response) => {
  const result = validateProcessIntegrity(param(req.params.id));
  res.json({ success: true, data: result });
});

// ── VERSION HISTORY ──

/** GET /nodes/:id/history — returns all versions for a node, newest first */
router.get('/nodes/:id/history', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  const versions = processVersions
    .filter((v) => v.nodeId === nodeId)
    .sort((a, b) => b.version - a.version);

  res.json({ success: true, data: versions });
});

/** GET /nodes/:id/history/:versionId — returns a specific version */
router.get('/nodes/:id/history/:versionId', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const versionId = param(req.params.versionId);

  const version = processVersions.find((v) => v.id === versionId && v.nodeId === nodeId);
  if (!version) { res.status(404).json({ success: false, error: 'Version not found' }); return; }

  res.json({ success: true, data: version });
});

// ── FLOW RELATIONSHIPS ──

/** GET /flows — list all flows */
router.get('/flows', (_req: Request, res: Response) => {
  const enriched = flowRelationships.map((f) => ({
    ...f,
    fromNode: findNode(f.fromNodeId),
    toNode: findNode(f.toNodeId),
  }));
  res.json({ success: true, data: enriched });
});

/** GET /flows/by-node/:nodeId — get flows for a specific node */
router.get('/flows/by-node/:nodeId', (req: Request, res: Response) => {
  const nodeId = param(req.params.nodeId);
  const outgoing = flowRelationships.filter((f) => f.fromNodeId === nodeId);
  const incoming = flowRelationships.filter((f) => f.toNodeId === nodeId);
  res.json({
    success: true,
    data: { outgoing, incoming },
  });
});

/** POST /flows — create a flow relationship */
router.post('/flows', (req: Request, res: Response) => {
  const { fromNodeId, toNodeId, type, condition, label } = req.body;

  if (!fromNodeId || !toNodeId) {
    res.status(400).json({ success: false, error: 'fromNodeId and toNodeId are required' });
    return;
  }

  const fromNode = findNode(fromNodeId);
  const toNode = findNode(toNodeId);
  if (!fromNode) { res.status(400).json({ success: false, error: 'From node not found' }); return; }
  if (!toNode) { res.status(400).json({ success: false, error: 'To node not found' }); return; }

  // Flows should primarily be between activities (but allow others for flexibility)
  const validFlowTypes = ['SEQUENCE', 'PARALLEL', 'CONDITIONAL', 'LOOP'];
  if (type && !validFlowTypes.includes(type)) {
    res.status(400).json({ success: false, error: `Invalid flow type. Must be one of: ${validFlowTypes.join(', ')}` });
    return;
  }

  // Prevent duplicate flows
  const existing = flowRelationships.find(
    (f) => f.fromNodeId === fromNodeId && f.toNodeId === toNodeId && f.type === (type || 'SEQUENCE')
  );
  if (existing) {
    res.status(409).json({ success: false, error: 'This flow relationship already exists' });
    return;
  }

  // Prevent self-referencing flows
  if (fromNodeId === toNodeId) {
    res.status(400).json({ success: false, error: 'Cannot create a flow from a node to itself' });
    return;
  }

  const flow: FlowRelationship = {
    id: uuid(),
    fromNodeId,
    toNodeId,
    type: (type || 'SEQUENCE') as FlowRelationship['type'],
    condition: condition || null,
    label: label || null,
    createdAt: new Date().toISOString(),
  };

  flowRelationships.push(flow);
  saveStore('flowRelationships', flowRelationships);
  logger.info({ from: fromNode.name, to: toNode.name, type: flow.type }, 'Created flow relationship');

  res.status(201).json({ success: true, data: flow });
});

/** DELETE /flows/:id — delete a flow relationship */
router.delete('/flows/:id', (req: Request, res: Response) => {
  const idx = flowRelationships.findIndex((f) => f.id === param(req.params.id));
  if (idx === -1) { res.status(404).json({ success: false, error: 'Flow not found' }); return; }
  flowRelationships.splice(idx, 1);
  saveStore('flowRelationships', flowRelationships);
  res.status(204).send();
});

// ── TEMPLATE APPLICATION ──

/** POST /apply-template — create hierarchy from AI-generated template */
router.post('/apply-template', (req: Request, res: Response) => {
  try {
    const { industry, valueStreams: templateStreams, orgId: requestOrgId } = req.body;
    const templateOrgId = requestOrgId || DEV_ORG_ID;
    if (!templateStreams || !Array.isArray(templateStreams) || templateStreams.length === 0) {
      res.status(400).json({ success: false, error: 'No value streams provided' });
      return;
    }

    const created: ProcessNode[] = [];
    const now = new Date().toISOString();

    for (const tvs of templateStreams) {
      // Create Value Stream node
      const vsNode: ProcessNode = {
        id: uuid(), parentId: null, level: 'VALUE_STREAM',
        name: tvs.name, description: tvs.description || `Generated from ${industry} template`,
        activityId: generateNodeId('VALUE_STREAM'), status: 'DRAFT',
        orderIndex: processNodes.filter((n) => n.level === 'VALUE_STREAM').length,
        orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
        version: 1,
        ...(tvs.purpose ? { purpose: tvs.purpose } : {}),
        ...(tvs.businessOutcome ? { businessOutcome: tvs.businessOutcome } : {}),
        createdAt: now, updatedAt: now,
      };
      processNodes.push(vsNode);
      created.push(vsNode);

      // Create Process nodes with Activities
      for (let pIdx = 0; pIdx < (tvs.processes || []).length; pIdx++) {
        const proc = tvs.processes[pIdx];
        const procNode: ProcessNode = {
          id: uuid(), parentId: vsNode.id, level: 'PROCESS',
          name: proc.name, description: proc.description || '',
          activityId: generateNodeId('PROCESS'), status: 'DRAFT', orderIndex: pIdx,
          orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
          version: 1,
          ...(proc.purpose ? { purpose: proc.purpose } : {}),
          createdAt: now, updatedAt: now,
        };
        processNodes.push(procNode);
        created.push(procNode);

        // Handle both formats: new (activities) and legacy (subProcesses > steps)
        const activities = proc.activities || [];
        const legacyActivities: any[] = [];
        if (activities.length === 0 && proc.subProcesses) {
          // Legacy format: create subprocesses and extract steps as activities
          for (let spIdx = 0; spIdx < proc.subProcesses.length; spIdx++) {
            const sp = proc.subProcesses[spIdx];
            const spNode: ProcessNode = {
              id: uuid(), parentId: procNode.id, level: 'SUBPROCESS',
              name: sp.name, description: sp.description || '',
              activityId: generateNodeId('SUBPROCESS'), status: 'DRAFT', orderIndex: spIdx,
              orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
              version: 1,
              createdAt: now, updatedAt: now,
            };
            processNodes.push(spNode);
            created.push(spNode);

            for (const st of (sp.steps || sp.activities || [])) {
              legacyActivities.push({ ...st, _parentId: spNode.id });
            }
          }
        }

        // Create Activity nodes (either from new format or legacy)
        const activityList = activities.length > 0
          ? activities.map((a: any) => ({ ...a, _parentId: procNode.id }))
          : legacyActivities.length > 0
            ? legacyActivities
            : [];

        const prevActivities: ProcessNode[] = [];
        for (let aIdx = 0; aIdx < activityList.length; aIdx++) {
          const act = activityList[aIdx];
          const actNode: ProcessNode = {
            id: uuid(), parentId: act._parentId || procNode.id, level: 'ACTIVITY',
            name: act.name, description: act.description || '',
            activityId: generateNodeId('ACTIVITY'), status: 'DRAFT', orderIndex: aIdx,
            orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
            version: 1,
            createdAt: now, updatedAt: now,
          };
          processNodes.push(actNode);
          created.push(actNode);

          // Create sequence flow from previous activity within same parent
          if (prevActivities.length > 0) {
            const prevAct = prevActivities[prevActivities.length - 1];
            if (prevAct.parentId === actNode.parentId) {
              flowRelationships.push({
                id: uuid(), fromNodeId: prevAct.id, toNodeId: actNode.id,
                type: 'SEQUENCE', condition: null, label: null, createdAt: now,
              });
            }
          }
          prevActivities.push(actNode);
        }
      }
    }

    saveStore('processNodes', processNodes);
    saveStore('flowRelationships', flowRelationships);
    logger.info({ count: created.length, industry }, 'Applied template with universal hierarchy');
    res.status(201).json({ success: true, data: created, tree: buildTree(processNodes) });
  } catch (err) {
    logger.error({ err }, 'Apply template failed');
    res.status(500).json({ success: false, error: 'Failed to apply template' });
  }
});

/**
 * POST /apply-governance-template — create a standard data governance
 * process hierarchy. Unlike business processes (which are industry-specific
 * and AI-generated), governance processes are universal and use a static
 * template. Idempotent — skips if governance value streams already exist.
 */
router.post('/apply-governance-template', (req: Request, res: Response) => {
  const { orgId: requestOrgId } = req.body;
  const templateOrgId = requestOrgId || DEV_ORG_ID;

  // Check if governance processes already exist for this org
  const existing = processNodes.filter((n) =>
    n.level === 'VALUE_STREAM' && n.orgId === templateOrgId &&
    (n.name.includes('Governance') || n.name.includes('Data Management')),
  );
  if (existing.length > 0) {
    res.json({ success: true, data: [], message: 'Governance processes already exist. Delete them to regenerate.' });
    return;
  }

  const template = [
    {
      name: 'Data Governance Management',
      description: 'Enterprise-wide data governance strategy, policies, standards, and oversight',
      purpose: 'Establish and maintain the organizational framework for managing data as a strategic asset',
      businessOutcome: 'Trusted, well-governed data that supports business decisions and regulatory compliance',
      processes: [
        {
          name: 'Data Strategy & Policy',
          description: 'Define and maintain data governance charter, policies, and standards',
          purpose: 'Set the rules and guidelines for how data is managed across the organization',
          activities: [
            { name: 'Define Data Governance Charter', description: 'Establish governance mission, vision, principles, and decision rights' },
            { name: 'Establish Data Policies', description: 'Create policies for data quality, security, privacy, retention, and sharing' },
            { name: 'Define Data Standards', description: 'Set naming conventions, data definitions, and formatting rules' },
            { name: 'Review and Update Policies', description: 'Periodic review of policies against regulatory changes and business needs' },
            { name: 'Communicate Policy Changes', description: 'Distribute updates to stakeholders and ensure awareness' },
          ],
        },
        {
          name: 'Data Quality Management',
          description: 'Monitor, measure, and improve data quality across the organization',
          purpose: 'Ensure data meets defined quality standards for accuracy, completeness, and timeliness',
          activities: [
            { name: 'Define Quality Rules & Thresholds', description: 'Establish measurable quality criteria per data asset and domain' },
            { name: 'Execute Quality Assessments', description: 'Run quality rules against data assets on schedule or on-demand' },
            { name: 'Analyze Quality Results', description: 'Review scores, identify trends, and flag critical failures' },
            { name: 'Investigate Root Causes', description: 'Trace quality issues to source systems, processes, or manual errors' },
            { name: 'Implement Remediation', description: 'Fix data issues and update processes to prevent recurrence' },
            { name: 'Report Quality Metrics', description: 'Publish quality dashboards and scorecards for stakeholders' },
          ],
        },
        {
          name: 'Data Domain Management',
          description: 'Organize data into governed domains with clear ownership and stewardship',
          purpose: 'Ensure every data asset has an accountable owner and active steward',
          activities: [
            { name: 'Define Data Domains', description: 'Identify and scope data domains (Customer, Financial, Operational, etc.)' },
            { name: 'Assign Domain Owners', description: 'Designate accountable business owners for each domain' },
            { name: 'Assign Data Stewards', description: 'Designate day-to-day stewards responsible for data quality within domains' },
            { name: 'Map Assets to Domains', description: 'Link data assets to their governing domains' },
            { name: 'Review Domain Coverage', description: 'Identify orphaned assets and gaps in domain assignment' },
            { name: 'Resolve Cross-Domain Issues', description: 'Arbitrate conflicts where data spans multiple domains' },
          ],
        },
        {
          name: 'Metadata & Catalog Management',
          description: 'Maintain the enterprise data catalog, business glossary, and lineage',
          purpose: 'Make data discoverable, understandable, and traceable across the organization',
          activities: [
            { name: 'Maintain Data Catalog', description: 'Register and update data asset definitions, owners, and classifications' },
            { name: 'Define Business Glossary Terms', description: 'Create agreed-upon definitions for key business terms' },
            { name: 'Map Data Lineage', description: 'Document how data flows from source systems through transformations to consumption' },
            { name: 'Review Catalog Completeness', description: 'Audit the catalog for missing assets, stale entries, and undocumented sources' },
          ],
        },
        {
          name: 'Data Access & Security',
          description: 'Classify data sensitivity and manage access policies',
          purpose: 'Protect sensitive data while enabling authorized access for business needs',
          activities: [
            { name: 'Classify Data Sensitivity', description: 'Apply classification levels (Public, Internal, Confidential, Restricted) to assets' },
            { name: 'Define Access Policies', description: 'Establish who can access what data under which conditions' },
            { name: 'Review Access Requests', description: 'Process and approve/deny requests for data access' },
            { name: 'Audit Access Compliance', description: 'Verify that actual access patterns match approved policies' },
          ],
        },
        {
          name: 'Issue & Change Management',
          description: 'Track, prioritize, and resolve data governance issues',
          purpose: 'Provide a structured process for handling data problems and governance changes',
          activities: [
            { name: 'Log Data Issues', description: 'Capture reported data problems with context, impact, and urgency' },
            { name: 'Prioritize Issues', description: 'Triage issues by business impact, regulatory risk, and effort' },
            { name: 'Assign and Resolve Issues', description: 'Route issues to responsible parties and track resolution' },
            { name: 'Implement Changes', description: 'Execute approved changes to data, systems, or processes' },
            { name: 'Communicate Resolutions', description: 'Notify stakeholders of resolved issues and preventive measures' },
          ],
        },
      ],
    },
  ];

  const created: ProcessNode[] = [];
  const now = new Date().toISOString();

  for (const tvs of template) {
    const vsNode: ProcessNode = {
      id: uuid(), parentId: null, level: 'VALUE_STREAM',
      name: tvs.name, description: tvs.description,
      activityId: generateNodeId('VALUE_STREAM'), status: 'DRAFT',
      orderIndex: processNodes.filter((n) => n.level === 'VALUE_STREAM').length,
      orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
      version: 1,
      purpose: tvs.purpose, businessOutcome: tvs.businessOutcome,
      createdAt: now, updatedAt: now,
    };
    processNodes.push(vsNode);
    created.push(vsNode);

    for (let pIdx = 0; pIdx < tvs.processes.length; pIdx++) {
      const proc = tvs.processes[pIdx];
      const procNode: ProcessNode = {
        id: uuid(), parentId: vsNode.id, level: 'PROCESS',
        name: proc.name, description: proc.description,
        activityId: generateNodeId('PROCESS'), status: 'DRAFT', orderIndex: pIdx,
        orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
        version: 1, purpose: proc.purpose,
        createdAt: now, updatedAt: now,
      };
      processNodes.push(procNode);
      created.push(procNode);

      const prevActivities: ProcessNode[] = [];
      for (let aIdx = 0; aIdx < proc.activities.length; aIdx++) {
        const act = proc.activities[aIdx];
        const actNode: ProcessNode = {
          id: uuid(), parentId: procNode.id, level: 'ACTIVITY',
          name: act.name, description: act.description,
          activityId: generateNodeId('ACTIVITY'), status: 'DRAFT', orderIndex: aIdx,
          orgId: templateOrgId, orgIds: [templateOrgId], ownerId: null,
          version: 1,
          createdAt: now, updatedAt: now,
        };
        processNodes.push(actNode);
        created.push(actNode);

        if (prevActivities.length > 0) {
          const prev = prevActivities[prevActivities.length - 1];
          flowRelationships.push({
            id: uuid(), fromNodeId: prev.id, toNodeId: actNode.id,
            type: 'SEQUENCE', condition: null, label: null, createdAt: now,
          });
        }
        prevActivities.push(actNode);
      }
    }
  }

  saveStore('processNodes', processNodes);
  saveStore('flowRelationships', flowRelationships);
  logger.info({ created: created.length, orgId: templateOrgId }, 'Applied governance process template');
  res.status(201).json({ success: true, data: created, message: `Created ${created.length} governance process nodes` });
});

export default router;
