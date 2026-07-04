import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';

export type DecisionCategory =
  | 'POLICY'
  | 'EXCEPTION'
  | 'ISSUE'
  | 'CLASSIFICATION'
  | 'ACCESS'
  | 'SCOPE'
  | 'ROLE'
  | 'OTHER';

export interface StoredDecisionRight {
  id: string;
  orgId: string;
  decision: string;
  category: DecisionCategory;
  description: string;
  decider: string | null;
  deciderType: 'PERSON' | 'ROLE' | 'GROUP';
  recommends: string[];
  approves: string[];
  informed: string[];
  escalationPath: string;
  createdAt: string;
  updatedAt: string;
}

export const decisionRights: StoredDecisionRight[] = loadStore<StoredDecisionRight>('decisionRights');
registerStore('decisionRights', decisionRights);

const VALID_CATEGORIES: DecisionCategory[] = [
  'POLICY', 'EXCEPTION', 'ISSUE', 'CLASSIFICATION', 'ACCESS', 'SCOPE', 'ROLE', 'OTHER',
];

const VALID_DECIDER_TYPES = ['PERSON', 'ROLE', 'GROUP'] as const;

interface StandardDecisionSeed {
  decision: string;
  category: DecisionCategory;
  description: string;
  deciderRole: string;
  recommendsRoles?: string[];
  approvesRoles?: string[];
  informedRoles?: string[];
}

const STANDARD_DECISIONS: StandardDecisionSeed[] = [
  { decision: 'Approve a new data policy', category: 'POLICY', description: 'Ratify a new governance policy for organization-wide adoption.', deciderRole: 'DATA_GOVERNANCE_LEAD', approvesRoles: ['CDO'], informedRoles: ['DATA_OWNER', 'BUSINESS_DATA_STEWARD'] },
  { decision: 'Retire an existing policy', category: 'POLICY', description: 'Deprecate a policy that is no longer applicable.', deciderRole: 'DATA_GOVERNANCE_LEAD', approvesRoles: ['CDO'], informedRoles: ['DATA_OWNER'] },
  { decision: 'Grant a policy exception', category: 'EXCEPTION', description: 'Allow a specific exception to a policy with documented justification and time limit.', deciderRole: 'DATA_OWNER', recommendsRoles: ['BUSINESS_DATA_STEWARD'], approvesRoles: ['DATA_GOVERNANCE_LEAD'] },
  { decision: 'Escalate a data quality issue', category: 'ISSUE', description: 'Elevate an unresolved quality issue to the next authority level.', deciderRole: 'BUSINESS_DATA_STEWARD', informedRoles: ['DATA_OWNER'] },
  { decision: 'Close a critical data issue', category: 'ISSUE', description: 'Mark a Critical-severity issue as resolved or closed.', deciderRole: 'DATA_OWNER', recommendsRoles: ['BUSINESS_DATA_STEWARD', 'TECHNICAL_DATA_STEWARD'], approvesRoles: ['DATA_GOVERNANCE_LEAD'] },
  { decision: 'Change classification of sensitive data', category: 'CLASSIFICATION', description: 'Reclassify data (e.g. from Internal to Confidential). Triggers review of access controls.', deciderRole: 'DATA_OWNER', recommendsRoles: ['TECHNICAL_DATA_STEWARD'], approvesRoles: ['CDO'] },
  { decision: 'Approve access to restricted data', category: 'ACCESS', description: 'Grant a person or role access to Restricted or Confidential data.', deciderRole: 'DATA_OWNER', recommendsRoles: ['BUSINESS_DATA_STEWARD'], informedRoles: ['TECHNICAL_DATA_STEWARD'] },
  { decision: 'Change scope of a data domain', category: 'SCOPE', description: "Add or remove data assets from a domain's scope.", deciderRole: 'DATA_OWNER', approvesRoles: ['DATA_GOVERNANCE_LEAD'], informedRoles: ['BUSINESS_DATA_STEWARD'] },
  { decision: 'Assign or remove a Data Steward', category: 'ROLE', description: 'Appoint a new steward or transition stewardship responsibility.', deciderRole: 'DATA_OWNER', recommendsRoles: ['DATA_GOVERNANCE_LEAD'], informedRoles: ['CDO'] },
  { decision: 'Approve governance framework change', category: 'OTHER', description: 'Material change to the governance operating model, structure, or charter.', deciderRole: 'CDO', recommendsRoles: ['DATA_GOVERNANCE_LEAD'], approvesRoles: ['CDO'], informedRoles: ['DATA_OWNER'] },
];

function enrichWithDeciderName(row: StoredDecisionRight): StoredDecisionRight & { deciderName: string | null } {
  let deciderName: string | null = null;
  if (row.deciderType === 'PERSON' && row.decider) {
    const person = people.find((p) => p.id === row.decider);
    deciderName = person?.name || null;
  }
  return { ...row, deciderName };
}

const router = Router();

