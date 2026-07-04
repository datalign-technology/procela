import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SnapshotDimension {
  name: string;
  score: number;
}

interface ScorecardSnapshot {
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

function persist() {
  saveStore('maturitySnapshots', maturitySnapshots);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /api/v1/maturity-trends — list snapshots for an org, sorted by timestamp */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  let results = oid
    ? maturitySnapshots.filter((s) => s.orgId === oid)
    : [...maturitySnapshots];

  // Sort by timestamp ascending (oldest first, so charts read left-to-right)
  results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  res.json({ success: true, data: results });
});

/** POST /api/v1/maturity-trends/snapshot — save a scorecard snapshot */
router.post('/snapshot', (req: Request, res: Response) => {
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

  maturitySnapshots.push(snapshot);
  persist();

  res.status(201).json({ success: true, data: snapshot });
});

/** DELETE /api/v1/maturity-trends/all — clear all snapshots */
router.delete('/all', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const oid = orgId as string | undefined;

  if (oid) {
    // Remove only snapshots for this org
    const before = maturitySnapshots.length;
    for (let i = maturitySnapshots.length - 1; i >= 0; i--) {
      if (maturitySnapshots[i].orgId === oid) {
        maturitySnapshots.splice(i, 1);
      }
    }
    persist();
    res.json({ success: true, removed: before - maturitySnapshots.length });
  } else {
    maturitySnapshots.length = 0;
    persist();
    res.json({ success: true, removed: 0 });
  }
});

export default router;
