import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { agents } from './agents';
import { processNodes, isGovernanceNode } from './process-catalog';
import { auditService } from '../services/audit.service';
import { runAgentExecution } from './agent-executions';
import { getAgentSchedulesRepository } from '../db/agent-schedules.repo';

// ──────────────────────────────────────────────────────────────────────────
// Agent Schedules — one-shot or recurring schedules that fire agent runs
// against a specific governance activity. A 60-second ticker checks every
// ACTIVE schedule and runs any whose nextRunAt has passed. The actual run
// reuses the same runAgentExecution() helper as the user-triggered POST
// /agent-executions, so audit + notification behaviour is identical.
// ──────────────────────────────────────────────────────────────────────────

const FREQUENCIES = ['ONCE', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
type Frequency = typeof FREQUENCIES[number];

const STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED'] as const;
type ScheduleStatus = typeof STATUSES[number];

export interface StoredAgentSchedule {
  id: string;
  orgId: string;
  agentId: string;
  agentName: string;
  activityId: string;
  activityName: string;
  roleType: string;
  frequency: Frequency;
  status: ScheduleStatus;
  /** First moment the schedule is eligible to run. For ONCE schedules,
   *  the only run; for recurring, the anchor that determines tick alignment. */
  startAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  /** Count of times this schedule has actually fired a run, including failed runs. */
  runCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const agentSchedules: StoredAgentSchedule[] = loadStore<StoredAgentSchedule>('agentSchedules');
registerStore('agentSchedules', agentSchedules);

const agentSchedulesRepo = getAgentSchedulesRepository(agentSchedules);

/** Advance nextRunAt by one frequency unit. For ONCE, returns the same time
 *  (caller marks the schedule COMPLETED instead). */
function advanceNextRunAt(frequency: Frequency, from: Date): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'HOURLY':  d.setHours(d.getHours() + 1); break;
    case 'DAILY':   d.setDate(d.getDate() + 1); break;
    case 'WEEKLY':  d.setDate(d.getDate() + 7); break;
    case 'MONTHLY': d.setMonth(d.getMonth() + 1); break;
    case 'ONCE':    /* no advance */ break;
  }
  return d;
}

const router = Router();

/** GET /api/v1/agent-schedules — list, optionally filtered. */
router.get('/', async (req: Request, res: Response) => {
  const { orgId, activityId, agentId } = req.query;
  let filtered = [...agentSchedules];
  if (orgId) filtered = filtered.filter((s) => s.orgId === orgId);
  if (activityId) filtered = filtered.filter((s) => s.activityId === activityId);
  if (agentId) filtered = filtered.filter((s) => s.agentId === agentId);
  filtered.sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  res.json({ success: true, data: filtered, frequencies: FREQUENCIES, statuses: STATUSES });
});

/** POST /api/v1/agent-schedules — create a schedule. */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, agentId, activityId, roleType, frequency, startAt } = req.body;
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!agentId) { res.status(400).json({ success: false, error: 'agentId is required' }); return; }
  if (!activityId) { res.status(400).json({ success: false, error: 'activityId is required' }); return; }
  if (!FREQUENCIES.includes(frequency)) {
    res.status(400).json({ success: false, error: `frequency must be one of ${FREQUENCIES.join(', ')}` });
    return;
  }

  const agent = agents.find((a) => a.id === agentId);
  if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
  const node = processNodes.find((n) => n.id === activityId);
  if (!node) { res.status(404).json({ success: false, error: 'Activity not found' }); return; }
  if (node.level !== 'ACTIVITY') { res.status(400).json({ success: false, error: 'Agents can only perform Activity-level work.' }); return; }
  if (!isGovernanceNode(node)) { res.status(400).json({ success: false, error: 'Agents can only perform activities in the Data Governance Management value stream.' }); return; }

  const now = new Date();
  // Parse startAt — accept either an ISO string or default to "now"
  // (which fires immediately on the next tick).
  const start = startAt ? new Date(startAt) : now;
  if (Number.isNaN(start.getTime())) { res.status(400).json({ success: false, error: 'startAt must be a valid ISO timestamp' }); return; }

  const schedule: StoredAgentSchedule = {
    id: uuid(),
    orgId,
    agentId,
    agentName: agent.name,
    activityId: node.id,
    activityName: node.name,
    roleType: roleType || '',
    frequency,
    status: 'ACTIVE',
    startAt: start.toISOString(),
    nextRunAt: start.toISOString(),
    lastRunAt: null,
    runCount: 0,
    createdBy: (req as Request & { user?: { id?: string } }).user?.id || null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await agentSchedulesRepo.create(schedule);
  auditService.log(orgId, schedule.createdBy, 'AgentSchedule', schedule.id, 'AGENT_SCHEDULE_CREATED', null, {
    agentId, activityId: node.id, frequency, startAt: schedule.startAt,
  });
  logger.info({ scheduleId: schedule.id, agentId, activityId: node.id, frequency, startAt: schedule.startAt }, 'Agent schedule created');
  res.status(201).json({ success: true, data: schedule });
});

