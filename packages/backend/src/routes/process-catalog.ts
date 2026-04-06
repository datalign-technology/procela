import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

// ── In-memory store (replace with Prisma once DB is migrated) ──

interface StoredStep {
  id: string;
  name: string;
  description: string;
  orderIndex: number;
  status: string;
}

interface StoredSubProcess {
  id: string;
  name: string;
  description: string;
  orderIndex: number;
  status: string;
  steps: StoredStep[];
}

interface StoredProcess {
  id: string;
  name: string;
  description: string;
  orderIndex: number;
  status: string;
  subProcesses: StoredSubProcess[];
}

interface StoredValueStream {
  id: string;
  orgId: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  processes: StoredProcess[];
}

const valueStreams: StoredValueStream[] = [];

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/**
 * GET /api/v1/process-catalog/value-streams
 * List all value streams (with nested hierarchy).
 */
router.get('/value-streams', (_req: Request, res: Response) => {
  res.json({ success: true, data: valueStreams });
});

/**
 * GET /api/v1/process-catalog/value-streams/:id
 * Get a single value stream by ID.
 */
router.get('/value-streams/:id', (req: Request, res: Response) => {
  const vs = valueStreams.find((v) => v.id === req.params.id);
  if (!vs) {
    res.status(404).json({ success: false, error: 'Value stream not found' });
    return;
  }
  res.json({ success: true, data: vs });
});

/**
 * POST /api/v1/process-catalog/value-streams
 * Create a single value stream (manual creation).
 */
router.post('/value-streams', (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ success: false, error: 'Name is required' });
    return;
  }

  const now = new Date().toISOString();
  const vs: StoredValueStream = {
    id: uuid(),
    orgId: DEV_ORG_ID,
    name,
    description: description || '',
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    processes: [],
  };
  valueStreams.push(vs);
  res.status(201).json({ success: true, data: vs });
});

/**
 * POST /api/v1/process-catalog/apply-template
 * Apply a generated template — creates multiple value streams with full hierarchy.
 */
router.post('/apply-template', (req: Request, res: Response) => {
  try {
    const { industry, valueStreams: templateStreams } = req.body;

    if (!templateStreams || !Array.isArray(templateStreams) || templateStreams.length === 0) {
      res.status(400).json({ success: false, error: 'No value streams provided' });
      return;
    }

    const created: StoredValueStream[] = [];
    const now = new Date().toISOString();

    for (const tvs of templateStreams) {
      const vs: StoredValueStream = {
        id: uuid(),
        orgId: DEV_ORG_ID,
        name: tvs.name,
        description: tvs.description || `Generated from ${industry} template`,
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
        processes: (tvs.processes || []).map((proc: any, pIdx: number) => ({
          id: uuid(),
          name: proc.name,
          description: proc.description || '',
          orderIndex: pIdx,
          status: 'DRAFT',
          subProcesses: (proc.subProcesses || []).map((sp: any, spIdx: number) => ({
            id: uuid(),
            name: sp.name,
            description: sp.description || '',
            orderIndex: spIdx,
            status: 'DRAFT',
            steps: (sp.steps || []).map((st: any, stIdx: number) => ({
              id: uuid(),
              name: st.name,
              description: st.description || '',
              orderIndex: stIdx,
              status: 'DRAFT',
            })),
          })),
        })),
      };
      valueStreams.push(vs);
      created.push(vs);
    }

    console.log(`[ProcessCatalog] Applied template: ${created.length} value streams from "${industry}"`);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('[ProcessCatalog] Apply template failed:', err);
    res.status(500).json({ success: false, error: 'Failed to apply template' });
  }
});

/**
 * PUT /api/v1/process-catalog/value-streams/:id
 * Update a value stream.
 */
router.put('/value-streams/:id', (req: Request, res: Response) => {
  const idx = valueStreams.findIndex((v) => v.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Value stream not found' });
    return;
  }

  const { name, description, status } = req.body;
  if (name !== undefined) valueStreams[idx].name = name;
  if (description !== undefined) valueStreams[idx].description = description;
  if (status !== undefined) valueStreams[idx].status = status;
  valueStreams[idx].updatedAt = new Date().toISOString();

  res.json({ success: true, data: valueStreams[idx] });
});

/**
 * DELETE /api/v1/process-catalog/value-streams/:id
 * Delete a value stream and all nested items.
 */
router.delete('/value-streams/:id', (req: Request, res: Response) => {
  const idx = valueStreams.findIndex((v) => v.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Value stream not found' });
    return;
  }

  valueStreams.splice(idx, 1);
  res.status(204).send();
});

export default router;
