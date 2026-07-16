// GovernanceIssue repository — JSON + stubbed Prisma. Exercises the
// extended severity vocabulary (CRITICAL isn't in the base
// IssueSeverity enum) and the linkedRuleId auto-sync back-reference.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGovernanceIssuesRepository,
  prismaGovernanceIssuesRepository,
  type PrismaGovernanceIssueDelegate,
} from '../db/governance-issues.repo';
import type { StoredGovernanceIssue } from '../routes/governance-issues';

const makeIssue = (over: Partial<StoredGovernanceIssue> = {}): StoredGovernanceIssue => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  title: 'Meter data gap',
  description: '',
  issueType: 'METADATA',
  severity: 'MEDIUM',
  status: 'OPEN',
  domainId: null,
  dataAssetId: null,
  systemId: null,
  reportedBy: null,
  assignedTo: null,
  resolutionSummary: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  closedAt: null,
  ...over,
});

describe('jsonGovernanceIssuesRepository', () => {
  let store: StoredGovernanceIssue[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGovernanceIssuesRepository(store);
    store.push(makeIssue({ id: 'a', orgId: 'o1' }), makeIssue({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('round-trips linkedRuleId back-reference + CRITICAL severity', async () => {
    const repo = jsonGovernanceIssuesRepository(store);
    await repo.create(makeIssue({ id: 'i1', severity: 'CRITICAL', linkedRuleId: 'rule-1' }));
    const got = await repo.get('i1');
    assert.strictEqual(got?.severity, 'CRITICAL');
    assert.strictEqual(got?.linkedRuleId, 'rule-1');
  });
});

describe('prismaGovernanceIssuesRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaGovernanceIssueDelegate> = {}): PrismaGovernanceIssueDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps row → StoredGovernanceIssue (nulls, dates, linked back-refs)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'i1', orgId: 'o1', title: 'DQ failing', description: 'body',
        issueType: 'DATA_QUALITY', severity: 'HIGH', status: 'OPEN',
        domainId: 'd-1', dataAssetId: 'a-1', systemId: null,
        reportedBy: null, assignedTo: 'p-1', resolutionSummary: null,
        closedAt: null, linkedRuleId: 'rule-1', linkedAgentId: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      }],
    });
    const repo = prismaGovernanceIssuesRepository(() => ({ governanceIssue: delegate }));
    const rows = await repo.list();
    const r = rows[0];
    assert.strictEqual(r.severity, 'HIGH');
    assert.strictEqual(r.domainId, 'd-1');
    assert.strictEqual(r.assignedTo, 'p-1');
    assert.strictEqual(r.linkedRuleId, 'rule-1');
    assert.strictEqual(r.linkedAgentId, undefined); // null → dropped
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
    const repo = prismaGovernanceIssuesRepository(() => ({ governanceIssue: delegate }));
    assert.strictEqual(await repo.update('gone', { status: 'RESOLVED' }), null);
  });
});
