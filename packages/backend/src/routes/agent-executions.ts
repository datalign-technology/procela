import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';
import { aiService, GovernanceActivityRun } from '../services/ai.service';
import { agents } from './agents';
import { processNodes, isGovernanceNode } from './process-catalog';
import { mappings } from './mappings';
import { dataAssets } from './data-assets';
import { governancePolicies, generateCode as generateDocCode, StoredGovernancePolicy, VALID_DOCUMENT_TYPES } from './governance-policies';
import { attachments } from './attachments';
import { systems } from './systems';
import { skills } from './skills';
import { organizations } from './organizations';

// ──────────────────────────────────────────────────────────────────────────
// Agent Executions — an AI agent actually PERFORMING a governance activity.
// The POST endpoint assembles the activity's business context, runs it
// through the agent's operating instructions via a real Claude call, and
// stores the produced draft for human review. Scoped to ACTIVITY nodes inside
// the GOVERNANCE domain (the Data Governance Management value stream).
// ──────────────────────────────────────────────────────────────────────────

const EXECUTION_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
type ExecutionStatus = typeof EXECUTION_STATUSES[number];

const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type ReviewStatus = typeof REVIEW_STATUSES[number];

export interface StoredAgentExecution {
  id: string;
  orgId: string;
  agentId: string;
  agentName: string;
  activityId: string;        // process node id
  activityName: string;
  roleType: string;          // which DAMA role the agent acted as
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  output: string;            // the agent's draft deliverable (Markdown)
  error: string | null;
  durationMs: number | null;
  // Human review of the AI-produced draft. AI output is never authoritative
  // until a person approves it (per the platform's AI behaviour guidelines).
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  // Back-link to the Governance Document this draft was promoted to, set
  // by /promote. Null/undefined means the approved draft hasn't yet been
  // turned into an authoritative output — the activity's Inputs / Outputs
  // panel surfaces it as an unpromoted draft chip in that case.
  promotedDocumentId?: string | null;
  createdAt: string;
}

// Resolve one mapping row to a human-readable line for the prompt.
function describeMapping(m: { dataAssetId?: string; policyId?: string; attachmentId?: string; criticality?: string }): string {
  let label = 'Linked item (no longer exists)';
  if (m.dataAssetId) {
    const a = dataAssets.find((x) => x.id === m.dataAssetId);
    label = a ? `Data asset "${a.name}" (${a.governanceTier} tier)` : 'Data asset (deleted)';
  } else if (m.policyId) {
    const p = governancePolicies.find((x) => x.id === m.policyId);
    label = p ? `Governance document "${p.code} ${p.name}" (${p.documentType})` : 'Governance document (deleted)';
  } else if (m.attachmentId) {
    const at = attachments.find((x) => x.id === m.attachmentId);
    label = at ? `Reference "${at.name}"${at.url ? ` (${at.url})` : ''}` : 'Attachment (deleted)';
  }
  return m.criticality ? `${label} [${m.criticality}]` : label;
}

export const agentExecutions: StoredAgentExecution[] = loadStore<StoredAgentExecution>('agentExecutions');

// One-time normalisation: existing records pre-date the promotedDocumentId
// field. Treat undefined as null so the rest of the code can rely on the
// field being present.
{
  let backfilled = 0;
  for (const e of agentExecutions) {
    if (!('promotedDocumentId' in e)) { (e as StoredAgentExecution).promotedDocumentId = null; backfilled++; }
  }
  if (backfilled > 0) {
    saveStore('agentExecutions', agentExecutions);
    logger.info({ backfilled }, 'Backfilled promotedDocumentId on existing agent executions');
  }
}

const router = Router();

/** GET /api/v1/agent-executions — list executions with optional filters */
router.get('/', (req: Request, res: Response) => {
  const { orgId, agentId, activityId } = req.query;
  let filtered = [...agentExecutions];

  if (orgId) {
    filtered = filtered.filter((e) => e.orgId === orgId);
  }
  if (agentId) {
    filtered = filtered.filter((e) => e.agentId === agentId);
  }
  if (activityId) {
    filtered = filtered.filter((e) => e.activityId === activityId);
  }

  // Most recent first
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ success: true, data: filtered });
});

/** GET /api/v1/agent-executions/:id — get single execution */
router.get('/:id', (req: Request, res: Response) => {
  const exec = agentExecutions.find((e) => e.id === req.params.id);
  if (!exec) { res.status(404).json({ success: false, error: 'Execution not found' }); return; }
  res.json({ success: true, data: exec });
});

