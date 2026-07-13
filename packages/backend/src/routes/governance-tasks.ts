import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { people } from './people';
import { createNotification } from './notifications';
import logger from '../lib/logger';

const TASK_TYPES = [
  'STEWARDSHIP',
  'REVIEW',
  'APPROVAL',
  'REMEDIATION',
  'CLASSIFICATION',
  'METADATA',
  'GENERAL',
] as const;

const TASK_STATUSES = [
  'DRAFT',
  'OPEN',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'PENDING_APPROVAL',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const AUTOMATION_MODES = ['HUMAN', 'AGENT', 'HYBRID'] as const;

// Valid status transitions — keys are current status, values are allowed next statuses
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['OPEN'],
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_REVIEW', 'PENDING_APPROVAL', 'COMPLETED', 'CANCELLED'],
  PENDING_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'REJECTED'],
  PENDING_APPROVAL: ['COMPLETED', 'REJECTED', 'IN_PROGRESS'],
  COMPLETED: [],
  REJECTED: ['OPEN', 'CANCELLED'],
  CANCELLED: [],
};

export interface StoredGovernanceTask {
  id: string;
  orgId: string;
  title: string;
  description: string;
  taskType: typeof TASK_TYPES[number];
  status: typeof TASK_STATUSES[number];
  priority: typeof TASK_PRIORITIES[number];
  assigneeId: string | null;
  dueDate: string | null;
  linkedObjectType: string | null;
  linkedObjectId: string | null;
  automationMode: typeof AUTOMATION_MODES[number];
  resolution: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** ISO timestamp of the most recent overdue notification the sweep
   *  fired for this task. Used to dedupe: sweep only fires a new
   *  notification when overdueNotifiedAt is missing OR older than the
   *  task's dueDate (i.e. the due date was pushed forward and the row
   *  became overdue again). Cleared on completion / cancel so a
   *  reopened task can re-fire. */
  overdueNotifiedAt?: string | null;
}

export const governanceTasks: StoredGovernanceTask[] = loadStore<StoredGovernanceTask>('governanceTasks');
registerStore('governanceTasks', governanceTasks);

function enrichTask(task: StoredGovernanceTask): any {
  const assignee = task.assigneeId ? people.find((p) => p.id === task.assigneeId) : null;
  return {
    ...task,
    assigneeName: assignee?.name || null,
  };
}

/**
 * Overdue-task sweep. Scans OPEN + IN_PROGRESS + PENDING_APPROVAL
 * tasks in scope, notifies the assignee (or org-wide when the task
 * is unassigned) for each task whose dueDate has slipped and hasn't
 * already been notified for this cycle.
 *
 * Idempotency: overdueNotifiedAt is stamped on the task after a fire.
 * A second sweep skips the row unless overdueNotifiedAt < dueDate —
 * which happens when the reviewer pushed the due date forward and
 * missed the new one too. Completing or cancelling the task should
 * clear overdueNotifiedAt so a reopened task can re-fire (handled in
 * the status branches below).
 *
 * Optional orgId param scopes the sweep; omit to sweep every org.
 * Returns the ids of the tasks that fired so a caller (or the
 * scheduler) can log the result.
 */
const ACTIVE_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL']);

export function sweepOverdueTasks(scopeOrgId?: string): { fired: string[] } {
  const now = Date.now();
  const fired: string[] = [];
  for (const task of governanceTasks) {
    if (scopeOrgId && task.orgId !== scopeOrgId) continue;
    if (!ACTIVE_STATUSES.has(task.status)) continue;
    if (!task.dueDate) continue;
    const due = new Date(task.dueDate).getTime();
    if (Number.isNaN(due) || due >= now) continue;
    // Idempotent: skip if we already notified since the current
    // due date was set. A pushed-forward dueDate re-arms the fire.
    if (task.overdueNotifiedAt) {
      const notifiedAt = new Date(task.overdueNotifiedAt).getTime();
      if (!Number.isNaN(notifiedAt) && notifiedAt >= due) continue;
    }
    const daysOverdue = Math.floor((now - due) / (24 * 60 * 60 * 1000));
    const suffix = daysOverdue === 0 ? 'today' : daysOverdue === 1 ? '1 day ago' : `${daysOverdue} days ago`;
    createNotification({
      orgId: task.orgId,
      userId: task.assigneeId || null,
      type: 'WARNING',
      title: `Task overdue: ${task.title}`,
      message: `Due ${suffix}. Update the status or push the due date if it's still in flight.`,
      link: `/governance-work?tab=tasks&id=${task.id}`,
    });
    task.overdueNotifiedAt = new Date().toISOString();
    task.updatedAt = task.overdueNotifiedAt;
    fired.push(task.id);
  }
  if (fired.length > 0) {
    saveStore('governanceTasks', governanceTasks);
    logger.info({ scopeOrgId, count: fired.length }, 'Overdue task sweep fired');
  }
  return { fired };
}

