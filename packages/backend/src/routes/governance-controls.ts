import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { governancePolicies } from './governance-policies';
import { people } from './people';
import logger from '../lib/logger';
import { getGovernanceControlsRepository } from '../db/governance-controls.repo';

export interface StoredGovernanceControl {
  id: string;
  orgId: string;
  policyId: string;
  code: string;
  name: string;
  description: string;
  controlType: 'PREVENTIVE' | 'DETECTIVE' | 'CORRECTIVE';
  automationMode: 'HUMAN' | 'AGENT' | 'HYBRID';
  status: 'DRAFT' | 'ACTIVE' | 'DEPRECATED';
  ownerAssignmentId: string | null;
  evidenceRequired: boolean;
  linkedDomainId: string | null;
  linkedSystemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const governanceControls: StoredGovernanceControl[] = loadStore<StoredGovernanceControl>('governanceControls');
registerStore('governanceControls', governanceControls);

const governanceControlsRepo = getGovernanceControlsRepository(governanceControls);

function generateCode(): string {
  const seq = governanceControls.length + 1;
  return `CTL-${String(seq).padStart(3, '0')}`;
}

function resolveOwnerName(ownerAssignmentId: string | null): string | null {
  if (!ownerAssignmentId) return null;
  const person = people.find((p) => p.id === ownerAssignmentId);
  return person?.name || null;
}

function resolvePolicyName(policyId: string): string | null {
  if (!policyId) return null;
  const policy = governancePolicies.find((p) => p.id === policyId);
  return policy?.name || null;
}

const router = Router();

/** GET /api/v1/governance-controls — list controls */
router.get('/', async (req: Request, res: Response) => {
  const { orgId, policyId, controlType, automationMode, status } = req.query;
  let filtered = await governanceControlsRepo.list();
  if (orgId) filtered = filtered.filter((c) => c.orgId === orgId);
  if (policyId) filtered = filtered.filter((c) => c.policyId === policyId);
  if (controlType) filtered = filtered.filter((c) => c.controlType === controlType);
  if (automationMode) filtered = filtered.filter((c) => c.automationMode === automationMode);
  if (status) filtered = filtered.filter((c) => c.status === status);

  const enriched = filtered.map((c) => ({
    ...c,
    ownerName: resolveOwnerName(c.ownerAssignmentId),
    policyName: resolvePolicyName(c.policyId),
  }));

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/governance-controls/summary — aggregate counts */
router.get('/summary', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  let filtered = await governanceControlsRepo.list();
  if (orgId) filtered = filtered.filter((c) => c.orgId === orgId);

  const byControlType: Record<string, number> = {};
  const byAutomationMode: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const c of filtered) {
    byControlType[c.controlType] = (byControlType[c.controlType] || 0) + 1;
    byAutomationMode[c.automationMode] = (byAutomationMode[c.automationMode] || 0) + 1;
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }

  res.json({ success: true, data: { total: filtered.length, byControlType, byAutomationMode, byStatus } });
});

/** GET /api/v1/governance-controls/:id — single control */
router.get('/:id', async (req: Request, res: Response) => {
  const control = governanceControls.find((c) => c.id === req.params.id);
  if (!control) { res.status(404).json({ success: false, error: 'Governance control not found' }); return; }

  res.json({
    success: true,
    data: {
      ...control,
      ownerName: resolveOwnerName(control.ownerAssignmentId),
      policyName: resolvePolicyName(control.policyId),
    },
  });
});

/** POST /api/v1/governance-controls — create control */
router.post('/', async (req: Request, res: Response) => {
  const { name, policyId, orgId, description, controlType, automationMode, status,
          ownerAssignmentId, evidenceRequired, linkedDomainId, linkedSystemId } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!policyId) { res.status(400).json({ success: false, error: 'Policy (policyId) is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'Organization (orgId) is required' }); return; }

  const now = new Date().toISOString();
  const control: StoredGovernanceControl = {
    id: uuid(),
    orgId,
    policyId,
    code: generateCode(),
    name,
    description: description || '',
    controlType: controlType || 'DETECTIVE',
    automationMode: automationMode || 'HUMAN',
    status: status || 'DRAFT',
    ownerAssignmentId: ownerAssignmentId || null,
    evidenceRequired: evidenceRequired ?? false,
    linkedDomainId: linkedDomainId || null,
    linkedSystemId: linkedSystemId || null,
    createdAt: now,
    updatedAt: now,
  };

  await governanceControlsRepo.create(control);
  auditService.log(control.orgId, null, 'GovernanceControl', control.id, 'CREATE', null, control);
  logger.info({ controlId: control.id, code: control.code, name: control.name, policyId }, 'Created governance control');
  res.status(201).json({ success: true, data: control });
});

/** PUT /api/v1/governance-controls/:id — update control */
router.put('/:id', async (req: Request, res: Response) => {
  const control = governanceControls.find((c) => c.id === req.params.id);
  if (!control) { res.status(404).json({ success: false, error: 'Governance control not found' }); return; }

  const before = { ...control };
  const { name, policyId, description, controlType, automationMode, status,
          ownerAssignmentId, evidenceRequired, linkedDomainId, linkedSystemId } = req.body;

  const patch: Partial<StoredGovernanceControl> = {};
  if (name !== undefined) patch.name = name;
  if (policyId !== undefined) patch.policyId = policyId;
  if (description !== undefined) patch.description = description;
  if (controlType !== undefined) patch.controlType = controlType;
  if (automationMode !== undefined) patch.automationMode = automationMode;
  if (status !== undefined) patch.status = status;
  if (ownerAssignmentId !== undefined) patch.ownerAssignmentId = ownerAssignmentId;
  if (evidenceRequired !== undefined) patch.evidenceRequired = evidenceRequired;
  if (linkedDomainId !== undefined) patch.linkedDomainId = linkedDomainId;
  if (linkedSystemId !== undefined) patch.linkedSystemId = linkedSystemId;
  patch.updatedAt = new Date().toISOString();

  const updated = await governanceControlsRepo.update(control.id, patch);
  auditService.log(control.orgId, null, 'GovernanceControl', control.id, 'UPDATE', before, updated);
  res.json({ success: true, data: updated });
});

/** DELETE /api/v1/governance-controls/:id — delete control */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = governanceControls.find((c) => c.id === req.params.id);
  if (!removed) { res.status(404).json({ success: false, error: 'Governance control not found' }); return; }

  auditService.log(removed.orgId, null, 'GovernanceControl', removed.id, 'DELETE', removed, null);
  await governanceControlsRepo.delete(removed.id);

  // Cascade: sweep the deleted control id off every activity that
  // referenced it. Lazy-require breaks the controls ↔ catalog import
  // graph (catalog already lazy-requires controls the other way).
  let processNodesTouched = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { processNodes } = require('./process-catalog') as typeof import('./process-catalog');
    for (const n of processNodes) {
      if (!n.controlIds || n.controlIds.length === 0) continue;
      const next = n.controlIds.filter((id) => id !== removed.id);
      if (next.length !== n.controlIds.length) {
        n.controlIds = next.length > 0 ? next : undefined;
        processNodesTouched++;
      }
    }
    if (processNodesTouched > 0) saveStore('processNodes', processNodes);
  } catch (err) {
    logger.warn({ err, controlId: removed.id }, 'Failed to cascade control delete to activities');
  }
  logger.info({ controlId: removed.id, code: removed.code, processNodesTouched }, 'Deleted governance control');
  res.status(204).send();
});

export default router;