/** POST /api/v1/agent-executions — have an agent perform a governance activity.
 *  Assembles the activity's context, runs it through the agent's instructions
 *  via Claude, and stores the resulting draft (status SUCCESS) or the failure
 *  (status FAILED). Restricted to ACTIVITY nodes in the GOVERNANCE domain. */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, agentId, roleType } = req.body;

  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!agentId) { res.status(400).json({ success: false, error: 'agentId is required' }); return; }
  if (!req.body.activityId) { res.status(400).json({ success: false, error: 'activityId is required' }); return; }

  const agent = agents.find((a) => a.id === agentId);
  if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }

  const node = processNodes.find((n) => n.id === req.body.activityId);
  if (!node) { res.status(404).json({ success: false, error: 'Activity not found' }); return; }

  // Scope guard: agents may only act on governance Activities. This is the
  // boundary enforcement of the "Data Governance Management value stream only"
  // rule, independent of whatever the UI shows.
  if (node.level !== 'ACTIVITY') {
    res.status(400).json({ success: false, error: 'Agents can only perform Activity-level work.' });
    return;
  }
  if (!isGovernanceNode(node)) {
    res.status(400).json({ success: false, error: 'Agents can only perform activities in the Data Governance Management value stream.' });
    return;
  }

  // Assemble the activity's business context from its linked items.
  const nodeMappings = mappings.filter((m) => m.processStepId === node.id);
  const inputs = nodeMappings.filter((m) => m.linkType !== 'produces').map(describeMapping);
  const outputs = nodeMappings.filter((m) => m.linkType === 'produces').map(describeMapping);
  const systemNames = (node.systemIds || [])
    .map((id) => systems.find((s) => s.id === id)?.name)
    .filter((n): n is string => !!n);
  const requiredSkills = (node.requiredSkillIds || [])
    .map((id) => skills.find((s) => s.id === id)?.name)
    .filter((n): n is string => !!n);
  const orgName = organizations.find((o) => o.id === orgId)?.name;

  const run: GovernanceActivityRun = {
    agent: { name: agent.name, instructions: agent.instructions || '', description: agent.description, agentType: agent.agentType },
    activity: { name: node.name, description: node.description, inputsOutputs: node.inputsOutputs, responsibleRole: node.responsibleRole },
    inputs, outputs, systems: systemNames, requiredSkills, orgName,
  };

  const startedAt = new Date();
  const execution: StoredAgentExecution = {
    id: uuid(),
    orgId,
    agentId,
    agentName: agent.name,
    activityId: node.id,
    activityName: node.name,
    roleType: roleType || '',
    status: 'RUNNING',
    startedAt: startedAt.toISOString(),
    completedAt: null,
    output: '',
    error: null,
    durationMs: null,
    reviewStatus: 'PENDING',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: startedAt.toISOString(),
  };

  try {
    const output = await aiService.performGovernanceActivity(run);
    const completedAt = new Date();
    execution.status = 'SUCCESS';
    execution.output = output;
    execution.completedAt = completedAt.toISOString();
    execution.durationMs = completedAt.getTime() - startedAt.getTime();
    logger.info({ executionId: execution.id, agentId, activityId: node.id }, 'Agent performed governance activity');
  } catch (err) {
    const completedAt = new Date();
    execution.status = 'FAILED';
    execution.error = err instanceof Error ? err.message : 'Agent run failed';
    execution.completedAt = completedAt.toISOString();
    execution.durationMs = completedAt.getTime() - startedAt.getTime();
    logger.error({ executionId: execution.id, agentId, activityId: node.id, err }, 'Agent execution failed');
  }

  agentExecutions.push(execution);
  saveStore('agentExecutions', agentExecutions);

  res.status(201).json({ success: true, data: execution });
});

/** PATCH /api/v1/agent-executions/:id/review — approve or reject a draft. */
router.patch('/:id/review', (req: Request, res: Response) => {
  const exec = agentExecutions.find((e) => e.id === req.params.id);
  if (!exec) { res.status(404).json({ success: false, error: 'Execution not found' }); return; }
  const { reviewStatus, reviewedBy } = req.body;
  if (!REVIEW_STATUSES.includes(reviewStatus)) {
    res.status(400).json({ success: false, error: `reviewStatus must be one of ${REVIEW_STATUSES.join(', ')}` });
    return;
  }
  exec.reviewStatus = reviewStatus;
  exec.reviewedBy = reviewStatus === 'PENDING' ? null : (typeof reviewedBy === 'string' && reviewedBy ? reviewedBy : 'Unknown');
  exec.reviewedAt = reviewStatus === 'PENDING' ? null : new Date().toISOString();
  saveStore('agentExecutions', agentExecutions);
  res.json({ success: true, data: exec });
});

