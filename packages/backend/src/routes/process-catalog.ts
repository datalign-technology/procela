import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';

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
  activityId: string | null;  // human-readable ID for activities (e.g. "ACT-001")
  status: string;
  orderIndex: number;
  orgId: string;
  orgIds: string[];
  ownerId: string | null;
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

// ── In-memory stores ──

export const processNodes: ProcessNode[] = [];
export const flowRelationships: FlowRelationship[] = [];

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';
let activityCounter = 0;

function generateActivityId(): string {
  activityCounter++;
  return `ACT-${String(activityCounter).padStart(4, '0')}`;
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

/** GET / — list all nodes as flat list + tree + metadata */
router.get('/', (_req: Request, res: Response) => {
  const valueStreams = processNodes.filter((n) => n.level === 'VALUE_STREAM');
  res.json({
    success: true,
    data: processNodes,
    tree: buildTree(processNodes),
    levels: NODE_LEVELS,
    validChildren: VALID_CHILDREN,
    requiredLevels: REQUIRED_LEVELS,
    stats: {
      total: processNodes.length,
      byLevel: Object.fromEntries(
        NODE_LEVELS.map((l) => [l, processNodes.filter((n) => n.level === l).length])
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
  const { parentId, level, name, description, status, orgIds, ownerId } = req.body;

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
    activityId: level === 'ACTIVITY' ? generateActivityId() : null,
    status: status || 'DRAFT',
    orderIndex: siblings.length,
    orgId: DEV_ORG_ID,
    orgIds: orgIds || [DEV_ORG_ID],
    ownerId: ownerId || null,
    createdAt: now,
    updatedAt: now,
  };

  processNodes.push(node);
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

  const { name, description, status, orderIndex, orgIds, ownerId, parentId } = req.body;

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

  if (name !== undefined) node.name = name;
  if (description !== undefined) node.description = description;
  if (status !== undefined) node.status = status;
  if (orderIndex !== undefined) node.orderIndex = orderIndex;
  if (orgIds !== undefined) node.orgIds = orgIds;
  if (ownerId !== undefined) node.ownerId = ownerId;
  node.updatedAt = new Date().toISOString();

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

  auditService.log(DEV_ORG_ID, null, 'ProcessNode', nodeId, 'DELETE', node, null);
  logger.info({ id: nodeId, level: node.level, descendantsRemoved: descendants.length }, 'Deleted process node');

  res.status(204).send();
});

/** GET /nodes/:id/validate — validate a value stream's integrity */
router.get('/nodes/:id/validate', (req: Request, res: Response) => {
  const result = validateProcessIntegrity(param(req.params.id));
  res.json({ success: true, data: result });
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
  logger.info({ from: fromNode.name, to: toNode.name, type: flow.type }, 'Created flow relationship');

  res.status(201).json({ success: true, data: flow });
});

/** DELETE /flows/:id — delete a flow relationship */
router.delete('/flows/:id', (req: Request, res: Response) => {
  const idx = flowRelationships.findIndex((f) => f.id === param(req.params.id));
  if (idx === -1) { res.status(404).json({ success: false, error: 'Flow not found' }); return; }
  flowRelationships.splice(idx, 1);
  res.status(204).send();
});

// ── TEMPLATE APPLICATION ──

/** POST /apply-template — create hierarchy from AI-generated template */
router.post('/apply-template', (req: Request, res: Response) => {
  try {
    const { industry, valueStreams: templateStreams } = req.body;
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
        activityId: null, status: 'DRAFT',
        orderIndex: processNodes.filter((n) => n.level === 'VALUE_STREAM').length,
        orgId: DEV_ORG_ID, orgIds: [DEV_ORG_ID], ownerId: null,
        createdAt: now, updatedAt: now,
      };
      processNodes.push(vsNode);
      created.push(vsNode);

      // Create Process nodes
      for (let pIdx = 0; pIdx < (tvs.processes || []).length; pIdx++) {
        const proc = tvs.processes[pIdx];
        const procNode: ProcessNode = {
          id: uuid(), parentId: vsNode.id, level: 'PROCESS',
          name: proc.name, description: proc.description || '',
          activityId: null, status: 'DRAFT', orderIndex: pIdx,
          orgId: DEV_ORG_ID, orgIds: [DEV_ORG_ID], ownerId: null,
          createdAt: now, updatedAt: now,
        };
        processNodes.push(procNode);
        created.push(procNode);

        // Create SubProcess or Activity nodes
        for (let spIdx = 0; spIdx < (proc.subProcesses || []).length; spIdx++) {
          const sp = proc.subProcesses[spIdx];
          const spNode: ProcessNode = {
            id: uuid(), parentId: procNode.id, level: 'SUBPROCESS',
            name: sp.name, description: sp.description || '',
            activityId: null, status: 'DRAFT', orderIndex: spIdx,
            orgId: DEV_ORG_ID, orgIds: [DEV_ORG_ID], ownerId: null,
            createdAt: now, updatedAt: now,
          };
          processNodes.push(spNode);
          created.push(spNode);

          // Create Activity nodes from steps
          const prevActivities: ProcessNode[] = [];
          for (let stIdx = 0; stIdx < (sp.steps || []).length; stIdx++) {
            const st = sp.steps[stIdx];
            const actNode: ProcessNode = {
              id: uuid(), parentId: spNode.id, level: 'ACTIVITY',
              name: st.name, description: st.description || '',
              activityId: generateActivityId(), status: 'DRAFT', orderIndex: stIdx,
              orgId: DEV_ORG_ID, orgIds: [DEV_ORG_ID], ownerId: null,
              createdAt: now, updatedAt: now,
            };
            processNodes.push(actNode);
            created.push(actNode);

            // Create sequence flow from previous activity
            if (prevActivities.length > 0) {
              const prevAct = prevActivities[prevActivities.length - 1];
              flowRelationships.push({
                id: uuid(), fromNodeId: prevAct.id, toNodeId: actNode.id,
                type: 'SEQUENCE', condition: null, label: null, createdAt: now,
              });
            }
            prevActivities.push(actNode);
          }
        }
      }
    }

    logger.info({ count: created.length, industry }, 'Applied template with universal hierarchy');
    res.status(201).json({ success: true, data: created, tree: buildTree(processNodes) });
  } catch (err) {
    logger.error({ err }, 'Apply template failed');
    res.status(500).json({ success: false, error: 'Failed to apply template' });
  }
});

export default router;
