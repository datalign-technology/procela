import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getFlowRelationshipsRepository } from '../db/flow-relationships.repo';
import { getProcessVersionsRepository } from '../db/process-versions.repo';
import { getSuggestionDismissalsRepository } from '../db/suggestion-dismissals.repo';
import { getVisibleOrgScope, getAncestorOrgIds } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import { rankSuggestions } from '../services/asset-suggestion.service';
import { rankSystemSuggestions } from '../services/system-suggestion.service';
import { rankPeopleSuggestions } from '../services/people-suggestion.service';
// data-assets and mappings both import from this file, so adding the
// matching imports here creates a circular dep. Resolve the
// arrays lazily via require() at request time — by then the cycle
// has resolved and the exports are populated.
// eslint-disable-next-line @typescript-eslint/no-var-requires
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
// Review mode — one review gate between DRAFT and ACTIVE, sized for
// enterprise change control that wants an approver check without the
// four-state ceremony of `advanced`. Segregation of duties (submitter
// ≠ reviewer) enforced separately at the PUT layer.
const REVIEW_TRANSITIONS: Record<string, string[]> = {
  DRAFT:          ['PENDING_REVIEW'],
  PENDING_REVIEW: ['ACTIVE', 'DRAFT'],
  ACTIVE:         ['DRAFT', 'DEPRECATED'],
  DEPRECATED:     ['DRAFT'],
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
const REVIEW_LOCKED = new Set(['PENDING_REVIEW', 'ACTIVE', 'DEPRECATED']);
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
  /** Specific person carrying the responsible role on this node, when
   *  it's one. Always paired with `responsibleRole`; the UI only allows
   *  picking a person who actually holds that role on the Governance
   *  Roles page, but the backend doesn't enforce that — it only checks
   *  the id resolves to a real person, so role-holder reshuffles don't
   *  retroactively invalidate this row. */
  responsiblePersonId?: string | null;
  statusJustification?: string;
  frequency?: string;
  riskLevel?: string;
  automationLevel?: string;
  estimatedDuration?: string;
  requiredSkillIds?: string[];
  /** Business-continuity classification — TIER_1 (mission-critical),
   *  TIER_2 (business-critical), TIER_3 (standard), TIER_4 (non-
   *  critical). Utilities use this for BCM planning; a regulator
   *  asking "what's the RTO for outage triage?" needs an answer
   *  the platform can produce. Undefined = "Not rated". */
  criticalityTier?: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4';
  /** Recovery Time Objective in hours — how long can this process be
   *  down before it materially affects the business? Paired with
   *  criticalityTier for BCM reports. Zero means "must never fail";
   *  undefined means "not set". */
  rtoHours?: number;
  /** Measurable success criterion — free-text, e.g. "Field crew on
   *  site within 30 minutes for Tier 1 outages". Complements the
   *  narrative `businessOutcome` with a target you can build a
   *  dashboard against. */
  successMeasure?: string;
  /** SLA target — free-text so operators can express "P95 4h" or
   *  "99.9% monthly" or "Same business day" without a schema war.
   *  Rendered next to `successMeasure` on the activity detail. */
  slaTarget?: string;
  /** Governance controls this activity implements or is subject to.
   *  IDs point at StoredGovernanceControl rows. Cascade: when a
   *  control is deleted, its id is swept from every activity's
   *  controlIds so nothing dangles. */
  controlIds?: string[];
  // ── Change-management review workflow ─────────────────────────
  // Populated when the org's status mode is `review` and the node
  // transits DRAFT → PENDING_REVIEW → ACTIVE. All five fields are
  // reset when the node returns to DRAFT (a new submission starts
  // its own review cycle) so a rejected item doesn't carry stale
  // approval metadata.
  /** Person id of who submitted the current change for review. Set
   *  on DRAFT → PENDING_REVIEW; unset when the node returns to
   *  DRAFT. */
  submittedBy?: string;
  submittedAt?: string;
  /** Person id of the reviewer who approved / requested changes. Set
   *  on PENDING_REVIEW → (ACTIVE | DRAFT); unset when the node
   *  returns to DRAFT after a new submission. */
  reviewedBy?: string;
  reviewedAt?: string;
  /** Free-text justification from either the submitter (on submit)
   *  or the reviewer (on approve / reject). Kept on the row so the
   *  audit trail travels with the node, not just the version
   *  history log. */
  reviewComment?: string;
  /** Systems the step (or higher-level node) runs on. First-class link
   *  — independent of any data-asset mapping — so a step that runs on a
   *  system without (yet) a mapped data asset is still captured.
   *  Cascaded on system delete by the systems route. */
  systemIds?: string[];
  // Governance vs operational classifier. Replaces the brittle
  // `name.includes('Governance')` runtime checks. Set at creation
  // (governance template → GOVERNANCE; business wizard / manual →
  // OPERATIONAL, inherited from parent), backfilled once on load for
  // pre-existing rows. Optional in the type only so the one-time
  // backfill can run; treat a missing value as OPERATIONAL.
  domain?: 'GOVERNANCE' | 'OPERATIONAL';
  createdAt: string;
  updatedAt: string;
}