/** PATCH /api/v1/agent-schedules/:id — update status (pause / resume), frequency, or startAt. */
router.patch('/:id', async (req: Request, res: Response) => {
  const sched = agentSchedules.find((s) => s.id === req.params.id);
  if (!sched) { res.status(404).json({ success: false, error: 'Schedule not found' }); return; }
  const before = { status: sched.status, frequency: sched.frequency, nextRunAt: sched.nextRunAt };
  const { status, frequency, startAt } = req.body;
  if (status !== undefined) {
    if (!STATUSES.includes(status)) { res.status(400).json({ success: false, error: `status must be one of ${STATUSES.join(', ')}` }); return; }
    sched.status = status;
  }
  if (frequency !== undefined) {
    if (!FREQUENCIES.includes(frequency)) { res.status(400).json({ success: false, error: `frequency must be one of ${FREQUENCIES.join(', ')}` }); return; }
    sched.frequency = frequency;
  }
  if (startAt !== undefined) {
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) { res.status(400).json({ success: false, error: 'startAt must be a valid ISO timestamp' }); return; }
    sched.startAt = start.toISOString();
    sched.nextRunAt = start.toISOString();
  }
  sched.updatedAt = new Date().toISOString();
  await agentSchedulesRepo.update(sched.id, sched);
  const userId = (req as Request & { user?: { id?: string } }).user?.id || null;
  auditService.log(sched.orgId, userId, 'AgentSchedule', sched.id, 'AGENT_SCHEDULE_UPDATED', before, {
    status: sched.status, frequency: sched.frequency, nextRunAt: sched.nextRunAt,
  });
  res.json({ success: true, data: sched });
});

/** DELETE /api/v1/agent-schedules/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = agentSchedules.find((s) => s.id === req.params.id);
  if (!removed) { res.status(404).json({ success: false, error: 'Schedule not found' }); return; }
  await agentSchedulesRepo.delete(removed.id);
  const userId = (req as Request & { user?: { id?: string } }).user?.id || null;
  auditService.log(removed.orgId, userId, 'AgentSchedule', removed.id, 'AGENT_SCHEDULE_DELETED', removed, null);
  res.json({ success: true });
});

// ── Ticker ───────────────────────────────────────────────────────────────
// Mirrors the data-quality scheduler. Fires once a minute and runs every
// ACTIVE schedule whose nextRunAt is in the past. Each run goes through
// the same runAgentExecution() helper as ad-hoc runs, so audit and
// notifications happen identically. ONCE schedules flip to COMPLETED after
// their single run; recurring schedules roll nextRunAt forward by one
// frequency unit. We don't try to catch up missed ticks here — if the
// process was down for an hour, an HOURLY schedule fires once, not many
// times, which matches what a user would expect from a "fire next on…"
// scheduler.

const SCHEDULER_TICK_MS = 60 * 1000;

async function runScheduleNow(sched: StoredAgentSchedule): Promise<void> {
  try {
    await runAgentExecution({
      orgId: sched.orgId,
      agentId: sched.agentId,
      activityId: sched.activityId,
      roleType: sched.roleType,
      triggeredBy: 'schedule',
      scheduleId: sched.id,
      userId: sched.createdBy,
    });
  } catch (err) {
    // runAgentExecution audits its own failure; we just log here so a
    // bad single schedule doesn't poison the tick loop.
    logger.error({ err, scheduleId: sched.id }, 'Scheduled agent run threw');
  }

  sched.lastRunAt = new Date().toISOString();
  sched.runCount += 1;
  if (sched.frequency === 'ONCE') {
    sched.status = 'COMPLETED';
  } else {
    sched.nextRunAt = advanceNextRunAt(sched.frequency, new Date()).toISOString();
  }
  sched.updatedAt = new Date().toISOString();
  // Persist through the repository so the advance (lastRunAt / runCount /
  // nextRunAt / status) reaches Postgres in DB mode — saveStore only writes
  // the JSON store, so a bare saveStore lost these updates under Postgres and
  // a schedule could re-fire after a restart.
  await agentSchedulesRepo.update(sched.id, sched);
  auditService.log(sched.orgId, sched.createdBy, 'AgentSchedule', sched.id, 'AGENT_SCHEDULE_FIRED', null, {
    runCount: sched.runCount, status: sched.status, nextRunAt: sched.nextRunAt,
  });
}

function tickAgentSchedules(): void {
  const now = new Date();
  for (const sched of agentSchedules) {
    if (sched.status !== 'ACTIVE') continue;
    if (new Date(sched.nextRunAt) > now) continue;
    runScheduleNow(sched).catch((err) => {
      logger.error({ err, scheduleId: sched.id }, 'Scheduled agent run failed');
    });
  }
}

import { startBackgroundSweep } from '../lib/background-timer';
startBackgroundSweep(tickAgentSchedules, SCHEDULER_TICK_MS);

// Exported for tests that want to deterministically trigger the loop.
export { tickAgentSchedules };

export default router;