const router = Router();

/** POST /api/v1/governance-tasks/sweep-overdue?orgId=... — trigger the
 *  overdue sweep manually. The scheduler in index.ts calls the same
 *  function on a timer; this route exists so an admin (or a test) can
 *  drive the flow synchronously. */
router.post('/sweep-overdue', (req: Request, res: Response) => {
  const orgId = ((req.query.orgId as string) || '').trim() || undefined;
  const result = sweepOverdueTasks(orgId);
  res.json({ success: true, data: result });
});

/** GET /api/v1/governance-tasks/summary */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(governanceTasks, orgId as string | undefined);

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  for (const s of TASK_STATUSES) byStatus[s] = 0;
  for (const p of TASK_PRIORITIES) byPriority[p] = 0;

  for (const task of filtered) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
  }

  res.json({
    success: true,
    data: { total: filtered.length, byStatus, byPriority },
  });
});

/** GET /api/v1/governance-tasks */
router.get('/', (req: Request, res: Response) => {
  const { orgId, status, assigneeId, taskType, priority } = req.query;
  let filtered = filterByOrgScope(governanceTasks, orgId as string | undefined);

  if (status) filtered = filtered.filter((t) => t.status === status);
  if (assigneeId) filtered = filtered.filter((t) => t.assigneeId === assigneeId);
  if (taskType) filtered = filtered.filter((t) => t.taskType === taskType);
  if (priority) filtered = filtered.filter((t) => t.priority === priority);

  res.json({ success: true, data: filtered.map(enrichTask) });
});

/** GET /api/v1/governance-tasks/:id */
router.get('/:id', (req: Request, res: Response) => {
  const task = governanceTasks.find((t) => t.id === req.params.id);
  if (!task) { res.status(404).json({ success: false, error: 'Governance task not found' }); return; }
  res.json({ success: true, data: enrichTask(task) });
});