// Single source of truth for "is this a governance node?". Prefers the
// persisted `domain` field; falls back to the legacy name heuristic for
// any row not yet backfilled (defensive — the load-time backfill below
// normally fills every row first).
export function isGovernanceNode(n: { domain?: string; name?: string }): boolean {
  if (n.domain) return n.domain === 'GOVERNANCE';
  const name = n.name || '';
  return /governance|data management/i.test(name);
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

export { SIMPLE_TRANSITIONS, REVIEW_TRANSITIONS, ADVANCED_TRANSITIONS, SIMPLE_LOCKED, REVIEW_LOCKED, ADVANCED_LOCKED };
export const processNodes: ProcessNode[] = loadStore<ProcessNode>('processNodes');
registerStore('processNodes', processNodes);
export const flowRelationships: FlowRelationship[] = loadStore<FlowRelationship>('flowRelationships');
registerStore('flowRelationships', flowRelationships);
export const processVersions: ProcessVersion[] = loadStore<ProcessVersion>('processVersions');
registerStore('processVersions', processVersions);

// Phase 3 learning loop. Each row records "user dismissed
// suggestion (kind, targetId) for node (nodeId)" so the scoring
// services can filter it out on subsequent fetches instead of the
// suggestion silently returning. Keyed by composite (nodeId, kind,
// targetId); duplicate POSTs are idempotent.
export interface SuggestionDismissal {
  id: string;
  orgId: string;
  nodeId: string;
  kind: 'asset' | 'system' | 'person';
  targetId: string;
  dismissedBy: string | null;
  dismissedAt: string;
}
export const suggestionDismissals: SuggestionDismissal[] =
  loadStore<SuggestionDismissal>('suggestionDismissals');
registerStore('suggestionDismissals', suggestionDismissals);

const processNodesRepo = getProcessNodesRepository(processNodes);
const flowRelationshipsRepo = getFlowRelationshipsRepository(flowRelationships);
const processVersionsRepo = getProcessVersionsRepository(processVersions);
const suggestionDismissalsRepo = getSuggestionDismissalsRepository(suggestionDismissals);

function dismissedTargetsFor(nodeId: string, kind: SuggestionDismissal['kind']): Set<string> {
  const out = new Set<string>();
  for (const d of suggestionDismissals) {
    if (d.nodeId === nodeId && d.kind === kind) out.add(d.targetId);
  }
  return out;
}

// ── One-time backfill of the `domain` classifier ──
// Pre-existing nodes have no `domain`. Resolve it once from the
// value-stream-ancestor name (the old heuristic), persist, and from
// then on every detection reads the field instead of matching strings.
{
  const byId = new Map(processNodes.map((n) => [n.id, n]));
  const rootDomain = (n: ProcessNode): 'GOVERNANCE' | 'OPERATIONAL' => {
    let cur: ProcessNode | undefined = n;
    const seen = new Set<string>();
    while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return /governance|data management/i.test(cur?.name || '') ? 'GOVERNANCE' : 'OPERATIONAL';
  };
  let backfilled = 0;
  for (const n of processNodes) {
    if (n.domain) continue;
    n.domain = rootDomain(n);
    backfilled++;
  }
  if (backfilled > 0) {
    saveStore('processNodes', processNodes);
    logger.info({ backfilled }, 'Backfilled process node domain classifier');
  }
}

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

// Business-continuity tiers, exported so the frontend picker and the
// tests can enumerate them without magic strings.
export const CRITICALITY_TIERS = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4'] as const;

// Drop any controlIds pointing at controls that don't exist. Silent
// filter so a stale reference lingering on an activity gets pruned on
// the next save instead of surfacing as a dangling id in the UI.
function cleanControlIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { governanceControls } = require('./governance-controls') as typeof import('./governance-controls');
  const known = new Set(governanceControls.map((c) => c.id));
  return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && known.has(id))));
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

// Cascade-delete the process↔data mappings (ProcessDataLink rows) that
// point at deleted step ids. mappings.ts imports from this module, so a
// top-level import here would be circular — use the lazy-require pattern
// the rest of the codebase uses for the same situation. Without this,
// deleting a value stream leaves orphaned mappings that still show up on
// the Process Data Mappings page with a null step.
function cascadeDeleteMappings(stepIds: Set<string>): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./mappings');
    const mappings: Array<{ processStepId: string }> = mod.mappings;
    if (!Array.isArray(mappings)) return 0;
    let removed = 0;
    for (let i = mappings.length - 1; i >= 0; i--) {
      if (stepIds.has(mappings[i].processStepId)) {
        mappings.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) saveStore('mappings', mappings);
    return removed;
  } catch {
    return 0;
  }
}

const router = Router();

/** Validate a systemIds payload — must be an array of strings, each
 *  referencing an existing system. Returns the cleaned/deduped list,
 *  or null after writing a 400 response (caller should return). Uses
 *  lazy-require so this module doesn't pull systems at import time. */
/** Validate a personId — must reference a real person, or be empty /
 *  null to clear. Returns { ok: true, value: id | null } where null
 *  means "clear", or { ok: false } after writing a 400. Lazy-required
 *  to avoid the process-catalog ↔ people cycle. */
