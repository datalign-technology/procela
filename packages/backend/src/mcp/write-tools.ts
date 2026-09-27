// ──────────────────────────────────────────────────────────────────────────
// Write MCP tools over the Procela governed catalog — the separately-hardened
// mutation phase (docs/MCP_SERVER_DESIGN.md §4, threat T8).
//
// Every write tool: (1) asserts the caller's role carries the entity's *:write
// permission (an agent inherits the acting user's role — never an escalation
// path), (2) resolves & authorizes the target org, (3) validates the change
// against the same rules the REST API enforces, (4) persists through the SAME
// repositories the UI writes through, and (5) writes a before/after entry to
// the hash-chained audit log with the real entity id. They are registered only
// when MCP_WRITE_ENABLED is set (a third gate on top of the server's two), and
// each carries MCP annotations (non-read-only / destructive / idempotent) so a
// client asks the human before calling — the protocol-level confirmation.
//
// The persistence + org-status-mode lookups are injected so the tool logic is
// unit-testable without a live store; server.ts wires the real implementations.
// ──────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type { ToolDefinition } from './protocol';
import { jsonResult, McpError, RPC } from './protocol';
import type { Session } from './identity';
import { type OrgCatalog, ownerIdOf, type ProcessNode } from './catalog';
import type { OwnerEntityType, OrgStatusMode } from './mutations';
import { SIMPLE_TRANSITIONS, REVIEW_TRANSITIONS, ADVANCED_TRANSITIONS } from '../routes/process-catalog';
import { TASK_TYPES, TASK_PRIORITIES, type StoredGovernanceTask } from '../routes/governance-tasks';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// The lifecycle states set_status will move a process node between. These three
// exist in every status mode and carry no review-workflow bookkeeping
// (submittedBy / reviewedBy / notifications). Transitions into or out of a
// review state (PENDING_REVIEW / PROPOSED / UNDER_REVIEW / APPROVED) are
// declined and directed to the app, so the MCP path can never leave a node in a
// half-initialised review state.
const PLAIN_STATUSES = new Set(['DRAFT', 'ACTIVE', 'DEPRECATED']);

const TRANSITIONS: Record<OrgStatusMode, Record<string, string[]>> = {
  simple: SIMPLE_TRANSITIONS,
  review: REVIEW_TRANSITIONS,
  advanced: ADVANCED_TRANSITIONS,
};

// entityType arg → the write permission and the audit entityType label. Domains
// live in the data-asset RBAC bucket, matching the REST mount.
const OWNER_META: Record<OwnerEntityType, { permission: string; auditType: string; label: string }> = {
  process: { permission: 'process:write', auditType: 'ProcessNode', label: 'process' },
  asset: { permission: 'data-asset:write', auditType: 'DataAsset', label: 'data asset' },
  system: { permission: 'system:write', auditType: 'System', label: 'system' },
  domain: { permission: 'data-asset:write', auditType: 'DataDomain', label: 'data domain' },
};

export interface WriteDeps {
  session: Session;
  loadCatalog: (orgId: string) => Promise<OrgCatalog>;
  updateEntityOwner: (entityType: OwnerEntityType, id: string, ownerId: string | null) => Promise<{ id: string; name: string } | null>;
  updateNodeStatus: (id: string, status: string) => Promise<ProcessNode | null>;
  createTask: (task: StoredGovernanceTask) => Promise<StoredGovernanceTask>;
  statusModeOf: (orgId: string) => OrgStatusMode;
}

const orgIdProp = { orgId: { type: 'string', description: 'Organization id (company or division). Defaults to your own org.' } };

