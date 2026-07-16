// GovernancePolicy repository — JSON + stubbed Prisma. Exercises the
// documentType discriminator (CHARTER / FRAMEWORK / STANDARD /
// POLICY), review-frequency vocabulary, and date-string round-trip
// (stored as String? not DateTime? — see schema comment).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGovernancePoliciesRepository,
  prismaGovernancePoliciesRepository,
  type PrismaGovernancePolicyDelegate,
} from '../db/governance-policies.repo';
import type { StoredGovernancePolicy } from '../routes/governance-policies';

const makePolicy = (over: Partial<StoredGovernancePolicy> = {}): StoredGovernancePolicy => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  code: 'POL-001',
  name: 'Access policy',
  description: '',
  documentType: 'POLICY',
  status: 'DRAFT',
  ownerAssignmentId: null,
  category: 'GENERAL',
  reviewFrequency: 'ANNUAL',
  lastReviewDate: null,
  nextReviewDate: null,
  effectiveDate: null,
  content: '',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonGovernancePoliciesRepository', () => {
  let store: StoredGovernancePolicy[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGovernancePoliciesRepository(store);
    store.push(makePolicy({ id: 'a', orgId: 'o1' }), makePolicy({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('round-trips documentType + date-strings for CHARTER row', async () => {
    const repo = jsonGovernancePoliciesRepository(store);
    await repo.create(makePolicy({
      id: 'p1', code: 'CHA-002', documentType: 'CHARTER',
      lastReviewDate: '2026-01-01', nextReviewDate: '2027-01-01',
      effectiveDate: '2026-01-15',
    }));
    const got = await repo.get('p1');
    assert.strictEqual(got?.documentType, 'CHARTER');
    assert.strictEqual(got?.lastReviewDate, '2026-01-01');
    assert.strictEqual(got?.effectiveDate, '2026-01-15');
  });
});

describe('prismaGovernancePoliciesRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaGovernancePolicyDelegate> = {}): PrismaGovernancePolicyDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps row → StoredGovernancePolicy (date-strings pass through, dates → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'p1', orgId: 'o1', code: 'STD-003', name: 'Naming standard',
        description: 'body', documentType: 'STANDARD', status: 'ACTIVE',
        ownerAssignmentId: 'p-1', category: 'GOVERNANCE',
        reviewFrequency: 'QUARTERLY',
        lastReviewDate: '2026-04-01', nextReviewDate: '2026-07-01',
        effectiveDate: '2026-01-01', content: 'body body',
        createdAt: new Date('2025-12-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      }],
    });
    const repo = prismaGovernancePoliciesRepository(() => ({ governancePolicy: delegate }));
    const rows = await repo.list();
    const r = rows[0];
    assert.strictEqual(r.documentType, 'STANDARD');
    assert.strictEqual(r.status, 'ACTIVE');
    assert.strictEqual(r.reviewFrequency, 'QUARTERLY');
    assert.strictEqual(r.lastReviewDate, '2026-04-01');
    assert.strictEqual(r.createdAt, '2025-12-01T00:00:00.000Z');
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaGovernancePoliciesRepository(() => ({ governancePolicy: delegate }));
    assert.strictEqual(await repo.update('gone', { status: 'DEPRECATED' }), null);
  });
});