function validatePersonId(
  value: unknown,
  res: Response,
): { ok: true; value: string | null } | { ok: false } {
  if (value === '' || value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || !value.trim()) {
    res.status(400).json({ success: false, error: 'personId must be a string id (or empty to clear)' });
    return { ok: false };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { people } = require('./people') as { people: Array<{ id: string }> };
  if (!people.some((p) => p.id === value)) {
    res.status(400).json({ success: false, error: `Unknown person id "${value}"` });
    return { ok: false };
  }
  return { ok: true, value };
}

function validateSystemIds(value: unknown, res: Response): string[] | null {
  if (!Array.isArray(value)) {
    res.status(400).json({ success: false, error: 'systemIds must be an array' });
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { systems } = require('./systems') as { systems: Array<{ id: string }> };
  const known = new Set(systems.map((s) => s.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim()) {
      res.status(400).json({ success: false, error: 'systemIds entries must be non-empty strings' });
      return null;
    }
    if (!known.has(id)) {
      res.status(400).json({ success: false, error: `Unknown system id "${id}"` });
      return null;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ── HIERARCHY NODES ──

/** DELETE /all — delete all process nodes and flow relationships */
router.delete('/all', (_req: Request, res: Response) => {
  const count = processNodes.length;
  const flowCount = flowRelationships.length;
  // Every step is going away, so every mapping is now orphaned.
  const allStepIds = new Set(processNodes.map((n) => n.id));
  processNodes.splice(0, processNodes.length);
  flowRelationships.splice(0, flowRelationships.length);
  const mappingsRemoved = cascadeDeleteMappings(allStepIds);
  saveStore('processNodes', processNodes);
  saveStore('flowRelationships', flowRelationships);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', '*', 'DELETE_ALL', null, { count, flowCount, mappingsRemoved });
  logger.info({ count, flowCount, mappingsRemoved }, 'Deleted all process nodes and flow relationships');
  res.json({ success: true, deleted: count + flowCount });
});

/** GET / — list all nodes as flat list + tree + metadata */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  // Governance content is defined once at the top of the org tree
  // (company / enterprise level) and applies everywhere below it —
  // divisions are subject to it but don't own it. Before this
  // filter, `filterByOrgScope`'s ancestor walk pulled enterprise
  // governance value streams down into every division's Process
  // Catalog, inflating counts and showing a locked row a division
  // user can't act on. Default behaviour is now: hide governance
  // nodes whose orgId is a strict ancestor of the active scope.
  // Governance defined AT the active scope or BELOW it still shows,
  // and the query param below lets a user opt back in when they
  // deliberately want to see what enterprise governance applies to
  // them from their division seat.
  const includeAncestorGovernance = req.query.includeAncestorGovernance === 'true';
  const filtered = orgId
    ? (() => {
        const scope = getVisibleOrgScope(orgId as string)!;
        const ancestors = getAncestorOrgIds(orgId as string) ?? new Set<string>();
        return processNodes.filter((n) => {
          const inScope = scope.has(n.orgId) || n.orgIds.some((id) => scope.has(id));
          if (!inScope) return false;
          if (!includeAncestorGovernance && n.domain === 'GOVERNANCE' && ancestors.has(n.orgId)) {
            return false;
          }
          return true;
        });
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
router.post('/nodes', async (req: Request, res: Response) => {
  const { parentId, level, name, description, status, orgIds, ownerId,
    purpose, businessOutcome, stakeholders, complianceTags, inputsOutputs,
    responsibleRole, responsiblePersonId, statusJustification, frequency, riskLevel, automationLevel, estimatedDuration, requiredSkillIds, systemIds,
    criticalityTier, rtoHours, successMeasure, slaTarget, controlIds } = req.body;

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

  // Lazy-require to avoid a process-catalog ↔ systems import cycle.
  // Returns the cleaned, deduped, validated list or null if the request
  // referenced an unknown system id.
  const cleanedSystemIds = systemIds === undefined
    ? undefined
    : validateSystemIds(systemIds, res);
  if (cleanedSystemIds === null) return;

  // Responsible Person — only allowed at the activity / task level
  // (other levels use Owner). The picker enforces "must hold the role";
  // the backend just verifies the id resolves to a real person.
  let cleanedResponsiblePersonId: string | null | undefined = undefined;
  if (responsiblePersonId !== undefined) {
    const v = validatePersonId(responsiblePersonId, res);
    if (!v.ok) return;
    cleanedResponsiblePersonId = v.value;
  }

  const siblings = parentId
    ? processNodes.filter((n) => n.parentId === parentId)
    : processNodes.filter((n) => n.level === 'VALUE_STREAM');

  const now = new Date().toISOString();
  // A child node belongs to whatever domain its parent does; a new
  // top-level value stream created by hand is operational (the
  // governance hierarchy only comes from the governance template).
  const parentForDomain = parentId ? findNode(parentId) : null;
  const nodeDomain: 'GOVERNANCE' | 'OPERATIONAL' =
    parentForDomain?.domain === 'GOVERNANCE' ? 'GOVERNANCE' : 'OPERATIONAL';
  const node: ProcessNode = {
    id: uuid(),
    parentId: parentId || null,
    level: level as NodeLevel,
    name,
    description: description || '',
    activityId: generateNodeId(level as string) || null,
    status: status || 'DRAFT',
    orderIndex: siblings.length,
    orgId: (orgIds && orgIds.length > 0) ? orgIds[0] : DEV_ORG_ID,
    orgIds: orgIds || [DEV_ORG_ID],
    ownerId: ownerId || null,
    version: 1,
    ...(purpose ? { purpose } : {}),
    ...(businessOutcome ? { businessOutcome } : {}),
    ...(stakeholders ? { stakeholders } : {}),
    ...(complianceTags?.length ? { complianceTags } : {}),
    ...(inputsOutputs ? { inputsOutputs } : {}),
    ...(responsibleRole ? { responsibleRole } : {}),
    ...(cleanedResponsiblePersonId ? { responsiblePersonId: cleanedResponsiblePersonId } : {}),
    ...(statusJustification ? { statusJustification } : {}),
    ...(Array.isArray(requiredSkillIds) && requiredSkillIds.length ? { requiredSkillIds } : {}),
    ...(cleanedSystemIds && cleanedSystemIds.length ? { systemIds: cleanedSystemIds } : {}),
    // New attributes — only persist when supplied so existing rows
    // don't grow "" placeholders and pickers stay clean.
    ...(criticalityTier && CRITICALITY_TIERS.includes(criticalityTier) ? { criticalityTier } : {}),
    ...(typeof rtoHours === 'number' && rtoHours >= 0 ? { rtoHours } : {}),
    ...(successMeasure ? { successMeasure } : {}),
    ...(slaTarget ? { slaTarget } : {}),
    ...(Array.isArray(controlIds) && controlIds.length ? { controlIds: cleanControlIds(controlIds) } : {}),
    domain: nodeDomain,
    createdAt: now,
    updatedAt: now,
  };

  await processNodesRepo.create(node);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', node.id, 'CREATE', null, node);
  logger.info({ level, name, parentId }, 'Created process node');

  res.status(201).json({
    success: true,
    data: node,
    validChildLevels: VALID_CHILDREN[node.level],
  });
});

/** PUT /nodes/:id — update a node */
router.put('/nodes/:id', async (req: Request, res: Response) => {
  const node = findNode(param(req.params.id));
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  const { name, description, status, orderIndex, orgIds, ownerId, parentId, version,
    purpose, businessOutcome, stakeholders, complianceTags, inputsOutputs,
    responsibleRole, responsiblePersonId, statusJustification, frequency, riskLevel, automationLevel, estimatedDuration, requiredSkillIds, systemIds,
    criticalityTier, rtoHours, successMeasure, slaTarget, controlIds,
    reviewComment } = req.body;

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
    || complianceTags !== undefined || inputsOutputs !== undefined || responsibleRole !== undefined
    || frequency !== undefined || riskLevel !== undefined || automationLevel !== undefined || estimatedDuration !== undefined
    || requiredSkillIds !== undefined || systemIds !== undefined
    || responsiblePersonId !== undefined
    || criticalityTier !== undefined || rtoHours !== undefined
    || successMeasure !== undefined || slaTarget !== undefined
    || controlIds !== undefined;
  // Resolve org's status mode to determine which transitions/locks apply
  const nodeOrg = organizations.find((o) => o.id === node.orgId);
  const mode = nodeOrg?.statusMode || 'simple';
  const lockedSet = mode === 'advanced' ? ADVANCED_LOCKED : mode === 'review' ? REVIEW_LOCKED : SIMPLE_LOCKED;
  const transitionMap = mode === 'advanced' ? ADVANCED_TRANSITIONS : mode === 'review' ? REVIEW_TRANSITIONS : SIMPLE_TRANSITIONS;

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
  if (responsiblePersonId !== undefined) {
    const v = validatePersonId(responsiblePersonId, res);
    if (!v.ok) return;
    node.responsiblePersonId = v.value;
  }
  if (statusJustification !== undefined) node.statusJustification = statusJustification;
  if (frequency !== undefined) node.frequency = frequency;
  if (riskLevel !== undefined) node.riskLevel = riskLevel;
  if (automationLevel !== undefined) node.automationLevel = automationLevel;
  if (estimatedDuration !== undefined) node.estimatedDuration = estimatedDuration;
  if (requiredSkillIds !== undefined) node.requiredSkillIds = Array.isArray(requiredSkillIds) ? requiredSkillIds : [];
  if (systemIds !== undefined) {
    const cleaned = validateSystemIds(systemIds, res);
    if (cleaned === null) return;
    node.systemIds = cleaned.length > 0 ? cleaned : undefined;
  }
  // BCM + governance attributes — accept undefined (leave unchanged),
  // null / empty (clear), or the new value. Enum + range checks so
  // malformed callers see a 400 rather than a silent no-op.
  if (criticalityTier !== undefined) {
    if (criticalityTier === null || criticalityTier === '') {
      node.criticalityTier = undefined;
    } else if (CRITICALITY_TIERS.includes(criticalityTier)) {
      node.criticalityTier = criticalityTier;
    } else {
      res.status(400).json({ success: false, error: `Unknown criticalityTier "${criticalityTier}". Expected one of: ${CRITICALITY_TIERS.join(', ')}.` });
      return;
    }
  }
  if (rtoHours !== undefined) {
    if (rtoHours === null || rtoHours === '') {
      node.rtoHours = undefined;
    } else if (typeof rtoHours === 'number' && rtoHours >= 0) {
      node.rtoHours = rtoHours;
    } else {
      res.status(400).json({ success: false, error: 'rtoHours must be a non-negative number.' });
      return;
    }
  }
  if (successMeasure !== undefined) node.successMeasure = successMeasure || undefined;
  if (slaTarget !== undefined) node.slaTarget = slaTarget || undefined;
  if (controlIds !== undefined) {
    node.controlIds = Array.isArray(controlIds) && controlIds.length > 0
      ? cleanControlIds(controlIds)
      : undefined;
  }

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
    await processVersionsRepo.create(versionSnapshot);
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

    // ── Change-management review workflow (statusMode === 'review') ──
    // Track who submitted / who approved on the row itself so the
    // audit trail travels with the node and the UI can render the
    // Pending-review chip without walking the version log.
    const actingPersonId: string | null = (req as any).user?.sub || null;
    if (mode === 'review') {
      if (oldStatus === 'DRAFT' && status === 'PENDING_REVIEW') {
        if (!actingPersonId) {
          res.status(401).json({ success: false, error: 'Sign in required to submit for review.' });
          return;
        }
        node.submittedBy = actingPersonId;
        node.submittedAt = new Date().toISOString();
        // A fresh submission clears the prior reviewer decision so the
        // node doesn't carry stale approval metadata from a rejected
        // earlier cycle.
        node.reviewedBy = undefined;
        node.reviewedAt = undefined;
        if (typeof reviewComment === 'string') node.reviewComment = reviewComment;
      } else if (oldStatus === 'PENDING_REVIEW' && (status === 'ACTIVE' || status === 'DRAFT')) {
        // Segregation of duties — the submitter is not allowed to
        // approve their own submission. Rejection (→ DRAFT) is
        // allowed because self-withdrawal must always be possible.
        if (status === 'ACTIVE' && actingPersonId && node.submittedBy && actingPersonId === node.submittedBy) {
          res.status(403).json({
            success: false,
            error: 'The submitter cannot approve their own change. A different reviewer must sign off.',
          });
          return;
        }
        if (actingPersonId) {
          node.reviewedBy = actingPersonId;
          node.reviewedAt = new Date().toISOString();
        }
        if (typeof reviewComment === 'string') node.reviewComment = reviewComment;
      } else if (status === 'DRAFT') {
        // Any other transition back to DRAFT (e.g. from ACTIVE) clears
        // the review metadata — a new draft starts its own cycle.
        node.submittedBy = undefined;
        node.submittedAt = undefined;
        node.reviewedBy = undefined;
        node.reviewedAt = undefined;
        node.reviewComment = undefined;
      }
    }

    node.status = status;

    // Workflow notifications on status transitions
    if (status !== oldStatus) {
      const levelLabel = node.level.toLowerCase().replace('_', ' ');
      if (status === 'PENDING_REVIEW') {
        // Notify the org — the org admins pick it up from the
        // "Pending review" tile on the Dashboard. Directed to a
        // specific reviewer would need a reviewer-assignment model;
        // v1 fans out to the org so any authorised approver can act.
        createNotification({
          orgId: node.orgId,
          type: 'ACTION',
          title: `Change submitted for review: ${node.name}`,
          message: `A change to the ${levelLabel} "${node.name}" has been submitted for review.`,
          link: `/processes?node=${node.id}`,
        });
      } else if (status === 'ACTIVE') {
        // Notify the original submitter that their change was
        // approved, when we know who they were.
        if (node.submittedBy) {
          createNotification({
            orgId: node.orgId,
            userId: node.submittedBy,
            type: 'INFO',
            title: `Change approved: ${node.name}`,
            message: `Your change to the ${levelLabel} "${node.name}" was approved and is now Active.`,
            link: `/processes?node=${node.id}`,
          });
        }
        createNotification({
          orgId: node.orgId,
          type: 'INFO',
          title: `Process '${node.name}' is now active`,
          message: `The ${levelLabel} "${node.name}" is now active in the process catalog.`,
          link: '/processes',
        });
      } else if (status === 'DRAFT' && oldStatus === 'PENDING_REVIEW') {
        // Rejection — tell the submitter what the reviewer said.
        if (node.submittedBy) {
          createNotification({
            orgId: node.orgId,
            userId: node.submittedBy,
            type: 'WARNING',
            title: `Changes requested: ${node.name}`,
            message: node.reviewComment
              ? `The reviewer requested changes on "${node.name}": "${node.reviewComment}".`
              : `The reviewer requested changes on "${node.name}". Update and resubmit.`,
            link: `/processes?node=${node.id}`,
          });
        }
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

  await processNodesRepo.update(node.id, node);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', node.id, 'UPDATE', null, node);
  res.json({ success: true, data: node });
});

/** DELETE /nodes/:id — delete a node and all descendants */
router.delete('/nodes/:id', async (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  // Collect all descendants
  const descendants = getDescendants(nodeId);
  const idsToRemove = new Set([nodeId, ...descendants.map((d) => d.id)]);

  // Remove all nodes
  for (const id of idsToRemove) {
    await processNodesRepo.delete(id);
  }

  // Remove flow relationships involving deleted nodes
  const flowsToRemove = flowRelationships.filter(
    (f) => idsToRemove.has(f.fromNodeId) || idsToRemove.has(f.toNodeId),
  );
  for (const f of flowsToRemove) {
    await flowRelationshipsRepo.delete(f.id);
  }

  // Cascade: drop data mappings that referenced any deleted step.
  const mappingsRemoved = cascadeDeleteMappings(idsToRemove);

  auditService.log(DEV_ORG_ID, null, 'ProcessNode', nodeId, 'DELETE', node, null);
  logger.info({ id: nodeId, level: node.level, descendantsRemoved: descendants.length, mappingsRemoved }, 'Deleted process node');

  res.status(204).send();
});

/** POST /nodes/:id/clone — deep-clone a node and all its descendants */
router.post('/nodes/:id/clone', async (req: Request, res: Response) => {
  const source = findNode(param(req.params.id));
  if (!source) { res.status(404).json({ success: false, error: 'Node not found' }); return; }

  const { name } = req.body;
  const now = new Date().toISOString();
  const idMap = new Map<string, string>(); // old ID -> new ID

  // Collect source node and all descendants
  const allNodes = [source, ...getDescendants(source.id)];

  // Generate new IDs for every node
  for (const node of allNodes) {
    idMap.set(node.id, uuid());
  }

  // Clone nodes with new IDs and updated parent references
  const cloned: ProcessNode[] = allNodes.map((node, idx) => ({
    ...node,
    id: idMap.get(node.id)!,
    parentId: idx === 0 ? source.parentId : idMap.get(node.parentId!) || null,
    name: idx === 0 ? (name || `${node.name} (copy)`) : node.name,
    activityId: generateNodeId(node.level),
    status: 'DRAFT',
    ownerId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }));

  for (const c of cloned) await processNodesRepo.create(c);
  auditService.log(DEV_ORG_ID, null, 'ProcessNode', cloned[0].id, 'CLONE', null, { sourceId: source.id, count: cloned.length });
  logger.info({ sourceId: source.id, clonedRoot: cloned[0].id, count: cloned.length }, 'Cloned process node tree');

  res.status(201).json({ success: true, data: cloned, message: `Cloned ${cloned.length} nodes` });
});

/** GET /nodes/:id/validate — validate a value stream's integrity */
router.get('/nodes/:id/validate', (req: Request, res: Response) => {
  const result = validateProcessIntegrity(param(req.params.id));
  res.json({ success: true, data: result });
});

/** GET /nodes/:id/asset-suggestions — Phase 3 Discover. Returns a
 *  ranked list of DataAssets that look like good candidates to map to
 *  this process node, based on name + description overlap and shared
 *  system affinity. Always excludes assets already mapped to this
 *  node. ?limit=N caps the response (default 5); ?minScore=X drops
 *  candidates below the threshold (default 0.1). */
router.get('/nodes/:id/asset-suggestions', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) {
    res.status(404).json({ success: false, error: 'Node not found' });
    return;
  }
  const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
  const minScoreRaw = parseFloat(String(req.query.minScore ?? ''));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : undefined;
  const minScore = Number.isFinite(minScoreRaw) ? Math.max(0, Math.min(1, minScoreRaw)) : undefined;
  // Resolve the foreign stores at request time. Static imports here
  // would race against the data-assets / mappings → process-catalog
  // import cycle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dataAssets } = require('./data-assets');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mappings } = require('./mappings');
  const orgAssets = dataAssets.filter((a: any) => a.orgId === node.orgId);
  const dismissed = dismissedTargetsFor(node.id, 'asset');
  const ranked = rankSuggestions(
    { id: node.id, name: node.name, description: node.description, systemIds: node.systemIds },
    orgAssets,
    mappings,
    { limit, minScore },
  );
  const data = ranked.filter((r) => !dismissed.has(r.assetId));
  res.json({ success: true, data });
});

/** GET /nodes/:id/system-suggestions — Phase 3 expansion. Ranked
 *  Systems the node looks like it should declare in its systemIds,
 *  based on name/description overlap and "used by sibling steps".
 *  Excludes systems already declared by the node and any dismissed by
 *  the user. */
router.get('/nodes/:id/system-suggestions', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) {
    res.status(404).json({ success: false, error: 'Node not found' });
    return;
  }
  const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
  const minScoreRaw = parseFloat(String(req.query.minScore ?? ''));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : undefined;
  const minScore = Number.isFinite(minScoreRaw) ? Math.max(0, Math.min(1, minScoreRaw)) : undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { systems } = require('./systems');
  const orgSystems = systems.filter((s: any) => s.orgId === node.orgId);
  const dismissed = dismissedTargetsFor(node.id, 'system');
  const data = rankSystemSuggestions(
    { id: node.id, parentId: node.parentId, name: node.name, description: node.description, systemIds: node.systemIds },
    orgSystems,
    processNodes,
    dismissed,
    { limit, minScore },
  );
  res.json({ success: true, data });
});

/** GET /nodes/:id/people-suggestions — Phase 3 expansion. Ranked
 *  People that look like candidates for involvement on this step,
 *  based on title/jobRole overlap, required-skill match, and ownership
 *  of any system the step already declares. Excludes the existing
 *  owner / responsible person and any dismissed by the user. */
router.get('/nodes/:id/people-suggestions', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) {
    res.status(404).json({ success: false, error: 'Node not found' });
    return;
  }
  const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
  const minScoreRaw = parseFloat(String(req.query.minScore ?? ''));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : undefined;
  const minScore = Number.isFinite(minScoreRaw) ? Math.max(0, Math.min(1, minScoreRaw)) : undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { systems } = require('./systems');
  const orgPeople = people.filter((p: any) => (p.orgIds || []).includes(node.orgId));
  const orgSystems = systems.filter((s: any) => s.orgId === node.orgId);
  const dismissed = dismissedTargetsFor(node.id, 'person');
  const data = rankPeopleSuggestions(
    {
      id: node.id,
      name: node.name,
      description: node.description,
      systemIds: node.systemIds,
      requiredSkillIds: node.requiredSkillIds,
      ownerId: node.ownerId,
      responsiblePersonId: node.responsiblePersonId,
    },
    orgPeople,
    orgSystems,
    dismissed,
    { limit, minScore },
  );
  res.json({ success: true, data });
});

/** GET /data-graph — Phase 3 visualization. Returns the bipartite
 *  process↔data graph as three flat arrays so the frontend can draw
 *  it without N round-trips: every activity in the (optionally
 *  org-scoped) tree, every data asset in scope, and every mapping
 *  edge between them. Each activity carries its parent-process name
 *  for grouping; each asset carries its system + tier for grouping
 *  and badge rendering. Edges carry the linkType so the visualization
 *  can colour or weight them. Excludes governance-domain activities
 *  by default since the data map is an operational view; pass
 *  ?includeGovernance=1 to opt them in. */
router.get('/data-graph', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const includeGov = req.query.includeGovernance === '1' || req.query.includeGovernance === 'true';
  const scope = orgId ? getVisibleOrgScope(orgId as string) : null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dataAssets } = require('./data-assets');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mappings } = require('./mappings');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { systems } = require('./systems');

  const inScope = (n: { orgId: string; orgIds: string[] }) =>
    !scope || scope.has(n.orgId) || (n.orgIds || []).some((id) => scope.has(id));

  const parentNameById = new Map<string, string>();
  for (const n of processNodes) parentNameById.set(n.id, n.name);

  const activities = processNodes
    .filter((n) => n.level === 'ACTIVITY' && inScope(n))
    .filter((n) => includeGov || !isGovernanceNode(n))
    .map((n) => ({
      id: n.id,
      name: n.name,
      parentProcessId: n.parentId,
      parentProcessName: n.parentId ? parentNameById.get(n.parentId) || null : null,
      systemIds: n.systemIds || [],
    }));
  const activityIdSet = new Set(activities.map((a) => a.id));

  const orgAssetIds = new Set<string>();
  const assetsOut = dataAssets
    .filter((a: any) => !scope || scope.has(a.orgId))
    .map((a: any) => {
      orgAssetIds.add(a.id);
      const sysName = a.systemId
        ? systems.find((s: any) => s.id === a.systemId)?.name || null
        : null;
      return {
        id: a.id,
        name: a.name,
        systemId: a.systemId,
        systemName: sysName,
        governanceTier: a.governanceTier,
      };
    });

  const edges = mappings
    .filter((m: any) => m.dataAssetId && activityIdSet.has(m.processStepId) && orgAssetIds.has(m.dataAssetId))
    .map((m: any) => ({
      mappingId: m.id,
      activityId: m.processStepId,
      assetId: m.dataAssetId,
      linkType: m.linkType,
    }));

  // Keep only assets that actually participate in an edge — the
  // visualization showing every orphan asset on the right column
  // crushes the layout and orphans have their own dedicated page.
  const referencedAssetIds = new Set(edges.map((e: any) => e.assetId));
  const visibleAssets = assetsOut.filter((a: any) => referencedAssetIds.has(a.id));

  res.json({
    success: true,
    data: {
      activities,
      assets: visibleAssets,
      edges,
      stats: {
        activityCount: activities.length,
        assetCount: visibleAssets.length,
        edgeCount: edges.length,
        mappedActivityCount: new Set(edges.map((e: any) => e.activityId)).size,
      },
    },
  });
});

