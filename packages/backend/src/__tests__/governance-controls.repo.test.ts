// GovernanceControl repository — JSON + stubbed Prisma. Exercises
// the orphaned-control shape (policyId === '') and the boolean
// evidenceRequired round-trip.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGovernanceControlsRepository,
  prismaGovernanceControlsRepository,
  type PrismaGovernanceControlDelegate,
} from '../db/governance-controls.repo';
import type { StoredGovernanceControl } from '../routes/governance-controls';

const makeControl = (over: Partial<StoredGovernanceControl> = {}): StoredGovernanceControl => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  policyId: 'pol-1',
  code: 'CTL-001',
  name: 'Access review',
  description: '',
  controlType: 'DETECTIVE',
  automationMode: 'HUMAN',
  status: 'DRAFT',
  ownerAssignmentId: null,
  evidenceRequired: false,
  linkedDomainId: null,
  linkedSystemId: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonGovernanceControlsRepository', () => {
  let store: StoredGovernanceControl[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGovernanceControlsRepository(store);
    store.push(makeControl({ id: 'a', orgId: 'o1' }), makeControl({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('preserves orphaned-policy state (policyId = "") after policy delete cascade', async () => {
    const repo = jsonGovernanceControlsRepository(store);
    await repo.create(makeControl({ id: 'c1', policyId: '', evidenceRequired: true }));
    const got = await repo.get('c1');
    assert.strictEqual(got?.policyId, '');
    assert.strictEqual(got?.evidenceRequired, true);
  });
});

describe('prismaGovernanceControlsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaGovernanceControlDelegate> = {}): PrismaGovernanceControlDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps row → StoredGovernanceControl (linked FKs, dates → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'c1', orgId: 'o1', policyId: 'pol-1', code: 'CTL-002',
        name: 'Data quality check', description: 'body',
        controlType: 'PREVENTIVE', automationMode: 'AGENT', status: 'ACTIVE',
        ownerAssignmentId: 'p-1', evidenceRequired: true,
        linkedDomainId: 'd-1', linkedSystemId: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      }],
    });
    const repo = prismaGovernanceControlsRepository(() => ({ governanceControl: delegate }));
    const rows = await repo.list();
    const r = rows[0];
    assert.strictEqual(r.controlType, 'PREVENTIVE');
    assert.strictEqual(r.automationMode, 'AGENT');
    assert.strictEqual(r.evidenceRequired, true);
    assert.strictEqual(r.linkedDomainId, 'd-1');
    assert.strictEqual(r.linkedSystemId, null);
    assert.strictEqual(r.createdAt, '2026-07-15T00:00:00.000Z');
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaGovernanceControlsRepository(() => ({ governanceControl: delegate }));
    assert.strictEqual(await repo.update('gone', { status: 'ACTIVE' }), null);
  });
});
