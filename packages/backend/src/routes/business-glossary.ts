import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';
import { dataDomains } from './data-domains';

export interface StoredGlossaryTerm {
  id: string;
  orgId: string;
  term: string;
  definition: string;
  context: string;
  synonyms: string[];
  relatedTerms: string[];
  domainId: string | null;
  ownerPersonId: string | null;
  status: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'DEPRECATED';
  category: 'BUSINESS' | 'TECHNICAL' | 'REGULATORY' | 'METRIC' | 'GENERAL';
  exampleValues: string;
  businessRules: string;
  sourceOfTruth: string;
  createdAt: string;
  updatedAt: string;
}

export const glossaryTerms: StoredGlossaryTerm[] = loadStore<StoredGlossaryTerm>('glossaryTerms');

const VALID_STATUSES = ['DRAFT', 'PROPOSED', 'APPROVED', 'DEPRECATED'] as const;
const VALID_CATEGORIES = ['BUSINESS', 'TECHNICAL', 'REGULATORY', 'METRIC', 'GENERAL'] as const;

function enrichTerm(term: StoredGlossaryTerm) {
  const owner = term.ownerPersonId ? people.find((p) => p.id === term.ownerPersonId) : null;
  const domain = term.domainId ? dataDomains.find((d) => d.id === term.domainId) : null;
  return {
    ...term,
    ownerName: owner?.name || null,
    domainName: domain?.name || null,
  };
}

const SEED_TERMS = [
  { term: 'Data Asset', definition: 'A collection of data elements that has business value and is managed as a unit. Examples include a customer database, a financial report dataset, or an API feed.', category: 'BUSINESS' as const },
  { term: 'Data Domain', definition: 'A logical grouping of related data assets organized by business function. Domains define ownership boundaries and governance scope.', category: 'BUSINESS' as const },
  { term: 'Data Steward', definition: 'The person responsible for the day-to-day management, quality, and standards compliance of data within a domain or for specific data assets.', category: 'BUSINESS' as const },
  { term: 'Data Owner', definition: 'The business leader who is accountable for a data domain or asset. They set policy, approve access, and own outcomes. Stewards execute on their behalf.', category: 'BUSINESS' as const },
  { term: 'Data Quality', definition: 'The degree to which data meets the requirements of its intended use, measured across dimensions like accuracy, completeness, timeliness, consistency, and validity.', category: 'TECHNICAL' as const },
  { term: 'Governance Tier', definition: 'A maturity classification for data assets: Bronze (minimal governance), Silver (managed with defined ownership), Gold (fully governed, certified, audit-ready).', category: 'BUSINESS' as const },
  { term: 'Health Score', definition: 'A 0-100 composite rating of a data asset\'s quality, computed from weighted quality rule results across multiple dimensions.', category: 'METRIC' as const },
  { term: 'PII', definition: 'Personally Identifiable Information. Any data that can identify a specific individual, such as name, email, SSN, or phone number. Subject to privacy regulations.', category: 'REGULATORY' as const },
  { term: 'Data Classification', definition: 'A label indicating the sensitivity level of data: Public, Internal, Confidential, or Restricted. Determines handling requirements and access controls.', category: 'REGULATORY' as const },
  { term: 'Master Data', definition: 'The core business entities that are shared across multiple systems and processes — customers, products, employees, locations. Requires golden-record governance.', category: 'TECHNICAL' as const },
];

const router = Router();

/** GET /api/v1/business-glossary — list with filters */
router.get('/', (req: Request, res: Response) => {
  const { orgId, status, category, domainId, search } = req.query;
  let filtered = filterByOrgScope(glossaryTerms, orgId as string | undefined);

  if (status && typeof status === 'string') {
    filtered = filtered.filter((t) => t.status === status);
  }
  if (category && typeof category === 'string') {
    filtered = filtered.filter((t) => t.category === category);
  }
  if (domainId && typeof domainId === 'string') {
    filtered = filtered.filter((t) => t.domainId === domainId);
  }
  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    filtered = filtered.filter((t) =>
      t.term.toLowerCase().includes(q) ||
      t.definition.toLowerCase().includes(q) ||
      t.context.toLowerCase().includes(q) ||
      t.synonyms.some((s) => s.toLowerCase().includes(q)),
    );
  }

  const enriched = filtered.map(enrichTerm);
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/business-glossary/summary — aggregate stats */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(glossaryTerms, orgId as string | undefined);

  const total = filtered.length;
  const approved = filtered.filter((t) => t.status === 'APPROVED').length;
  const draft = filtered.filter((t) => t.status === 'DRAFT').length;
  const proposed = filtered.filter((t) => t.status === 'PROPOSED').length;
  const deprecated = filtered.filter((t) => t.status === 'DEPRECATED').length;

  const byCategory: Record<string, number> = {};
  const byDomain: Record<string, number> = {};

  for (const t of filtered) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    if (t.domainId) {
      byDomain[t.domainId] = (byDomain[t.domainId] || 0) + 1;
    }
  }

  res.json({
    success: true,
    data: { total, approved, draft, proposed, deprecated, byCategory, byDomain },
  });
});

/** GET /api/v1/business-glossary/:id — single term */
router.get('/:id', (req: Request, res: Response) => {
  const term = glossaryTerms.find((t) => t.id === req.params.id);
  if (!term) {
    res.status(404).json({ success: false, error: 'Glossary term not found' });
    return;
  }
  res.json({ success: true, data: enrichTerm(term) });
});