/** POST /nodes/:id/suggestions/dismiss — Phase 3 learning loop. Body
 *  { kind: 'asset'|'system'|'person', targetId } records a dismissal
 *  that hides the suggestion from future ranks for this node.
 *  Idempotent: a duplicate dismissal returns the existing row rather
 *  than 409. */
router.post('/nodes/:id/suggestions/dismiss', async (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const node = findNode(nodeId);
  if (!node) { res.status(404).json({ success: false, error: 'Node not found' }); return; }
  const { kind, targetId } = req.body || {};
  if (kind !== 'asset' && kind !== 'system' && kind !== 'person') {
    res.status(400).json({ success: false, error: 'kind must be asset, system, or person' });
    return;
  }
  if (typeof targetId !== 'string' || !targetId.trim()) {
    res.status(400).json({ success: false, error: 'targetId is required' });
    return;
  }
  const existing = suggestionDismissals.find(
    (d) => d.nodeId === nodeId && d.kind === kind && d.targetId === targetId,
  );
  if (existing) { res.json({ success: true, data: existing }); return; }
  const row: SuggestionDismissal = {
    id: uuid(),
    orgId: node.orgId,
    nodeId,
    kind,
    targetId,
    dismissedBy: (req as any).user?.id ?? null,
    dismissedAt: new Date().toISOString(),
  };
  await suggestionDismissalsRepo.create(row);
  auditService.log(node.orgId, row.dismissedBy, 'SuggestionDismissal', row.id, 'CREATE', null, row);
  res.status(201).json({ success: true, data: row });
});

