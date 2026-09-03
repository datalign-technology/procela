import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { requireAiEnabled } from '../middleware/ai-enabled';
import { filterByOrgScope } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';
import { aiService } from '../services/ai.service';
import { getBusinessCapabilitiesRepository } from '../db/business-capabilities.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { hasDatabase } from '../db/prisma';

// Business Capability — the grouping level ABOVE Data Domain, completing the
// canonical taxonomy Business Capability → Data Domain → Sub-Domain → Entity.
// A capability gathers related data domains under one accountable owner. It is
// a data-side concept, distinct from the CAPABILITY level in the process tree.
export interface StoredBusinessCapability {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;       // personId of the accountable owner
  // Reverse of DataDomain.businessCapabilityId — the domains grouped under this
  // capability. The DataDomain side owns the FK; this array mirrors the JSON
  // store and is recomputed from the domain list, never written from here.
  dataDomainIds: string[];
  // Human-readable code (e.g. "CUST"). Auto-suggested on create; editable.
  code?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const businessCapabilities: StoredBusinessCapability[] = loadStore<StoredBusinessCapability>('businessCapabilities');
registerStore('businessCapabilities', businessCapabilities);

const capabilitiesRepo = getBusinessCapabilitiesRepository(businessCapabilities);

// Lazy repos to dodge the value-import cycle (data-domains value-imports this
// module for its capability lookups, and this module needs the domain list for
// enrichment). By the time a handler runs, both modules are initialised.
let _peopleRepo: ReturnType<typeof getPeopleRepository> | null = null;
const peopleRepo = () => (_peopleRepo ??= getPeopleRepository(people));
let _domainsRepo: ReturnType<typeof getDataDomainsRepository> | null = null;
const domainsRepo = () => {
  if (_domainsRepo) return _domainsRepo;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dataDomains } = require('./data-domains') as { dataDomains: unknown[] };
  return (_domainsRepo = getDataDomainsRepository(dataDomains as never));
};

const VALID_STATUSES = ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'];
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['DRAFT', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};

// Derive a short code from a capability name — initials for ≥2 significant
// words (dropping filler), else the first three letters; deduped with a suffix.
function suggestCapabilityCode(name: string, existing: Set<string>): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .filter((w) => !['data', 'and', 'of', 'the', 'management'].includes(w.toLowerCase()));
  let base = 'CAP';
  if (words.length >= 2) base = words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  else if (words.length === 1) base = words[0].slice(0, 3).toUpperCase();
  let code = base;
  let i = 1;
  while (existing.has(code)) { code = `${base}${i++}`; }
  return code;
}

function enrichCapability(
  cap: StoredBusinessCapability,
  allPeople: typeof people,
  allDomains: Array<{ id: string; name: string; businessCapabilityId?: string | null }>,
) {
  const owner = cap.ownerId ? allPeople.find((p) => p.id === cap.ownerId) : null;
  const domains = allDomains
    .filter((d) => d.businessCapabilityId === cap.id)
    .map((d) => ({ id: d.id, name: d.name }));
  return {
    ...cap,
    ownerName: owner?.name || null,
    domains,
    domainCount: domains.length,
  };
}

const router = Router();

/**
 * POST /api/v1/business-capabilities/generate
 * Suggests business capabilities for an industry (preview only — the frontend
 * shows the list and the user picks which to keep).
 */
router.post('/generate', requireAiEnabled, async (req: Request, res: Response) => {
  const { industry } = req.body || {};
  if (!industry || typeof industry !== 'string') {
    res.status(400).json({ success: false, error: 'industry is required' });
    return;
  }
  try {
    const suggestions = await aiService.generateBusinessCapabilities(industry);
    let caps: Array<unknown> = [];
    if (Array.isArray(suggestions)) {
      caps = suggestions;
    } else if (suggestions && typeof suggestions === 'object') {
      for (const v of Object.values(suggestions as Record<string, unknown>)) {
        if (Array.isArray(v)) { caps = v; break; }
      }
    }
    if (caps.length === 0) {
      logger.warn({ industry, suggestions }, 'Business-capability generation returned no array');
      res.status(502).json({
        success: false,
        error: 'The AI response did not contain a list of capabilities. Try again — Claude occasionally returns prose; a retry usually fixes it.',
      });
      return;
    }
    res.json({ success: true, data: caps });
  } catch (err: any) {
    const message = err?.message || 'AI generation failed';
    const raw = err?.rawResponse as string | undefined;
    logger.error({ err, industry, raw }, 'Business-capability generation failed');
    res.status(500).json({ success: false, error: message, ...(raw ? { rawSnippet: raw.slice(0, 300) } : {}) });
  }
});