/** GET /api/v1/decision-rights — list (optional ?orgId= and ?category= filters) */
router.get('/', (req: Request, res: Response) => {
  const { orgId, category } = req.query;
  let filtered = [...decisionRights];
  if (orgId) filtered = filtered.filter((r) => r.orgId === orgId);
  if (category) filtered = filtered.filter((r) => r.category === category);

  const enriched = filtered.map(enrichWithDeciderName);
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/decision-rights/:id — single decision right */
router.get('/:id', (req: Request, res: Response) => {
  const row = decisionRights.find((r) => r.id === req.params.id);
  if (!row) { res.status(404).json({ success: false, error: 'Decision right not found' }); return; }
  res.json({ success: true, data: enrichWithDeciderName(row) });
});

/** POST /api/v1/decision-rights — create */
router.post('/', (req: Request, res: Response) => {
  const {
    orgId, decision, category, description,
    decider, deciderType, recommends, approves, informed, escalationPath,
  } = req.body;

  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!decision || typeof decision !== 'string' || !decision.trim()) {
    res.status(400).json({ success: false, error: 'decision is required' });
    return;
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    res.status(400).json({ success: false, error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    return;
  }
  const finalDeciderType = deciderType || 'ROLE';
  if (!(VALID_DECIDER_TYPES as readonly string[]).includes(finalDeciderType)) {
    res.status(400).json({ success: false, error: `Invalid deciderType. Must be one of: ${VALID_DECIDER_TYPES.join(', ')}` });
    return;
  }

  const now = new Date().toISOString();
  const row: StoredDecisionRight = {
    id: uuid(),
    orgId,
    decision: decision.trim(),
    category,
    description: description || '',
    decider: decider || null,
    deciderType: finalDeciderType,
    recommends: Array.isArray(recommends) ? recommends : [],
    approves: Array.isArray(approves) ? approves : [],
    informed: Array.isArray(informed) ? informed : [],
    escalationPath: escalationPath || '',
    createdAt: now,
    updatedAt: now,
  };
  decisionRights.push(row);
  saveStore('decisionRights', decisionRights);
  auditService.log(row.orgId, null, 'DecisionRight', row.id, 'CREATE', null, row);
  logger.info({ decisionRightId: row.id, decision: row.decision }, 'Created decision right');
  res.status(201).json({ success: true, data: enrichWithDeciderName(row) });
});

/** PUT /api/v1/decision-rights/:id — update */
router.put('/:id', (req: Request, res: Response) => {
  const row = decisionRights.find((r) => r.id === req.params.id);
  if (!row) { res.status(404).json({ success: false, error: 'Decision right not found' }); return; }

  const before = { ...row };
  const {
    decision, category, description, decider, deciderType,
    recommends, approves, informed, escalationPath,
  } = req.body;

  if (decision !== undefined) row.decision = decision;
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ success: false, error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    row.category = category;
  }
  if (description !== undefined) row.description = description;
  if (decider !== undefined) row.decider = decider;
  if (deciderType !== undefined) {
    if (!(VALID_DECIDER_TYPES as readonly string[]).includes(deciderType)) {
      res.status(400).json({ success: false, error: `Invalid deciderType. Must be one of: ${VALID_DECIDER_TYPES.join(', ')}` });
      return;
    }
    row.deciderType = deciderType;
  }
  if (recommends !== undefined) row.recommends = Array.isArray(recommends) ? recommends : [];
  if (approves !== undefined) row.approves = Array.isArray(approves) ? approves : [];
  if (informed !== undefined) row.informed = Array.isArray(informed) ? informed : [];
  if (escalationPath !== undefined) row.escalationPath = escalationPath;

  row.updatedAt = new Date().toISOString();
  saveStore('decisionRights', decisionRights);
  auditService.log(row.orgId, null, 'DecisionRight', row.id, 'UPDATE', before, row);
  res.json({ success: true, data: enrichWithDeciderName(row) });
});

/** DELETE /api/v1/decision-rights/:id — delete */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = decisionRights.findIndex((r) => r.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Decision right not found' }); return; }
  const removed = decisionRights[idx];
  decisionRights.splice(idx, 1);
  saveStore('decisionRights', decisionRights);
  auditService.log(removed.orgId, null, 'DecisionRight', removed.id, 'DELETE', removed, null);
  logger.info({ decisionRightId: removed.id }, 'Deleted decision right');
  res.status(204).send();
});

/** POST /api/v1/decision-rights/seed — creates standard decision rights for an org */
router.post('/seed', (req: Request, res: Response) => {
  const { orgId } = req.body;
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }

  const now = new Date().toISOString();
  const created: StoredDecisionRight[] = [];
  let skipped = 0;

  for (const seed of STANDARD_DECISIONS) {
    const existing = decisionRights.find(
      (r) => r.orgId === orgId && r.decision.toLowerCase() === seed.decision.toLowerCase(),
    );
    if (existing) { skipped++; continue; }

    const row: StoredDecisionRight = {
      id: uuid(),
      orgId,
      decision: seed.decision,
      category: seed.category,
      description: seed.description,
      decider: seed.deciderRole,
      deciderType: 'ROLE',
      recommends: seed.recommendsRoles || [],
      approves: seed.approvesRoles || [],
      informed: seed.informedRoles || [],
      escalationPath: '',
      createdAt: now,
      updatedAt: now,
    };
    decisionRights.push(row);
    created.push(row);
    auditService.log(orgId, null, 'DecisionRight', row.id, 'CREATE', null, row);
  }

  saveStore('decisionRights', decisionRights);
  logger.info({ orgId, created: created.length, skipped }, 'Seeded standard decision rights');

  res.status(201).json({
    success: true,
    data: created.map(enrichWithDeciderName),
    created: created.length,
    skipped,
  });
});

export default router;