export function buildWriteTools(deps: WriteDeps): ToolDefinition[] {
  const { session } = deps;

  return [
    {
      name: 'assign_owner',
      description: 'Assign the accountable owner of a process, data asset, system, or data domain. The new owner must be a person in the organization. Overwrites any current owner.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['process', 'asset', 'system', 'domain'], description: 'What kind of entity the id names.' },
          entityId: { type: 'string', description: 'The entity id.' },
          ownerId: { type: 'string', description: 'The person id to make the accountable owner.' },
          ...orgIdProp,
        },
        required: ['entityType', 'entityId', 'ownerId'],
      },
      handler: async (args) => {
        const entityType = str(args.entityType) as OwnerEntityType | undefined;
        const entityId = str(args.entityId);
        const ownerId = str(args.ownerId);
        if (!entityType || !(entityType in OWNER_META) || !entityId || !ownerId) {
          throw new McpError('entityType, entityId and ownerId are required.', RPC.INVALID_PARAMS);
        }
        const meta = OWNER_META[entityType];
        session.assertWrite(meta.permission);
        const orgId = session.resolveOrg(args.orgId);
        const cat = await deps.loadCatalog(orgId);

        const pool = entityType === 'process' ? cat.nodes
          : entityType === 'asset' ? cat.assets
            : entityType === 'system' ? cat.systems
              : cat.domains;
        const entity = (pool as Array<{ id: string; name: string }>).find((e) => e.id === entityId);
        if (!entity) throw new McpError(`No such ${meta.label} in this organization.`, RPC.INVALID_PARAMS);

        // The new owner must be a real person in the caller's org scope.
        const ownerName = cat.nameOf(ownerId);
        if (!ownerName) throw new McpError('No such person in this organization.', RPC.INVALID_PARAMS);

        const previousOwnerId = ownerIdOf(entityType, entity as never);
        if (previousOwnerId === ownerId) {
          return jsonResult({ entityType, id: entity.id, name: entity.name, owner: { id: ownerId, name: ownerName }, changed: false, note: 'Already the owner — no change.' });
        }

        const updated = await deps.updateEntityOwner(entityType, entityId, ownerId);
        if (!updated) throw new McpError(`No such ${meta.label} in this organization.`, RPC.INVALID_PARAMS);
        session.auditWrite(orgId, meta.auditType, entityId, 'MCP_ASSIGN_OWNER',
          { ownerId: previousOwnerId }, { ownerId });
        return jsonResult({
          entityType, id: updated.id, name: updated.name, changed: true,
          previousOwner: previousOwnerId ? { id: previousOwnerId, name: cat.nameOf(previousOwnerId) } : null,
          owner: { id: ownerId, name: ownerName },
        });
      },
    },
    {
      name: 'set_status',
      description: 'Change a process node\'s lifecycle status (Draft / Active / Deprecated). The transition must be allowed by the organization\'s status workflow. Review-workflow transitions (pending review, under review, approved) are only available in the app.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The process node id (value stream, process, sub-process, or activity).' },
          status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'DEPRECATED'], description: 'The target status.' },
          ...orgIdProp,
        },
        required: ['nodeId', 'status'],
      },
      handler: async (args) => {
        session.assertWrite('process:write');
        const nodeId = str(args.nodeId);
        const status = str(args.status)?.toUpperCase();
        if (!nodeId || !status) throw new McpError('nodeId and status are required.', RPC.INVALID_PARAMS);
        if (!PLAIN_STATUSES.has(status)) {
          throw new McpError('status must be one of DRAFT, ACTIVE, DEPRECATED. Review-workflow states are set in the app.', RPC.INVALID_PARAMS);
        }
        const orgId = session.resolveOrg(args.orgId);
        const cat = await deps.loadCatalog(orgId);
        const node = cat.nodes.find((n) => n.id === nodeId);
        if (!node) throw new McpError('No such process node in this organization.', RPC.INVALID_PARAMS);

        if (node.status === status) {
          return jsonResult({ id: node.id, name: node.name, status, changed: false, note: 'Already in that status — no change.' });
        }
        // A node currently in a review-workflow state must be moved along in the
        // app (the MCP path only handles the plain lifecycle).
        if (!PLAIN_STATUSES.has(node.status)) {
          throw new McpError(`"${node.name}" is currently ${node.status.replace('_', ' ').toLowerCase()} — resolve its review workflow in the app.`, RPC.INVALID_REQUEST);
        }
        const mode = deps.statusModeOf(orgId);
        const allowed = (TRANSITIONS[mode][node.status] || []).filter((s) => PLAIN_STATUSES.has(s));
        if (!allowed.includes(status)) {
          throw new McpError(`Cannot change status from ${node.status} to ${status}. Allowed here: ${allowed.join(', ') || 'none'}.`, RPC.INVALID_PARAMS);
        }

        const updated = await deps.updateNodeStatus(nodeId, status);
        if (!updated) throw new McpError('No such process node in this organization.', RPC.INVALID_PARAMS);
        session.auditWrite(orgId, 'ProcessNode', nodeId, 'MCP_SET_STATUS',
          { status: node.status }, { status });
        return jsonResult({ id: updated.id, name: updated.name, previousStatus: node.status, status, changed: true });
      },
    },
    {
      name: 'create_task',
      description: 'Create a governance task (e.g. a stewardship, review, or remediation to-do) in an organization, optionally assigned to a person and linked to a catalog object. Opens in the OPEN status.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short task title.' },
          description: { type: 'string', description: 'What needs to be done.' },
          taskType: { type: 'string', enum: [...TASK_TYPES], description: 'Task category. Defaults to GENERAL.' },
          priority: { type: 'string', enum: [...TASK_PRIORITIES], description: 'Defaults to MEDIUM.' },
          assigneeId: { type: 'string', description: 'Person id to assign to (must be in the organization).' },
          dueDate: { type: 'string', description: 'ISO date the task is due.' },
          linkedObjectType: { type: 'string', description: 'Optional: the type of catalog object this task concerns (e.g. asset, process).' },
          linkedObjectId: { type: 'string', description: 'Optional: the id of the linked catalog object.' },
          ...orgIdProp,
        },
        required: ['title'],
      },
      handler: async (args) => {
        session.assertWrite('governance:write');
        const title = str(args.title);
        if (!title) throw new McpError('title is required.', RPC.INVALID_PARAMS);
        const taskType = (str(args.taskType) ?? 'GENERAL') as StoredGovernanceTask['taskType'];
        if (!(TASK_TYPES as readonly string[]).includes(taskType)) {
          throw new McpError(`taskType must be one of: ${TASK_TYPES.join(', ')}.`, RPC.INVALID_PARAMS);
        }
        const priority = (str(args.priority) ?? 'MEDIUM') as StoredGovernanceTask['priority'];
        if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
          throw new McpError(`priority must be one of: ${TASK_PRIORITIES.join(', ')}.`, RPC.INVALID_PARAMS);
        }
        const orgId = session.resolveOrg(args.orgId);
        const cat = await deps.loadCatalog(orgId);

        const assigneeId = str(args.assigneeId) ?? null;
        if (assigneeId && !cat.nameOf(assigneeId)) {
          throw new McpError('No such person in this organization to assign to.', RPC.INVALID_PARAMS);
        }

        const now = new Date().toISOString();
        const task: StoredGovernanceTask = {
          id: uuid(),
          orgId,
          title,
          description: str(args.description) ?? '',
          taskType,
          status: 'OPEN',
          priority,
          assigneeId,
          dueDate: str(args.dueDate) ?? null,
          linkedObjectType: str(args.linkedObjectType) ?? null,
          linkedObjectId: str(args.linkedObjectId) ?? null,
          automationMode: 'HUMAN',
          createdBy: session.user.sub,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        const created = await deps.createTask(task);
        session.auditWrite(orgId, 'GovernanceTask', created.id, 'MCP_CREATE_TASK', null, created);
        return jsonResult({
          id: created.id, title: created.title, taskType: created.taskType,
          status: created.status, priority: created.priority,
          assignee: assigneeId ? { id: assigneeId, name: cat.nameOf(assigneeId) } : null,
        });
      },
    },
  ];
}