/** POST /api/v1/agent-executions/:id/promote — turn the approved draft into
 * a real Governance Document and attach it as an OUTPUT mapping of the
 * activity in one atomic step. Stamps the execution as APPROVED and
 * records the back-link via promotedDocumentId so the UI can show the
 * chip as "promoted" instead of "needs promotion".
 *
 * Body: { name, documentType?, category?, description?, reviewedBy? }
 *   - name (required) — the document's display name; defaults to the
 *     activity name on the frontend if the user doesn't edit it.
 *   - documentType — POLICY by default; CHARTER / FRAMEWORK / STANDARD also valid.
 *   - category — defaults to GOVERNANCE.
 *   - reviewedBy — stamped on the execution if provided.
 */
router.post('/:id/promote', (req: Request, res: Response) => {
  const exec = agentExecutions.find((e) => e.id === req.params.id);
  if (!exec) { res.status(404).json({ success: false, error: 'Execution not found' }); return; }
  if (exec.status !== 'SUCCESS') {
    res.status(400).json({ success: false, error: `Cannot promote a draft from a ${exec.status} execution — only SUCCESS drafts can be promoted.` });
    return;
  }
  if (exec.reviewStatus === 'REJECTED') {
    res.status(400).json({ success: false, error: 'This draft was rejected — reset the review before promoting.' });
    return;
  }
  if (exec.promotedDocumentId) {
    res.status(400).json({ success: false, error: 'This draft has already been promoted to a Governance Document.' });
    return;
  }

  const { name, documentType, category, description, reviewedBy } = req.body || {};
  const docName = (typeof name === 'string' && name.trim()) ? name.trim() : exec.activityName;
  if (!docName) { res.status(400).json({ success: false, error: 'Name is required.' }); return; }
  const finalDocumentType: StoredGovernancePolicy['documentType'] = VALID_DOCUMENT_TYPES.includes(documentType) ? documentType : 'POLICY';

  // Capture the source activity's status at promotion time so any later
  // reviewer of the document can see whether the underlying activity was
  // still in design when the draft was produced.
  const activityNode = processNodes.find((n) => n.id === exec.activityId);
  const activityStatusAtPromote = activityNode?.status || 'unknown';
  const provenanceLine = `Promoted from agent draft for "${exec.activityName}" by ${exec.agentName}. Source activity status at promotion: ${activityStatusAtPromote}.`;

  const now = new Date().toISOString();

  // 1) Create the Governance Document with the execution's Markdown as content.
  const doc: StoredGovernancePolicy = {
    id: uuid(),
    orgId: exec.orgId,
    code: generateDocCode(finalDocumentType),
    name: docName,
    description: (typeof description === 'string' && description.trim()) ? `${description.trim()}\n\n${provenanceLine}` : provenanceLine,
    documentType: finalDocumentType,
    status: 'DRAFT',
    ownerAssignmentId: null,
    category: (typeof category === 'string' && category ? category : 'GOVERNANCE') as StoredGovernancePolicy['category'],
    reviewFrequency: 'ANNUAL',
    lastReviewDate: null,
    nextReviewDate: null,
    effectiveDate: null,
    content: exec.output || '',
    createdAt: now,
    updatedAt: now,
  };
  governancePolicies.push(doc);
  saveStore('governancePolicies', governancePolicies);

  // 2) Link it to the activity as an OUTPUT mapping (linkType 'produces').
  const mapping = {
    id: uuid(),
    orgId: exec.orgId,
    processStepId: exec.activityId,
    policyId: doc.id,
    linkType: 'produces' as const,
    notes: `Promoted from agent draft (execution ${exec.id}) by ${exec.agentName}.`,
    aiSuggested: true,
    userOverridden: false,
    createdBy: (typeof reviewedBy === 'string' && reviewedBy) || exec.reviewedBy || 'system',
    createdAt: now,
    updatedAt: now,
  };
  mappings.push(mapping as unknown as typeof mappings[number]);
  saveStore('mappings', mappings);

  // 3) Stamp the execution as APPROVED + record the back-link.
  exec.reviewStatus = 'APPROVED';
  exec.reviewedBy = (typeof reviewedBy === 'string' && reviewedBy) || exec.reviewedBy || 'Unknown';
  exec.reviewedAt = now;
  exec.promotedDocumentId = doc.id;
  saveStore('agentExecutions', agentExecutions);

  logger.info({ executionId: exec.id, documentId: doc.id, documentCode: doc.code, activityId: exec.activityId }, 'Promoted agent draft to governance document');
  res.status(201).json({ success: true, data: { execution: exec, document: doc, mapping } });
});

/** DELETE /api/v1/agent-executions/all — delete all executions */
router.delete('/all', (_req: Request, res: Response) => {
  const count = agentExecutions.length;
  agentExecutions.splice(0, agentExecutions.length);
  saveStore('agentExecutions', agentExecutions);
  logger.info({ count }, 'Deleted all agent executions');
  res.json({ success: true, deleted: count });
});

export default router;