/** DELETE /nodes/:id/suggestions/dismiss/:kind/:targetId — undo a
 *  prior dismissal so the suggestion can come back. */
router.delete('/nodes/:id/suggestions/dismiss/:kind/:targetId', async (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const kind = param(req.params.kind);
  const targetId = param(req.params.targetId);
  const removed = suggestionDismissals.find(
    (d) => d.nodeId === nodeId && d.kind === kind && d.targetId === targetId,
  );
  if (!removed) { res.status(404).json({ success: false, error: 'Dismissal not found' }); return; }
  await suggestionDismissalsRepo.delete(removed.id);
  auditService.log(removed.orgId, (req as any).user?.id ?? null, 'SuggestionDismissal', removed.id, 'DELETE', removed, null);
  res.json({ success: true });
});

/** GET /nodes/:id/dismissed-suggestions — list dismissals for a node.
 *  Useful for an admin UI that wants to surface "hidden by user" rows
 *  so they can be restored. */
router.get('/nodes/:id/dismissed-suggestions', (req: Request, res: Response) => {
  const nodeId = param(req.params.id);
  const rows = suggestionDismissals.filter((d) => d.nodeId === nodeId);
  res.json({ success: true, data: rows });
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

/** GET /flows/by-node/:nodeId — get flows for a specific node.
 *
 *  Enriches each flow row with the "other end" node's name, level,
 *  status, and its ancestor breadcrumb (`Value Stream > Process >
 *  Sub-Process > Activity`), so the Dependencies panel on the
 *  Activity detail doesn't need to run a second lookup and doesn't
 *  need the full node list in local state to render.
 */
router.get('/flows/by-node/:nodeId', (req: Request, res: Response) => {
  const nodeId = param(req.params.nodeId);
  const outgoing = flowRelationships
    .filter((f) => f.fromNodeId === nodeId)
    .map((f) => ({ ...f, other: nodeSummary(f.toNodeId) }));
  const incoming = flowRelationships
    .filter((f) => f.toNodeId === nodeId)
    .map((f) => ({ ...f, other: nodeSummary(f.fromNodeId) }));
  res.json({
    success: true,
    data: { outgoing, incoming },
  });
});

// Build a compact "other end" summary for a flow. Walk up the tree to
// build the breadcrumb so the caller can render "Outage Management >
// Response > Outage triage" without shipping the whole catalog. Null
// when the referenced node is missing — the row still renders as
// dangling so the user can delete it.
function nodeSummary(id: string): { id: string; name: string; level: string; status: string; breadcrumb: string } | null {
  const node = findNode(id);
  if (!node) return null;
  const crumbs: string[] = [];
  let current: ProcessNode | undefined = node;
  while (current) {
    crumbs.unshift(current.name);
    current = current.parentId ? findNode(current.parentId) : undefined;
  }
  return {
    id: node.id,
    name: node.name,
    level: node.level,
    status: node.status,
    breadcrumb: crumbs.join(' > '),
  };
}

/** POST /flows — create a flow relationship */
router.post('/flows', async (req: Request, res: Response) => {
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

  // Cycle detection — reject if adding this edge would make toNode
  // reachable from itself via any path of SEQUENCE/PARALLEL/CONDITIONAL
  // flows. Walk from `toNodeId` forward; if we hit `fromNodeId` before
  // exhausting the graph, adding the new edge would close a loop.
  // LOOP-type flows are the one edge type where a cycle is intentional
  // — skip the check when the caller is explicitly declaring a LOOP.
  if ((type || 'SEQUENCE') !== 'LOOP') {
    const visited = new Set<string>();
    const queue = [toNodeId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === fromNodeId) {
        res.status(400).json({
          success: false,
          error: `Adding this flow would create a cycle back to ${fromNode.name}. Use a LOOP-type flow if the cycle is intentional.`,
        });
        return;
      }
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const f of flowRelationships) {
        if (f.fromNodeId === cur && f.type !== 'LOOP') queue.push(f.toNodeId);
      }
    }
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

  await flowRelationshipsRepo.create(flow);
  logger.info({ from: fromNode.name, to: toNode.name, type: flow.type }, 'Created flow relationship');

  res.status(201).json({ success: true, data: flow });
});

/** DELETE /flows/:id — delete a flow relationship */
router.delete('/flows/:id', async (req: Request, res: Response) => {
  const flow = flowRelationships.find((f) => f.id === param(req.params.id));
  if (!flow) { res.status(404).json({ success: false, error: 'Flow not found' }); return; }
  await flowRelationshipsRepo.delete(flow.id);
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
        version: 1, domain: 'OPERATIONAL',
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
          version: 1, domain: 'OPERATIONAL',
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
              version: 1, domain: 'OPERATIONAL',
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
            version: 1, domain: 'OPERATIONAL',
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

  // Always create governance processes at the company level — governance
  // is an enterprise function, not per-division. Walk up from the
  // requested org to find the root company.
  let companyOrgId = requestOrgId || DEV_ORG_ID;
  let current = organizations.find((o) => o.id === companyOrgId);
  while (current?.parentId) {
    current = organizations.find((o) => o.id === current!.parentId);
    if (current) companyOrgId = current.id;
  }
  const templateOrgId = companyOrgId;

  // Check if governance processes already exist anywhere in the company
  const existing = processNodes.filter((n) =>
    n.level === 'VALUE_STREAM' && n.orgId === templateOrgId && isGovernanceNode(n),
  );
  if (existing.length > 0) {
    const companyName = organizations.find((o) => o.id === templateOrgId)?.name || templateOrgId;
    res.json({ success: true, data: [], message: `Governance processes already exist at ${companyName}. Delete them to regenerate.` });
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
            { name: 'Define Data Governance Charter', description: 'Establish governance mission, vision, principles, and decision rights', responsibleRole: 'Chief Data Officer', inputsOutputs: 'In: business strategy, regulatory requirements, industry benchmarks. Out: governance charter, decision rights matrix, guiding principles.' },
            { name: 'Establish Data Policies', description: 'Create policies for data quality, security, privacy, retention, and sharing', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: governance charter, regulatory requirements, risk assessments. Out: data policies, compliance guidelines, policy approval records.' },
            { name: 'Define Data Standards', description: 'Set naming conventions, data definitions, and formatting rules', responsibleRole: 'Data Architect', inputsOutputs: 'In: data policies, existing data models, business glossary. Out: naming conventions, data type standards, formatting rules.' },
            { name: 'Review and Update Policies', description: 'Periodic review of policies against regulatory changes and business needs', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: current policies, regulatory updates, audit findings, stakeholder feedback. Out: updated policies, change log, stakeholder notifications.' },
            { name: 'Communicate Policy Changes', description: 'Distribute updates to stakeholders and ensure awareness', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: approved policy changes, stakeholder list. Out: communication records, training materials, acknowledgment receipts.' },
          ],
        },
        {
          name: 'Data Quality Management',
          description: 'Monitor, measure, and improve data quality across the organization',
          purpose: 'Ensure data meets defined quality standards for accuracy, completeness, and timeliness',
          activities: [
            { name: 'Define Quality Rules & Thresholds', description: 'Establish measurable quality criteria per data asset and domain', responsibleRole: 'Data Quality Analyst', inputsOutputs: 'In: data asset catalog, domain definitions, business requirements. Out: quality rule definitions, threshold standards, measurement criteria.' },
            { name: 'Execute Quality Assessments', description: 'Run quality rules against data assets on schedule or on-demand', responsibleRole: 'Data Quality Analyst', inputsOutputs: 'In: quality rules, data assets, schedule configuration. Out: quality scores, pass/fail results, execution logs.' },
            { name: 'Analyze Quality Results', description: 'Review scores, identify trends, and flag critical failures', responsibleRole: 'Data Quality Analyst', inputsOutputs: 'In: quality scores, historical trends, threshold definitions. Out: analysis report, trend charts, critical failure alerts.' },
            { name: 'Investigate Root Causes', description: 'Trace quality issues to source systems, processes, or manual errors', responsibleRole: 'Business Data Steward', inputsOutputs: 'In: failure alerts, data lineage, system logs. Out: root cause analysis, source system identification, remediation recommendations.' },
            { name: 'Implement Remediation', description: 'Fix data issues and update processes to prevent recurrence', responsibleRole: 'Technical Data Steward', inputsOutputs: 'In: root cause analysis, remediation plan. Out: corrected data, updated processes, prevention controls.' },
            { name: 'Report Quality Metrics', description: 'Publish quality dashboards and scorecards for stakeholders', responsibleRole: 'Data Quality Analyst', inputsOutputs: 'In: quality scores, trend data, SLA definitions. Out: quality dashboards, scorecards, executive summaries.' },
          ],
        },
        {
          name: 'Data Domain Management',
          description: 'Organize data into governed domains with clear ownership and stewardship',
          purpose: 'Ensure every data asset has an accountable owner and active steward',
          activities: [
            { name: 'Define Data Domains', description: 'Identify and scope data domains (Customer, Financial, Operational, etc.)', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: business capabilities, data asset inventory, organizational structure. Out: domain definitions, scope boundaries, domain catalog.' },
            { name: 'Assign Domain Owners', description: 'Designate accountable business owners for each domain', responsibleRole: 'Chief Data Officer', inputsOutputs: 'In: domain definitions, organizational chart, executive sponsorship. Out: owner assignments, accountability matrix, communication to owners.' },
            { name: 'Assign Data Stewards', description: 'Designate day-to-day stewards responsible for data quality within domains', responsibleRole: 'Data Owner', inputsOutputs: 'In: domain scope, team structure, skill requirements. Out: steward assignments, role descriptions, onboarding materials.' },
            { name: 'Map Assets to Domains', description: 'Link data assets to their governing domains', responsibleRole: 'Business Data Steward', inputsOutputs: 'In: data asset catalog, domain definitions. Out: asset-to-domain mappings, coverage report, orphan asset list.' },
            { name: 'Review Domain Coverage', description: 'Identify orphaned assets and gaps in domain assignment', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: asset-to-domain mappings, data asset catalog. Out: coverage report, gap analysis, remediation plan.' },
            { name: 'Resolve Cross-Domain Issues', description: 'Arbitrate conflicts where data spans multiple domains', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: conflict reports, domain boundaries, stakeholder positions. Out: resolution decisions, updated boundaries, stakeholder communication.' },
          ],
        },
        {
          name: 'Metadata & Catalog Management',
          description: 'Maintain the enterprise data catalog, business glossary, and lineage',
          purpose: 'Make data discoverable, understandable, and traceable across the organization',
          activities: [
            { name: 'Maintain Data Catalog', description: 'Register and update data asset definitions, owners, and classifications', responsibleRole: 'Business Data Steward', inputsOutputs: 'In: data asset discoveries, system inventories, owner assignments. Out: updated catalog entries, asset metadata, classification tags.' },
            { name: 'Define Business Glossary Terms', description: 'Create agreed-upon definitions for key business terms', responsibleRole: 'Business Data Steward', inputsOutputs: 'In: business terminology, stakeholder input, existing definitions. Out: glossary entries, approved definitions, synonym mappings.' },
            { name: 'Map Data Lineage', description: 'Document how data flows from source systems through transformations to consumption', responsibleRole: 'Data Architect', inputsOutputs: 'In: system architecture, ETL documentation, data flow diagrams. Out: lineage maps, transformation documentation, impact analysis capability.' },
            { name: 'Review Catalog Completeness', description: 'Audit the catalog for missing assets, stale entries, and undocumented sources', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: data catalog, system inventory, discovery scan results. Out: completeness report, stale entry list, action items for gaps.' },
          ],
        },
        {
          name: 'Data Access & Security',
          description: 'Classify data sensitivity and manage access policies',
          purpose: 'Protect sensitive data while enabling authorized access for business needs',
          activities: [
            { name: 'Classify Data Sensitivity', description: 'Apply classification levels (Public, Internal, Confidential, Restricted) to assets', responsibleRole: 'Data Owner', inputsOutputs: 'In: data asset catalog, regulatory requirements, risk assessment. Out: classification assignments, handling requirements, labeling standards.' },
            { name: 'Define Access Policies', description: 'Establish who can access what data under which conditions', responsibleRole: 'Data Custodian', inputsOutputs: 'In: classification levels, role definitions, regulatory requirements. Out: access control policies, role-based access matrix, approval workflows.' },
            { name: 'Review Access Requests', description: 'Process and approve/deny requests for data access', responsibleRole: 'Data Owner', inputsOutputs: 'In: access requests, requester justification, current access policies. Out: approval/denial decisions, access grants, audit trail entries.' },
            { name: 'Audit Access Compliance', description: 'Verify that actual access patterns match approved policies', responsibleRole: 'Data Custodian', inputsOutputs: 'In: access logs, approved policies, access grants. Out: compliance report, violation alerts, remediation actions.' },
          ],
        },
        {
          name: 'Issue & Change Management',
          description: 'Track, prioritize, and resolve data governance issues',
          purpose: 'Provide a structured process for handling data problems and governance changes',
          activities: [
            { name: 'Log Data Issues', description: 'Capture reported data problems with context, impact, and urgency', responsibleRole: 'Business Data Steward', inputsOutputs: 'In: issue reports, user complaints, quality alerts. Out: issue records, initial triage, acknowledgment to reporter.' },
            { name: 'Prioritize Issues', description: 'Triage issues by business impact, regulatory risk, and effort', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: issue records, impact assessments, resource availability. Out: prioritized issue backlog, severity assignments, SLA targets.' },
            { name: 'Assign and Resolve Issues', description: 'Route issues to responsible parties and track resolution', responsibleRole: 'Business Data Steward', inputsOutputs: 'In: prioritized issues, team assignments, resolution procedures. Out: resolution records, root cause documentation, closure notifications.' },
            { name: 'Implement Changes', description: 'Execute approved changes to data, systems, or processes', responsibleRole: 'Technical Data Steward', inputsOutputs: 'In: approved change requests, implementation plans, test criteria. Out: implemented changes, test results, updated documentation.' },
            { name: 'Communicate Resolutions', description: 'Notify stakeholders of resolved issues and preventive measures', responsibleRole: 'Data Governance Lead', inputsOutputs: 'In: resolution records, stakeholder list, preventive measures. Out: resolution notifications, lessons learned, updated knowledge base.' },
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
      version: 1, domain: 'GOVERNANCE',
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
        version: 1, domain: 'GOVERNANCE', purpose: proc.purpose,
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
          version: 1, domain: 'GOVERNANCE',
          ...((act as any).responsibleRole ? { responsibleRole: (act as any).responsibleRole } : {}),
          ...((act as any).inputsOutputs ? { inputsOutputs: (act as any).inputsOutputs } : {}),
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

  // ── Seed governance documents (Charter, Policies, Standards, ACL) ──
  // The old governance template created 15 "Data Assets" as
  // standard inputs/outputs for the governance processes. In
  // practice almost none of those rows were real data assets —
  // most were governance documents (Charter, Standards, Access
  // Control Policies) that don't have columns / health / tier /
  // source bindings, or were duplicates of entities that already
  // have a dedicated home in Procela (Glossary, Domains, Lineage,
  // DQ Rules, Issues, Tasks).
  //
  // Now we only seed the four document-shaped rows, and we plant
  // them in governancePolicies with the right documentType so they
  // get the lifecycle + review-cadence + ownership treatment they
  // actually need. The other 11 rows are not created — the
  // corresponding entities already exist (or get created via
  // their own templates), and process-activity outputs that aren't
  // stored entities (reports, communications) are dropped.
  //
  // The startup migration in src/migrations/2026-05-governance-docs.ts
  // also cleans up the old assets for orgs that ran the previous
  // template.
  try {
    const { governancePolicies } = require('./governance-policies');

    const docDefs: Array<{ name: string; description: string; documentType: 'CHARTER' | 'FRAMEWORK' | 'STANDARD' | 'POLICY'; category: string }> = [
      { name: 'Data Governance Charter', description: 'Mission, vision, principles, decision rights, and scope of the governance program', documentType: 'CHARTER', category: 'GOVERNANCE' },
      { name: 'Data Policies',           description: 'Enterprise policies for data quality, security, privacy, retention, and sharing',     documentType: 'POLICY',   category: 'GENERAL' },
      { name: 'Data Standards',          description: 'Naming conventions, data type standards, formatting rules, and reference data',       documentType: 'STANDARD', category: 'GOVERNANCE' },
      { name: 'Access Control Policies', description: 'Role-based access matrix, approval workflows, and access request procedures',         documentType: 'POLICY',   category: 'ACCESS' },
    ];
    const orgPolicies = governancePolicies.filter((p: any) => p.orgId === templateOrgId);
    const existingByName = new Map<string, any>(orgPolicies.map((p: any) => [p.name.toLowerCase(), p]));
    const codePrefix: Record<string, string> = { CHARTER: 'CHA', FRAMEWORK: 'FRW', STANDARD: 'STD', POLICY: 'POL' };
    let createdDocs = 0;
    for (const def of docDefs) {
      if (existingByName.has(def.name.toLowerCase())) continue;
      const seq = governancePolicies.filter((p: any) => p.documentType === def.documentType).length + 1;
      governancePolicies.push({
        id: uuid(),
        orgId: templateOrgId,
        code: `${codePrefix[def.documentType]}-${String(seq).padStart(3, '0')}`,
        name: def.name,
        description: def.description,
        documentType: def.documentType,
        status: 'DRAFT',
        ownerAssignmentId: null,
        category: def.category,
        reviewFrequency: 'ANNUAL',
        lastReviewDate: null,
        nextReviewDate: null,
        effectiveDate: null,
        content: '',
        createdAt: now,
        updatedAt: now,
      });
      createdDocs++;
    }
    if (createdDocs > 0) saveStore('governancePolicies', governancePolicies);
    logger.info({ docs: createdDocs }, 'Seeded governance documents (Charter / Policies / Standards / ACL) under templateOrgId');
  } catch (err) {
    logger.error({ err }, 'Failed to seed governance documents (non-fatal)');
  }
  logger.info({ created: created.length, orgId: templateOrgId }, 'Applied governance process template');
  const companyName = organizations.find((o) => o.id === templateOrgId)?.name || '';
  res.status(201).json({ success: true, data: created, message: `Created ${created.length} governance process nodes at ${companyName} (company level)` });
});

export default router;
