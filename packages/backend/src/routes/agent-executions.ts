import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// Agent Executions — tracks when an AI agent runs in the context of a
// governance role / process activity.  Phase 3 of the AI agent automation
// feature.  For the prototype the POST endpoint immediately resolves the
// execution to SUCCESS with mock output.
// ──────────────────────────────────────────────────────────────────────────

const EXECUTION_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
type ExecutionStatus = typeof EXECUTION_STATUSES[number];

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
  output: string;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export const agentExecutions: StoredAgentExecution[] = loadStore<StoredAgentExecution>('agentExecutions');

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

/** POST /api/v1/agent-executions — create/trigger an execution.
 *  For the prototype this immediately resolves to SUCCESS with mock output. */
router.post('/', (req: Request, res: Response) => {
  const { orgId, agentId, agentName, activityId, activityName, roleType } = req.body;

  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!agentId) { res.status(400).json({ success: false, error: 'agentId is required' }); return; }
  if (!activityId) { res.status(400).json({ success: false, error: 'activityId is required' }); return; }

  const now = new Date();
  // Simulate a short execution (200-2000ms)
  const durationMs = Math.floor(Math.random() * 1800) + 200;
  const completedAt = new Date(now.getTime() + durationMs);

  const execution: StoredAgentExecution = {
    id: uuid(),
    orgId,
    agentId,
    agentName: agentName || 'Unknown Agent',
    activityId,
    activityName: activityName || 'Unknown Activity',
    roleType: roleType || '',
    status: 'SUCCESS',
    startedAt: now.toISOString(),
    completedAt: completedAt.toISOString(),
    output: `Agent "${agentName || 'agent'}" successfully executed activity "${activityName || activityId}" in role "${roleType || 'N/A'}". All checks passed.`,
    error: null,
    durationMs,
    createdAt: now.toISOString(),
  };

  agentExecutions.push(execution);
  saveStore('agentExecutions', agentExecutions);

  logger.info(
    { executionId: execution.id, agentId, activityId, roleType, durationMs },
    'Agent execution completed (simulated)',
  );

  res.status(201).json({ success: true, data: execution });
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
