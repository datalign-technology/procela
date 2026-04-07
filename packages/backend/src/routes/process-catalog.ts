import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';

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
  orgIds: string[]; // multiple organizations can participate
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  processes: StoredProcess[];
}

export const valueStreams: StoredValueStream[] = [];

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ── Helpers ──

function findVs(id: string) {
  return valueStreams.find((v) => v.id === id);
}

function findProcess(vsId: string, procId: string) {
  const vs = findVs(vsId);
  return vs ? vs.processes.find((p) => p.id === procId) : undefined;
}

function findSubProcess(vsId: string, procId: string, spId: string) {
  const proc = findProcess(vsId, procId);
  return proc ? proc.subProcesses.find((sp) => sp.id === spId) : undefined;
}

const router = Router();

// ═══════════════════════════════════════════
// VALUE STREAMS
// ═══════════════════════════════════════════

router.get('/value-streams', (_req: Request, res: Response) => {
  res.json({ success: true, data: valueStreams });
});

router.get('/value-streams/:id', (req: Request, res: Response) => {
  const vs = findVs(req.params.id);
  if (!vs) { res.status(404).json({ success: false, error: 'Value stream not found' }); return; }
  res.json({ success: true, data: vs });
});

router.post('/value-streams', (req: Request, res: Response) => {
  const { name, description, orgIds } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const now = new Date().toISOString();
  const vs: StoredValueStream = {
    id: uuid(), orgId: DEV_ORG_ID, orgIds: orgIds || [DEV_ORG_ID],
    name, description: description || '',
    status: 'DRAFT', createdAt: now, updatedAt: now, processes: [],
  };
  valueStreams.push(vs);
  res.status(201).json({ success: true, data: vs });
});

router.put('/value-streams/:id', (req: Request, res: Response) => {
  const vs = findVs(req.params.id);
  if (!vs) { res.status(404).json({ success: false, error: 'Value stream not found' }); return; }
  const { name, description, status, orgIds } = req.body;
  if (name !== undefined) vs.name = name;
  if (description !== undefined) vs.description = description;
  if (status !== undefined) vs.status = status;
  if (orgIds !== undefined) vs.orgIds = orgIds;
  vs.updatedAt = new Date().toISOString();
  res.json({ success: true, data: vs });
});

