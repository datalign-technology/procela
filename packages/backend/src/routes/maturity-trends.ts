import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { getMaturitySnapshotsRepository } from '../db/maturity-snapshots.repo';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SnapshotDimension {
  name: string;
  score: number;
}

export interface ScorecardSnapshot {
  id: string;
  orgId: string;
  timestamp: string;
  overall: number;
  dimensions: SnapshotDimension[];
}

// ---------------------------------------------------------------------------
// In-memory store with persistence
// ---------------------------------------------------------------------------
export const maturitySnapshots: ScorecardSnapshot[] = loadStore<ScorecardSnapshot>('maturitySnapshots');
registerStore('maturitySnapshots', maturitySnapshots);

const maturitySnapshotsRepo = getMaturitySnapshotsRepository(maturitySnapshots);

function persist() {
  saveStore('maturitySnapshots', maturitySnapshots);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /api/v1/maturity-trends — list snapshots for an org, sorted by timestamp */
router.get('/', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  const all = await maturitySnapshotsRepo.list();
  let results = oid
    ? all.filter((s) => s.orgId === oid)
    : all;

  // Sort by timestamp ascending (oldest first, so charts read left-to-right)
  results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  res.json({ success: true, data: results });
});

/** POST /api/v1/maturity-trends/snapshot — save a scorecard snapshot */
router.post('/snapshot', async (req: Request, res: Response) => {
  const { orgId, overall, dimensions } = req.body;

  if (!orgId || overall === undefined || !Array.isArray(dimensions)) {
    return res.status(400).json({
      success: false,
      message: 'orgId, overall, and dimensions are required',
    });
  }

  const snapshot: ScorecardSnapshot = {
    id: uuid(),
    orgId,
    timestamp: new Date().toISOString(),
    overall: Number(overall),
    dimensions: dimensions.map((d: any) => ({
      name: String(d.name),
      score: Number(d.score),
    })),
  };

  await maturitySnapshotsRepo.create(snapshot);

  res.status(201).json({ success: true, data: snapshot });
});

/** DELETE /api/v1/maturity-trends/all — clear all snapshots. */
router.delete('/all', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  const all = await maturitySnapshotsRepo.list();
  if (oid) {
    // Remove only snapshots for this org
    const victims = all.filter((s) => s.orgId === oid).map((s) => s.id);
    for (const id of victims) {
      await maturitySnapshotsRepo.delete(id);
    }
    res.json({ success: true, removed: victims.length });
  } else {
    const ids = all.map((s) => s.id);
    for (const id of ids) {
      await maturitySnapshotsRepo.delete(id);
    }
    res.json({ success: true, removed: 0 });
  }
});

export default router;
