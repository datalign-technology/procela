// AuditLog repository — JSON adapter + stubbed Prisma path. Special
// attention to hash-chain integrity: prevHash / entryHash must round-
// trip byte-for-byte since auditService.verifyChain() re-hashes and
// compares. Any silent mutation on the storage layer would invalidate
// the chain after a single write cycle.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAuditLogsRepository,
  prismaAuditLogsRepository,
  type PrismaAuditDelegate,
} from '../db/audit-logs.repo';
import type { AuditLogEntry } from '../services/audit.service';

const makeEntry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  userId: null,
  entityType: 'Person',
  entityId: 'p1',
  action: 'CREATE',
  before: null,
  after: null,
  timestamp: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAuditLogsRepository', () => {
  let store: AuditLogEntry[];

  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonAuditLogsRepository(store);
    store.push(
      makeEntry({ id: 'a', orgId: 'o1' }),
      makeEntry({ id: 'b', orgId: 'o2' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'a');
  });

  it('round-trips hash-chain fields (prevHash + entryHash preserved byte-for-byte)', async () => {
    const repo = jsonAuditLogsRepository(store);
    const entryHash = 'a'.repeat(64); // fake 64-char sha256 hex
    const prevHash = 'b'.repeat(64);
    await repo.create(makeEntry({ id: 'e1', prevHash, entryHash }));
    const round = await repo.get('e1');
    assert.strictEqual(round?.prevHash, prevHash);
    assert.strictEqual(round?.entryHash, entryHash);
  });

  it('preserves sentinel orgId "system" (used by bootstrap chain marker)', async () => {
    const repo = jsonAuditLogsRepository(store);
    await repo.create(makeEntry({
      id: 'marker', orgId: 'system', entityType: 'Audit', entityId: 'chain',
      action: 'AUDIT_CHAIN_BOOTSTRAPPED',
    }));
    const round = await repo.get('marker');
    assert.strictEqual(round?.orgId, 'system');
    assert.strictEqual(round?.entityId, 'chain');
  });
});

describe('prismaAuditLogsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaAuditDelegate> = {}): PrismaAuditDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list applies orgId filter + orders by timestamp ascending (chain walk order)', async () => {
    const captured: { arg?: unknown } = {};
    const delegate = makeDelegate({
      findMany: async (arg) => { captured.arg = arg; return []; },
    });
    const repo = prismaAuditLogsRepository(() => ({ auditLog: delegate }));
    await repo.list({ orgId: 'o1' });
    const arg = captured.arg as { where?: { orgId?: string }; orderBy?: { timestamp?: string } };
    assert.strictEqual(arg.where?.orgId, 'o1');
    assert.strictEqual(arg.orderBy?.timestamp, 'asc');
  });

  it('list maps Prisma row → AuditLogEntry (hash fields, JSONB before/after, dates → ISO)', async () => {
    const before = { role: 'VIEWER' };
    const after = { role: 'PROCESS_OWNER' };
    const entryHash = 'e'.repeat(64);
    const prevHash = 'p'.repeat(64);
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'e1', orgId: 'o1', userId: 'u-admin',
        entityType: 'Person', entityId: 'p-1', action: 'UPDATE',
        before, after,
        timestamp: new Date('2026-07-15T12:00:00.000Z'),
        prevHash, entryHash,
      }],
    });
    const repo = prismaAuditLogsRepository(() => ({ auditLog: delegate }));
    const rows = await repo.list();
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.deepStrictEqual(r.before, before);
    assert.deepStrictEqual(r.after, after);
    assert.strictEqual(r.prevHash, prevHash);
    assert.strictEqual(r.entryHash, entryHash);
    assert.strictEqual(r.timestamp, '2026-07-15T12:00:00.000Z');
    assert.strictEqual(r.userId, 'u-admin');
  });

  it('create forwards prevHash + entryHash to Prisma verbatim (application computes them)', async () => {
    let createArg: unknown = null;
    const entryHash = 'x'.repeat(64);
    const prevHash = 'y'.repeat(64);
    const delegate = makeDelegate({
      create: async (arg) => {
        createArg = arg;
        return {
          id: 'e1', orgId: 'o1', userId: null,
          entityType: 'Person', entityId: 'p-1', action: 'CREATE',
          before: null, after: null,
          timestamp: new Date(), prevHash, entryHash,
        };
      },
    });
    const repo = prismaAuditLogsRepository(() => ({ auditLog: delegate }));
    await repo.create(makeEntry({ id: 'e1', prevHash, entryHash }));
    const data = (createArg as { data: Record<string, unknown> }).data;
    assert.strictEqual(data.prevHash, prevHash);
    assert.strictEqual(data.entryHash, entryHash);
  });

  it('update passes through to Prisma (GDPR redact-pass usage) — returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaAuditLogsRepository(() => ({ auditLog: delegate }));
    assert.strictEqual(await repo.update('gone', { userId: '[deleted]' }), null);
  });
});
