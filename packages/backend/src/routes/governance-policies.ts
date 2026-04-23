import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import { people } from './people';
import logger from '../lib/logger';

export interface StoredGovernancePolicy {
  id: string;
  orgId: string;
  code: string;
  name: string;
  description: string;
  status: 'DRAFT' | 'ACTIVE' | 'UNDER_REVIEW' | 'DEPRECATED';
  ownerAssignmentId: string | null;
  category: 'DATA_QUALITY' | 'SECURITY' | 'PRIVACY' | 'RETENTION' | 'ACCESS' | 'CLASSIFICATION' | 'GOVERNANCE' | 'GENERAL';
  reviewFrequency: 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'BIENNIAL' | 'NONE';
  lastReviewDate: string | null;
  nextReviewDate: string | null;
  effectiveDate: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const governancePolicies: StoredGovernancePolicy[] = loadStore<StoredGovernancePolicy>('governancePolicies');

function generateCode(): string {
  const seq = governancePolicies.length + 1;
  return `POL-${String(seq).padStart(3, '0')}`;
}

function resolveOwnerName(ownerAssignmentId: string | null): string | null {
  if (!ownerAssignmentId) return null;
  const person = people.find((p) => p.id === ownerAssignmentId);
  return person?.name || null;
}

const router = Router();

/** GET /api/v1/governance-policies — list policies */
router.get('/', (req: Request, res: Response) => {
  const { orgId, status, category } = req.query;
  let filtered = [...governancePolicies];
  if (orgId) filtered = filtered.filter((p) => p.orgId === orgId);
  if (status) filtered = filtered.filter((p) => p.status === status);
  if (category) filtered = filtered.filter((p) => p.category === category);

  const enriched = filtered.map((p) => ({
    ...p,
    ownerName: resolveOwnerName(p.ownerAssignmentId),
  }));

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/governance-policies/summary — aggregate counts */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  let filtered = [...governancePolicies];
  if (orgId) filtered = filtered.filter((p) => p.orgId === orgId);

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const today = new Date().toISOString().slice(0, 10);
  let overdueReviews = 0;

  for (const p of filtered) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    if (p.nextReviewDate && p.nextReviewDate < today) {
      overdueReviews++;
    }
  }

  res.json({ success: true, data: { total: filtered.length, byStatus, byCategory, overdueReviews } });
});

/** GET /api/v1/governance-policies/:id — single policy */
router.get('/:id', (req: Request, res: Response) => {
  const policy = governancePolicies.find((p) => p.id === req.params.id);
  if (!policy) { res.status(404).json({ success: false, error: 'Governance policy not found' }); return; }

  // Count linked controls — import at runtime to avoid circular dependency
  let linkedControlsCount = 0;
  try {
    const { governanceControls } = require('./governance-controls');
    linkedControlsCount = governanceControls.filter((c: any) => c.policyId === policy.id).length;
  } catch { /* controls module not loaded yet */ }

  res.json({
    success: true,
    data: {
      ...policy,
      ownerName: resolveOwnerName(policy.ownerAssignmentId),
      linkedControlsCount,
    },
  });
});

/** POST /api/v1/governance-policies — create policy */
router.post('/', (req: Request, res: Response) => {
  const { name, orgId, description, status, ownerAssignmentId, category, reviewFrequency,
          lastReviewDate, nextReviewDate, effectiveDate, content } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'Organization (orgId) is required' }); return; }

  const now = new Date().toISOString();
  const policy: StoredGovernancePolicy = {
    id: uuid(),
    orgId,
    code: generateCode(),
    name,
    description: description || '',
    status: status || 'DRAFT',
    ownerAssignmentId: ownerAssignmentId || null,
    category: category || 'GENERAL',
    reviewFrequency: reviewFrequency || 'ANNUAL',
    lastReviewDate: lastReviewDate || null,
    nextReviewDate: nextReviewDate || null,
    effectiveDate: effectiveDate || null,
    content: content || '',
    createdAt: now,
    updatedAt: now,
  };

  governancePolicies.push(policy);
  saveStore('governancePolicies', governancePolicies);
  auditService.log(policy.orgId, null, 'GovernancePolicy', policy.id, 'CREATE', null, policy);
  logger.info({ policyId: policy.id, code: policy.code, name: policy.name }, 'Created governance policy');
  res.status(201).json({ success: true, data: policy });
});

/** PUT /api/v1/governance-policies/:id — update policy */
router.put('/:id', (req: Request, res: Response) => {
  const policy = governancePolicies.find((p) => p.id === req.params.id);
  if (!policy) { res.status(404).json({ success: false, error: 'Governance policy not found' }); return; }

  const before = { ...policy };
  const { name, description, status, ownerAssignmentId, category, reviewFrequency,
          lastReviewDate, nextReviewDate, effectiveDate, content } = req.body;

  if (name !== undefined) policy.name = name;
  if (description !== undefined) policy.description = description;
  if (ownerAssignmentId !== undefined) policy.ownerAssignmentId = ownerAssignmentId;
  if (category !== undefined) policy.category = category;
  if (reviewFrequency !== undefined) policy.reviewFrequency = reviewFrequency;
  if (lastReviewDate !== undefined) policy.lastReviewDate = lastReviewDate;
  if (nextReviewDate !== undefined) policy.nextReviewDate = nextReviewDate;
  if (effectiveDate !== undefined) policy.effectiveDate = effectiveDate;
  if (content !== undefined) policy.content = content;

  // When status changes to ACTIVE, set effectiveDate if not already set
  if (status !== undefined) {
    if (status === 'ACTIVE' && policy.status !== 'ACTIVE' && !policy.effectiveDate) {
      policy.effectiveDate = new Date().toISOString().slice(0, 10);
    }
    policy.status = status;
  }

  policy.updatedAt = new Date().toISOString();
  saveStore('governancePolicies', governancePolicies);
  auditService.log(policy.orgId, null, 'GovernancePolicy', policy.id, 'UPDATE', before, policy);
  res.json({ success: true, data: policy });
});

/** DELETE /api/v1/governance-policies/:id — delete policy and orphan its controls */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = governancePolicies.findIndex((p) => p.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Governance policy not found' }); return; }

  const removed = governancePolicies[idx];

  // Orphan controls linked to this policy (set policyId to empty string)
  try {
    const { governanceControls } = require('./governance-controls');
    for (const ctrl of governanceControls) {
      if (ctrl.policyId === removed.id) {
        ctrl.policyId = '';
      }
    }
    saveStore('governanceControls', governanceControls);
  } catch { /* controls module not loaded yet */ }

  auditService.log(removed.orgId, null, 'GovernancePolicy', removed.id, 'DELETE', removed, null);
  governancePolicies.splice(idx, 1);
  saveStore('governancePolicies', governancePolicies);
  logger.info({ policyId: removed.id, code: removed.code }, 'Deleted governance policy');
  res.status(204).send();
});

export default router;