/** POST /api/v1/business-glossary — create */
router.post('/', (req: Request, res: Response) => {
  const {
    term, orgId, definition, context, synonyms, relatedTerms,
    domainId, ownerPersonId, status, category,
    exampleValues, businessRules, sourceOfTruth,
  } = req.body;

  if (!term || typeof term !== 'string') {
    res.status(400).json({ success: false, error: 'term is required' });
    return;
  }
  if (!orgId || typeof orgId !== 'string') {
    res.status(400).json({ success: false, error: 'orgId is required' });
    return;
  }

  const duplicate = glossaryTerms.find(
    (t) => t.orgId === orgId && t.term.trim().toLowerCase() === term.trim().toLowerCase(),
  );
  if (duplicate) {
    res.status(409).json({ success: false, error: `A glossary term "${term}" already exists in this organization` });
    return;
  }

  const now = new Date().toISOString();
  const newTerm: StoredGlossaryTerm = {
    id: uuid(),
    orgId,
    term: term.trim(),
    definition: definition || '',
    context: context || '',
    synonyms: Array.isArray(synonyms) ? synonyms : [],
    relatedTerms: Array.isArray(relatedTerms) ? relatedTerms : [],
    domainId: domainId || null,
    ownerPersonId: ownerPersonId || null,
    status: status && (VALID_STATUSES as readonly string[]).includes(status) ? status : 'DRAFT',
    category: category && (VALID_CATEGORIES as readonly string[]).includes(category) ? category : 'BUSINESS',
    exampleValues: exampleValues || '',
    businessRules: businessRules || '',
    sourceOfTruth: sourceOfTruth || '',
    createdAt: now,
    updatedAt: now,
  };

  glossaryTerms.push(newTerm);
  saveStore('glossaryTerms', glossaryTerms);
  auditService.log('system', orgId, 'GlossaryTerm', newTerm.id, 'CREATE', null, newTerm);
  logger.info({ id: newTerm.id, term: newTerm.term }, 'Created glossary term');
  res.status(201).json({ success: true, data: enrichTerm(newTerm) });
});

/** PUT /api/v1/business-glossary/:id — update */
router.put('/:id', (req: Request, res: Response) => {
  const existing = glossaryTerms.find((t) => t.id === req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Glossary term not found' });
    return;
  }

  const before = { ...existing };
  const {
    term, definition, context, synonyms, relatedTerms,
    domainId, ownerPersonId, status, category,
    exampleValues, businessRules, sourceOfTruth,
  } = req.body;

  if (term !== undefined) existing.term = term;
  if (definition !== undefined) existing.definition = definition;
  if (context !== undefined) existing.context = context;
  if (synonyms !== undefined && Array.isArray(synonyms)) existing.synonyms = synonyms;
  if (relatedTerms !== undefined && Array.isArray(relatedTerms)) existing.relatedTerms = relatedTerms;
  if (domainId !== undefined) existing.domainId = domainId || null;
  if (ownerPersonId !== undefined) existing.ownerPersonId = ownerPersonId || null;
  if (status !== undefined && (VALID_STATUSES as readonly string[]).includes(status)) existing.status = status;
  if (category !== undefined && (VALID_CATEGORIES as readonly string[]).includes(category)) existing.category = category;
  if (exampleValues !== undefined) existing.exampleValues = exampleValues;
  if (businessRules !== undefined) existing.businessRules = businessRules;
  if (sourceOfTruth !== undefined) existing.sourceOfTruth = sourceOfTruth;

  existing.updatedAt = new Date().toISOString();
  saveStore('glossaryTerms', glossaryTerms);
  auditService.log('system', existing.orgId, 'GlossaryTerm', existing.id, 'UPDATE', before, existing);
  logger.info({ id: existing.id, term: existing.term }, 'Updated glossary term');
  res.json({ success: true, data: enrichTerm(existing) });
});

/** DELETE /api/v1/business-glossary/:id — delete */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = glossaryTerms.findIndex((t) => t.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Glossary term not found' });
    return;
  }
  const removed = glossaryTerms.splice(idx, 1)[0];
  saveStore('glossaryTerms', glossaryTerms);
  auditService.log('system', removed.orgId, 'GlossaryTerm', removed.id, 'DELETE', removed, null);
  logger.info({ id: removed.id, term: removed.term }, 'Deleted glossary term');
  res.status(204).send();
});

/** POST /api/v1/business-glossary/seed — create starter terms for an org */
router.post('/seed', (req: Request, res: Response) => {
  const { orgId } = req.body;
  if (!orgId || typeof orgId !== 'string') {
    res.status(400).json({ success: false, error: 'orgId is required' });
    return;
  }

  const now = new Date().toISOString();
  const created: StoredGlossaryTerm[] = [];

  for (const seed of SEED_TERMS) {
    const exists = glossaryTerms.find(
      (t) => t.orgId === orgId && t.term.trim().toLowerCase() === seed.term.trim().toLowerCase(),
    );
    if (exists) continue;

    const newTerm: StoredGlossaryTerm = {
      id: uuid(),
      orgId,
      term: seed.term,
      definition: seed.definition,
      context: '',
      synonyms: [],
      relatedTerms: [],
      domainId: null,
      ownerPersonId: null,
      status: 'DRAFT',
      category: seed.category,
      exampleValues: '',
      businessRules: '',
      sourceOfTruth: '',
      createdAt: now,
      updatedAt: now,
    };

    glossaryTerms.push(newTerm);
    created.push(newTerm);
  }

  if (created.length > 0) {
    saveStore('glossaryTerms', glossaryTerms);
    auditService.log('system', orgId, 'GlossaryTerm', '*', 'SEED', null, { count: created.length });
    logger.info({ orgId, count: created.length }, 'Seeded glossary terms');
  }

  res.status(201).json({ success: true, data: created.map(enrichTerm), seeded: created.length });
});

export default router;