/** POST /api/v1/governance-tasks */
router.post('/', (req: Request, res: Response) => {
  const {
    title, orgId, description, taskType, status, priority,
    assigneeId, dueDate, linkedObjectType, linkedObjectId,
    automationMode, resolution, createdBy,
  } = req.body;

  if (!title) { res.status(400).json({ success: false, error: 'Title is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }

  if (taskType && !TASK_TYPES.includes(taskType as any)) {
    res.status(400).json({ success: false, error: `Invalid taskType. Must be one of: ${TASK_TYPES.join(', ')}` });
    return;
  }
  if (status && !TASK_STATUSES.includes(status as any)) {
    res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${TASK_STATUSES.join(', ')}` });
    return;
  }
  if (priority && !TASK_PRIORITIES.includes(priority as any)) {
    res.status(400).json({ success: false, error: `Invalid priority. Must be one of: ${TASK_PRIORITIES.join(', ')}` });
    return;
  }
  if (automationMode && !AUTOMATION_MODES.includes(automationMode as any)) {
    res.status(400).json({ success: false, error: `Invalid automationMode. Must be one of: ${AUTOMATION_MODES.join(', ')}` });
    return;
  }

  const now = new Date().toISOString();
  const resolvedStatus = status || 'OPEN';
  const task: StoredGovernanceTask = {
    id: uuid(),
    orgId,
    title,
    description: description || '',
    taskType: taskType || 'GENERAL',
    status: resolvedStatus,
    priority: priority || 'MEDIUM',
    assigneeId: assigneeId || null,
    dueDate: dueDate || null,
    linkedObjectType: linkedObjectType || null,
    linkedObjectId: linkedObjectId || null,
    automationMode: automationMode || 'HUMAN',
    resolution: resolution || null,
    createdBy: createdBy || null,
    createdAt: now,
    updatedAt: now,
    completedAt: resolvedStatus === 'COMPLETED' ? now : null,
  };

  governanceTasks.push(task);
  saveStore('governanceTasks', governanceTasks);
  auditService.log(task.orgId, null, 'GovernanceTask', task.id, 'CREATE', null, task);
  logger.info({ taskId: task.id, title: task.title, taskType: task.taskType }, 'Created governance task');
  res.status(201).json({ success: true, data: enrichTask(task) });
});

/** PUT /api/v1/governance-tasks/:id */
router.put('/:id', (req: Request, res: Response) => {
  const task = governanceTasks.find((t) => t.id === req.params.id);
  if (!task) { res.status(404).json({ success: false, error: 'Governance task not found' }); return; }

  const before = { ...task };
  const {
    title, description, taskType, status, priority,
    assigneeId, dueDate, linkedObjectType, linkedObjectId,
    automationMode, resolution,
  } = req.body;

  // Validate status transition
  if (status !== undefined && status !== task.status) {
    const allowed = VALID_TRANSITIONS[task.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        success: false,
        error: `Invalid status transition from ${task.status} to ${status}. Allowed transitions: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`,
      });
      return;
    }
  }

  if (taskType !== undefined) {
    if (!TASK_TYPES.includes(taskType as any)) {
      res.status(400).json({ success: false, error: `Invalid taskType. Must be one of: ${TASK_TYPES.join(', ')}` });
      return;
    }
    task.taskType = taskType;
  }
  if (priority !== undefined) {
    if (!TASK_PRIORITIES.includes(priority as any)) {
      res.status(400).json({ success: false, error: `Invalid priority. Must be one of: ${TASK_PRIORITIES.join(', ')}` });
      return;
    }
    task.priority = priority;
  }
  if (automationMode !== undefined) {
    if (!AUTOMATION_MODES.includes(automationMode as any)) {
      res.status(400).json({ success: false, error: `Invalid automationMode. Must be one of: ${AUTOMATION_MODES.join(', ')}` });
      return;
    }
    task.automationMode = automationMode;
  }

  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (assigneeId !== undefined) task.assigneeId = assigneeId;
  if (dueDate !== undefined) task.dueDate = dueDate;
  if (linkedObjectType !== undefined) task.linkedObjectType = linkedObjectType;
  if (linkedObjectId !== undefined) task.linkedObjectId = linkedObjectId;
  if (resolution !== undefined) task.resolution = resolution;

  // Apply status last so completedAt logic runs after all other fields
  if (status !== undefined) {
    task.status = status;
    if (status === 'COMPLETED' && !task.completedAt) {
      task.completedAt = new Date().toISOString();
    }
    // Clear the overdue-notified marker on terminal or reopen
    // transitions so a reopened task can re-fire the sweep on its
    // next due date. Also cleared when the due date itself changes
    // below.
    if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'OPEN') {
      task.overdueNotifiedAt = null;
    }
  }
  // A pushed-forward due date re-arms the fire even without a status
  // change. Clear the marker so the sweep considers this row again.
  if (dueDate !== undefined && dueDate !== before.dueDate) {
    task.overdueNotifiedAt = null;
  }

  task.updatedAt = new Date().toISOString();
  saveStore('governanceTasks', governanceTasks);
  auditService.log(task.orgId, null, 'GovernanceTask', task.id, 'UPDATE', before, task);
  logger.info({ taskId: task.id, title: task.title }, 'Updated governance task');
  res.json({ success: true, data: enrichTask(task) });
});

/** DELETE /api/v1/governance-tasks/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = governanceTasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Governance task not found' }); return; }
  const removed = governanceTasks[idx];
  auditService.log(removed.orgId, null, 'GovernanceTask', removed.id, 'DELETE', removed, null);
  governanceTasks.splice(idx, 1);
  saveStore('governanceTasks', governanceTasks);
  logger.info({ taskId: removed.id, title: removed.title }, 'Deleted governance task');
  res.status(204).send();
});

export default router;