router.delete('/value-streams/:id', (req: Request, res: Response) => {
  const idx = valueStreams.findIndex((v) => v.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Value stream not found' }); return; }
  valueStreams.splice(idx, 1);
  res.status(204).send();
});

// ═══════════════════════════════════════════
// PROCESSES (nested under value stream)
// ═══════════════════════════════════════════

router.post('/value-streams/:vsId/processes', (req: Request, res: Response) => {
  const vs = findVs(req.params.vsId);
  if (!vs) { res.status(404).json({ success: false, error: 'Value stream not found' }); return; }
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const proc: StoredProcess = {
    id: uuid(), name, description: description || '',
    orderIndex: vs.processes.length, status: 'DRAFT', subProcesses: [],
  };
  vs.processes.push(proc);
  vs.updatedAt = new Date().toISOString();
  res.status(201).json({ success: true, data: proc });
});

router.put('/value-streams/:vsId/processes/:procId', (req: Request, res: Response) => {
  const proc = findProcess(req.params.vsId, req.params.procId);
  if (!proc) { res.status(404).json({ success: false, error: 'Process not found' }); return; }
  const { name, description, status, orderIndex } = req.body;
  if (name !== undefined) proc.name = name;
  if (description !== undefined) proc.description = description;
  if (status !== undefined) proc.status = status;
  if (orderIndex !== undefined) proc.orderIndex = orderIndex;
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.json({ success: true, data: proc });
});

router.delete('/value-streams/:vsId/processes/:procId', (req: Request, res: Response) => {
  const vs = findVs(req.params.vsId);
  if (!vs) { res.status(404).json({ success: false, error: 'Value stream not found' }); return; }
  const idx = vs.processes.findIndex((p) => p.id === req.params.procId);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Process not found' }); return; }
  vs.processes.splice(idx, 1);
  vs.updatedAt = new Date().toISOString();
  res.status(204).send();
});

// ═══════════════════════════════════════════
// SUB-PROCESSES (nested under process)
// ═══════════════════════════════════════════

router.post('/value-streams/:vsId/processes/:procId/sub-processes', (req: Request, res: Response) => {
  const proc = findProcess(req.params.vsId, req.params.procId);
  if (!proc) { res.status(404).json({ success: false, error: 'Process not found' }); return; }
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const sp: StoredSubProcess = {
    id: uuid(), name, description: description || '',
    orderIndex: proc.subProcesses.length, status: 'DRAFT', steps: [],
  };
  proc.subProcesses.push(sp);
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.status(201).json({ success: true, data: sp });
});

router.put('/value-streams/:vsId/processes/:procId/sub-processes/:spId', (req: Request, res: Response) => {
  const sp = findSubProcess(req.params.vsId, req.params.procId, req.params.spId);
  if (!sp) { res.status(404).json({ success: false, error: 'Sub-process not found' }); return; }
  const { name, description, status, orderIndex } = req.body;
  if (name !== undefined) sp.name = name;
  if (description !== undefined) sp.description = description;
  if (status !== undefined) sp.status = status;
  if (orderIndex !== undefined) sp.orderIndex = orderIndex;
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.json({ success: true, data: sp });
});

router.delete('/value-streams/:vsId/processes/:procId/sub-processes/:spId', (req: Request, res: Response) => {
  const proc = findProcess(req.params.vsId, req.params.procId);
  if (!proc) { res.status(404).json({ success: false, error: 'Process not found' }); return; }
  const idx = proc.subProcesses.findIndex((sp) => sp.id === req.params.spId);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Sub-process not found' }); return; }
  proc.subProcesses.splice(idx, 1);
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.status(204).send();
});

// ═══════════════════════════════════════════
// STEPS (nested under sub-process)
// ═══════════════════════════════════════════

router.post('/value-streams/:vsId/processes/:procId/sub-processes/:spId/steps', (req: Request, res: Response) => {
  const sp = findSubProcess(req.params.vsId, req.params.procId, req.params.spId);
  if (!sp) { res.status(404).json({ success: false, error: 'Sub-process not found' }); return; }
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const step: StoredStep = {
    id: uuid(), name, description: description || '',
    orderIndex: sp.steps.length, status: 'DRAFT',
  };
  sp.steps.push(step);
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.status(201).json({ success: true, data: step });
});

router.put('/value-streams/:vsId/processes/:procId/sub-processes/:spId/steps/:stepId', (req: Request, res: Response) => {
  const sp = findSubProcess(req.params.vsId, req.params.procId, req.params.spId);
  if (!sp) { res.status(404).json({ success: false, error: 'Sub-process not found' }); return; }
  const step = sp.steps.find((s) => s.id === req.params.stepId);
  if (!step) { res.status(404).json({ success: false, error: 'Step not found' }); return; }
  const { name, description, status, orderIndex } = req.body;
  if (name !== undefined) step.name = name;
  if (description !== undefined) step.description = description;
  if (status !== undefined) step.status = status;
  if (orderIndex !== undefined) step.orderIndex = orderIndex;
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.json({ success: true, data: step });
});

router.delete('/value-streams/:vsId/processes/:procId/sub-processes/:spId/steps/:stepId', (req: Request, res: Response) => {
  const sp = findSubProcess(req.params.vsId, req.params.procId, req.params.spId);
  if (!sp) { res.status(404).json({ success: false, error: 'Sub-process not found' }); return; }
  const idx = sp.steps.findIndex((s) => s.id === req.params.stepId);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Step not found' }); return; }
  sp.steps.splice(idx, 1);
  const vs = findVs(req.params.vsId);
  if (vs) vs.updatedAt = new Date().toISOString();
  res.status(204).send();
});

// ═══════════════════════════════════════════
// TEMPLATE APPLICATION
// ═══════════════════════════════════════════

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
        id: uuid(), orgId: DEV_ORG_ID, orgIds: [DEV_ORG_ID], name: tvs.name,
        description: tvs.description || `Generated from ${industry} template`,
        status: 'DRAFT', createdAt: now, updatedAt: now,
        processes: (tvs.processes || []).map((proc: any, pIdx: number) => ({
          id: uuid(), name: proc.name, description: proc.description || '',
          orderIndex: pIdx, status: 'DRAFT',
          subProcesses: (proc.subProcesses || []).map((sp: any, spIdx: number) => ({
            id: uuid(), name: sp.name, description: sp.description || '',
            orderIndex: spIdx, status: 'DRAFT',
            steps: (sp.steps || []).map((st: any, stIdx: number) => ({
              id: uuid(), name: st.name, description: st.description || '',
              orderIndex: stIdx, status: 'DRAFT',
            })),
          })),
        })),
      };
      valueStreams.push(vs);
      created.push(vs);
    }
    logger.info({ count: created.length, industry }, 'Applied template');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('[ProcessCatalog] Apply template failed:', err);
    res.status(500).json({ success: false, error: 'Failed to apply template' });
  }
});

export default router;
