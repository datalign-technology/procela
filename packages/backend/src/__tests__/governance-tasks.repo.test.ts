// GovernanceTask repository — JSON + stubbed Prisma. Exercises the
// extended status vocabulary (DRAFT / PENDING_REVIEW / CANCELLED
// aren't in the base TaskStatus enum) and the overdueNotifiedAt
// optional round-trip.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGovernanceTasksRepository,
  prismaGovernanceTasksRepository,
  type PrismaGovernanceTaskDelegate,
} from '../db/governance-tasks.repo';
import type { StoredGovernanceTask } from '../routes/governance-tasks';

const makeTask = (over: Partial<StoredGovernanceTask> = {}): StoredGovernanceTask => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  title: 'Review meter data',
  description: '',
  taskType: 'GENERAL',
  status: 'OPEN',
  priority: 'MEDIUM',
  automationMode: 'HUMAN',
  assigneeId: null,
  dueDate: null,
  linkedObjectType: null,
  linkedObjectId: null,
  createdBy: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  completedAt: null,
  ...over,
});

describe('jsonGovernanceTasksRepository', () => {
  let store: StoredGovernanceTask[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGovernanceTasksRepository(store);
    store.push(makeTask({ id: 'a', orgId: 'o1' }), makeTask({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('round-trips extended-vocabulary statuses (CANCELLED / PENDING_REVIEW)', async () => {
    const repo = jsonGovernanceTasksRepository(store);
    await repo.create(makeTask({ id: 't1', status: 'CANCELLED' }));
    await repo.create(makeTask({ id: 't2', status: 'PENDING_REVIEW' }));
    assert.strictEqual((await repo.get('t1'))?.status, 'CANCELLED');
    assert.strictEqual((await repo.get('t2'))?.status, 'PENDING_REVIEW');
  });
});

describe('prismaGovernanceTasksRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaGovernanceTaskDelegate> = {}): PrismaGovernanceTaskDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps full row → StoredGovernanceTask (dates → ISO, overdueNotifiedAt included when set)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 't1', orgId: 'o1', title: 'Overdue check', description: 'body',
        taskType: 'STEWARDSHIP', status: 'IN_PROGRESS', priority: 'HIGH',
        automationMode: 'HYBRID', assigneeId: 'p-1',
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        linkedObjectType: 'DamaRole', linkedObjectId: 'role-1',
        createdBy: 'p-admin',
        completedAt: null,
        overdueNotifiedAt: new Date('2026-07-15T12:00:00.000Z'),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      }],
    });
    const repo = prismaGovernanceTasksRepository(() => ({ governanceTask: delegate }));
    const rows = await repo.list();
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.status, 'IN_PROGRESS');
    assert.strictEqual(r.taskType, 'STEWARDSHIP');
    assert.strictEqual(r.automationMode, 'HYBRID');
    assert.strictEqual(r.linkedObjectId, 'role-1');
    assert.strictEqual(r.dueDate, '2026-07-10T00:00:00.000Z');
    assert.strictEqual(r.overdueNotifiedAt, '2026-07-15T12:00:00.000Z');
    assert.strictEqual(r.completedAt, null);
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaGovernanceTasksRepository(() => ({ governanceTask: delegate }));
    assert.strictEqual(await repo.update('gone', { status: 'COMPLETED' }), null);
  });
});
