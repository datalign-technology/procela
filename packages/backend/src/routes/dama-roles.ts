import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { people } from './people';

export const DAMA_ROLE_TYPES = [
  'CDO',                    // Chief Data Officer
  'DATA_GOVERNANCE_LEAD',   // Data Governance Program Manager
  'DATA_OWNER',             // Business executive accountable for data domain
  'DATA_STEWARD',           // Manages data definitions, quality, standards
  'DATA_CUSTODIAN',         // Technical responsibility for data storage/security
  'DATA_ARCHITECT',         // Designs data models and integration
  'DATA_QUALITY_ANALYST',   // Monitors and reports on data quality
] as const;

export interface StoredDamaRole {
  id: string;
  personId: string;
  roleType: string;    // one of DAMA_ROLE_TYPES
  scopeType: 'ORG' | 'DOMAIN';  // scoped to an org or a data domain
  scopeId: string;     // orgId or domainId
  since: string;
  createdAt: string;
}

export const damaRoles: StoredDamaRole[] = loadStore<StoredDamaRole>('damaRoles');

const router = Router();

/** GET /api/v1/dama-roles — list all (support ?orgId= and ?personId= filters). Enrich with person name. */
router.get('/', (req: Request, res: Response) => {
  const { orgId, personId } = req.query;
  let filtered = [...damaRoles];

  if (orgId) {
    filtered = filtered.filter((r) => r.scopeType === 'ORG' && r.scopeId === orgId);
  }
  if (personId) {
    filtered = filtered.filter((r) => r.personId === personId);
  }

  const enriched = filtered.map((r) => {
    const person = people.find((p) => p.id === r.personId);
    return { ...r, personName: person?.name || 'Unknown' };
  });

  res.json({ success: true, data: enriched, roleTypes: DAMA_ROLE_TYPES });
});

/** POST /api/v1/dama-roles — assign a DAMA role */
router.post('/', (req: Request, res: Response) => {
  const { personId, roleType, scopeType, scopeId } = req.body;

  if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
  if (!roleType || !(DAMA_ROLE_TYPES as readonly string[]).includes(roleType)) {
    res.status(400).json({ success: false, error: `Invalid roleType. Must be one of: ${DAMA_ROLE_TYPES.join(', ')}` });
    return;
  }
  if (!scopeType || !['ORG', 'DOMAIN'].includes(scopeType)) {
    res.status(400).json({ success: false, error: 'scopeType must be ORG or DOMAIN' });
    return;
  }
  if (!scopeId) { res.status(400).json({ success: false, error: 'scopeId is required' }); return; }

  const person = people.find((p) => p.id === personId);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }

  // Prevent duplicate (same person + roleType + scopeId)
  const duplicate = damaRoles.find(
    (r) => r.personId === personId && r.roleType === roleType && r.scopeId === scopeId,
  );
  if (duplicate) {
    res.status(409).json({ success: false, error: 'This person already has this role for the given scope.' });
    return;
  }

  const now = new Date().toISOString();
  const role: StoredDamaRole = {
    id: uuid(),
    personId,
    roleType,
    scopeType,
    scopeId,
    since: now,
    createdAt: now,
  };
  damaRoles.push(role);
  saveStore('damaRoles', damaRoles);
  res.status(201).json({ success: true, data: { ...role, personName: person.name } });
});

/** DELETE /api/v1/dama-roles/:id — remove assignment */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = damaRoles.findIndex((r) => r.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'DAMA role assignment not found' }); return; }
  damaRoles.splice(idx, 1);
  saveStore('damaRoles', damaRoles);
  res.status(204).send();
});

/** GET /api/v1/dama-roles/by-person/:personId — all DAMA roles for a person */
router.get('/by-person/:personId', (req: Request, res: Response) => {
  const personId = req.params.personId;
  const person = people.find((p) => p.id === personId);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }

  const roles = damaRoles
    .filter((r) => r.personId === personId)
    .map((r) => ({ ...r, personName: person.name }));

  res.json({ success: true, data: roles });
});

/** GET /api/v1/dama-roles/summary — counts by role type */
router.get('/summary', (_req: Request, res: Response) => {
  const counts: Record<string, number> = {};
  for (const rt of DAMA_ROLE_TYPES) {
    counts[rt] = damaRoles.filter((r) => r.roleType === rt).length;
  }
  res.json({ success: true, data: counts, total: damaRoles.length });
});

export default router;
