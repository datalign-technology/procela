import { Router, Request, Response } from 'express';
import { auditService } from '../services/audit.service';
import { processNodes, NODE_LEVELS } from './process-catalog';
import { getProcessNodesRepository } from '../db/process-nodes.repo';

// Lazy repo accessor: the raw `processNodes` array is empty in Postgres
// mode, so reads go through the repository (source of truth in DB mode,
// and the same in-memory array in JSON mode).
let _processNodesRepo: ReturnType<typeof getProcessNodesRepository> | null = null;
const processNodesRepo = () => (_processNodesRepo ??= getProcessNodesRepository(processNodes));

const router = Router();

/** GET /api/v1/trends/activity — count of CREATE/UPDATE/DELETE actions per day for the last 30 days */
router.get('/activity', async (req: Request, res: Response) => {
  const entries = await auditService.getAll();
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Build a map of date -> { creates, updates, deletes }
  const dayMap: Record<string, { creates: number; updates: number; deletes: number }> = {};

  // Pre-fill last 30 days
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = { creates: 0, updates: 0, deletes: 0 };
  }

  for (const entry of entries) {
    const ts = new Date(entry.timestamp);
    if (ts < thirtyDaysAgo) continue;
    const key = ts.toISOString().slice(0, 10);
    if (!dayMap[key]) dayMap[key] = { creates: 0, updates: 0, deletes: 0 };

    const action = entry.action.toUpperCase();
    if (action === 'CREATE') dayMap[key].creates++;
    else if (action === 'UPDATE') dayMap[key].updates++;
    else if (action === 'DELETE' || action === 'DELETE_ALL') dayMap[key].deletes++;
  }

  // Convert to sorted array (most recent first)
  const days = Object.entries(dayMap)
    .map(([date, counts]) => ({
      date,
      creates: counts.creates,
      updates: counts.updates,
      deletes: counts.deletes,
      total: counts.creates + counts.updates + counts.deletes,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  res.json({ success: true, data: days });
});

/** GET /api/v1/trends/status — count of process nodes by status (current snapshot) */
router.get('/status', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  const allNodes = await processNodesRepo().list();
  const filteredNodes = oid
    ? allNodes.filter((n) => n.orgIds.includes(oid) || n.orgId === oid)
    : allNodes;

  const statusCounts: Record<string, number> = {};
  for (const node of filteredNodes) {
    const s = node.status || 'UNKNOWN';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const statuses = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count,
  }));

  res.json({ success: true, data: statuses });
});

export default router;
