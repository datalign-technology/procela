import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGlossaryTermsRepository,
  prismaGlossaryTermsRepository,
  type PrismaGlossaryTermDelegate,
} from '../db/glossary-terms.repo';
import type { StoredGlossaryTerm } from '../routes/business-glossary';

const make = (over: Partial<StoredGlossaryTerm> = {}): StoredGlossaryTerm => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  term: 'Data Asset',
  definition: '',
  context: '',
  synonyms: [],
  domainId: null,
  ownerPersonId: null,
  status: 'DRAFT',
  category: 'GENERAL',
  exampleValues: '',
  businessRules: '',
  sourceOfTruth: '',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonGlossaryTermsRepository', () => {
  let store: StoredGlossaryTerm[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGlossaryTermsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonGlossaryTermsRepository(store);
    assert.strictEqual(await repo.update('gone', { term: 'x' }), null);
  });
});

describe('prismaGlossaryTermsRepository', () => {
  function delegate(over: Partial<PrismaGlossaryTermDelegate> = {}): PrismaGlossaryTermDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps prisma row → StoredGlossaryTerm, nulls preserved', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', term: 'X', definition: '', context: '',
        synonyms: ['x'], domainId: null, ownerPersonId: null,
        status: 'DRAFT', category: 'GENERAL',
        exampleValues: '', businessRules: '', sourceOfTruth: '',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaGlossaryTermsRepository(() => ({ glossaryTerm: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].domainId, null);
    assert.deepStrictEqual(rows[0].synonyms, ['x']);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaGlossaryTermsRepository(() => ({ glossaryTerm: d }));
    assert.strictEqual(await repo.update('gone', { term: 'x' }), null);
  });
});