/** DELETE /api/v1/business-capabilities/all */
router.delete('/all', async (_req: Request, res: Response) => {
  const all = await capabilitiesRepo.list();
  const count = all.length;
  for (const c of all) await capabilitiesRepo.delete(c.id);
  auditService.log('system', null, 'BusinessCapability', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all business capabilities');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/business-capabilities — list (supports ?orgId=) */
router.get('/', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const [allCaps, allPeople, allDomains] = await Promise.all([
    capabilitiesRepo.list(),
    peopleRepo().list(),
    domainsRepo().list(),
  ]);
  const filtered = filterByOrgScope(allCaps, orgId as string | undefined);
  const enriched = filtered.map((c) => enrichCapability(c, allPeople, allDomains as never));
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/business-capabilities/:id */
router.get('/:id', async (req: Request, res: Response) => {
  const cap = await capabilitiesRepo.get(String(req.params.id));
  if (!cap) { res.status(404).json({ success: false, error: 'Business capability not found' }); return; }
  const [allPeople, allDomains] = await Promise.all([peopleRepo().list(), domainsRepo().list()]);
  res.json({ success: true, data: enrichCapability(cap, allPeople, allDomains as never) });
});

/** POST /api/v1/business-capabilities — create */
router.post('/', async (req: Request, res: Response) => {
  const { name, description, orgId, status } = req.body || {};
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }

  const allCaps = await capabilitiesRepo.list();
  const duplicate = allCaps.find(
    (c) => c.orgId === orgId && c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (duplicate) {
    res.status(409).json({ success: false, error: `A business capability named "${name}" already exists in this organization` });
    return;
  }

  const existingCodes = new Set(allCaps.filter((c) => c.orgId === orgId).map((c) => (c.code || '').toUpperCase()).filter(Boolean));
  const code = (typeof req.body?.code === 'string' && req.body.code.trim())
    ? req.body.code.trim()
    : suggestCapabilityCode(name, existingCodes);

  const now = new Date().toISOString();
  const cap: StoredBusinessCapability = {
    id: uuid(),
    orgId,
    name,
    description: (description || '').trim(),
    ownerId: null,
    dataDomainIds: [],
    code,
    status: status && VALID_STATUSES.includes(status) ? status : 'DRAFT',
    createdAt: now,
    updatedAt: now,
  };
  await capabilitiesRepo.create(cap);
  auditService.log('system', null, 'BusinessCapability', cap.id, 'CREATE', null, { name: cap.name });
  const [allPeople, allDomains] = await Promise.all([peopleRepo().list(), domainsRepo().list()]);
  res.status(201).json({ success: true, data: enrichCapability(cap, allPeople, allDomains as never) });
});

/** PUT /api/v1/business-capabilities/:id — update */
router.put('/:id', async (req: Request, res: Response) => {
  const cap = await capabilitiesRepo.get(String(req.params.id));
  if (!cap) { res.status(404).json({ success: false, error: 'Business capability not found' }); return; }

  const { name, description, ownerId, status } = req.body || {};
  if (name !== undefined) cap.name = name;
  if (description !== undefined) cap.description = (description || '').trim();
  if (ownerId !== undefined) cap.ownerId = ownerId || null;
  if (req.body?.code !== undefined) {
    cap.code = typeof req.body.code === 'string' && req.body.code.trim() ? req.body.code.trim() : undefined;
  }

  if (status !== undefined && status !== cap.status) {
    const allowed = SIMPLE_TRANSITIONS[cap.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        success: false,
        error: `Cannot transition from ${cap.status.replace('_', ' ')} to ${status.replace('_', ' ')}. Valid transitions: ${allowed.map((s) => s.replace('_', ' ')).join(', ') || 'none'}.`,
      });
      return;
    }
    cap.status = status;
  }

  cap.updatedAt = new Date().toISOString();
  await capabilitiesRepo.update(cap.id, cap);
  const [allPeople, allDomains] = await Promise.all([peopleRepo().list(), domainsRepo().list()]);
  res.json({ success: true, data: enrichCapability(cap, allPeople, allDomains as never) });
});

/** GET /api/v1/business-capabilities/:id/impact — preview a delete */
router.get('/:id/impact', async (req: Request, res: Response) => {
  const cap = await capabilitiesRepo.get(String(req.params.id));
  if (!cap) { res.status(404).json({ success: false, error: 'Business capability not found' }); return; }
  const domainNames = ((await domainsRepo().list()) as Array<{ businessCapabilityId?: string | null; name: string }>)
    .filter((d) => d.businessCapabilityId === cap.id)
    .map((d) => d.name);
  res.json({ success: true, data: { domains: domainNames.length, domainNames } });
});

/** DELETE /api/v1/business-capabilities/:id — un-groups its domains, then deletes */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = await capabilitiesRepo.get(String(req.params.id));
  if (!removed) { res.status(404).json({ success: false, error: 'Business capability not found' }); return; }
  // Re-home grouped domains to ungrouped before deleting. In Postgres the FK's
  // onDelete:SetNull handles this; the JSON store has no cascade, so do it
  // explicitly so both backends behave the same.
  const repo = domainsRepo();
  const domains = (await repo.list()) as Array<{ id: string; businessCapabilityId?: string | null; updatedAt: string }>;
  for (const d of domains.filter((x) => x.businessCapabilityId === removed.id)) {
    d.businessCapabilityId = null;
    d.updatedAt = new Date().toISOString();
    await repo.update(d.id, d as never);
  }
  await capabilitiesRepo.delete(removed.id);
  auditService.log('system', null, 'BusinessCapability', removed.id, 'DELETE', { name: removed.name }, null);
  res.status(204).send();
});

// JSON-mode legacy-status normalisation, mirroring data-domains.
if (!hasDatabase()) {
  const legacy = new Set(['PROPOSED', 'UNDER_REVIEW', 'APPROVED']);
  let migrated = 0;
  for (const c of businessCapabilities) {
    if (legacy.has(c.status)) { c.status = 'DRAFT'; migrated++; }
  }
  if (migrated > 0) saveStore('businessCapabilities', businessCapabilities);
}

export default router;
