import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import { auditService, auditLogs, type AuditLogEntry } from '../services/audit.service';
import { useStoreIsolation } from './_helpers/store-isolation';

// Hash-chain integrity. Every entry the service writes carries a
// prevHash + entryHash, and verifyChain() walks the list confirming
// none have been tampered with, reordered, inserted, or deleted.

const ORG = 'test-org-1';

describe('audit.service — hash chain', () => {
  useStoreIsolation({ file: 'auditLogs', memory: auditLogs });

  describe('log()', () => {
    it('writes an entry with prevHash="" and a fresh entryHash on the first call', () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      assert.strictEqual(auditLogs.length, 1);
      const e = auditLogs[0];
      assert.strictEqual(e.prevHash, '');
      assert.ok(e.entryHash && e.entryHash.length === 64, 'entryHash should be SHA-256 hex (64 chars)');
    });

    it('chains entryHash from one entry to the next', () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'UPDATE');
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'DELETE');
      for (let i = 1; i < auditLogs.length; i++) {
        assert.strictEqual(auditLogs[i].prevHash, auditLogs[i - 1].entryHash,
          `prevHash mismatch at index ${i}`);
      }
    });

    it('produces a different entryHash for entries with different content', () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'user-1', 'Person', 'p2', 'CREATE');
      assert.notStrictEqual(auditLogs[0].entryHash, auditLogs[1].entryHash);
    });
  });

  describe('verifyChain()', () => {
    it('reports valid on an empty log', async () => {
      const result = await auditService.verifyChain();
      assert.deepStrictEqual(result, { valid: true, brokenAt: -1, total: 0 });
    });

    it('reports valid on a freshly written chain', async () => {
      for (let i = 0; i < 5; i++) {
        auditService.log(ORG, 'user-1', 'Person', `p${i}`, 'CREATE');
      }
      const result = await auditService.verifyChain();
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.brokenAt, -1);
      assert.strictEqual(result.total, 5);
    });

    it('detects content tampering — flipping action on one entry', async () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'UPDATE');
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'DELETE');

      // Sneak in and edit the middle entry without re-hashing.
      auditLogs[1].action = 'CREATE_FRAUD';

      const result = await auditService.verifyChain();
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.brokenAt, 1);
      assert.ok(result.reason && /tampered/i.test(result.reason));
    });

    it('detects deletion of a middle entry', async () => {
      for (let i = 0; i < 4; i++) {
        auditService.log(ORG, 'user-1', 'Person', `p${i}`, 'CREATE');
      }
      // Snip out the second entry. The third entry's prevHash now
      // refers to the deleted entry's hash, not the entry before it.
      auditLogs.splice(1, 1);

      const result = await auditService.verifyChain();
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.brokenAt, 1);
    });

    it('detects insertion of an unchained entry', async () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'UPDATE');

      // Insert a fully-formed-looking entry with no prevHash.
      const inserted: AuditLogEntry = {
        id: 'fake-1',
        orgId: ORG, userId: 'attacker',
        entityType: 'Person', entityId: 'p1',
        action: 'INJECTED', before: null, after: null,
        timestamp: new Date().toISOString(),
        prevHash: '',
        entryHash: 'deadbeef'.repeat(8),
      };
      auditLogs.splice(1, 0, inserted);

      const result = await auditService.verifyChain();
      assert.strictEqual(result.valid, false);
      assert.ok(result.brokenAt === 1 || result.brokenAt === 2);
    });

    it('detects an entry missing its entryHash', async () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      auditLogs[0].entryHash = undefined;

      const result = await auditService.verifyChain();
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.brokenAt, 0);
    });
  });

  describe('redactPerson()', () => {
    it('replaces userId with [deleted] and re-chains hashes', async () => {
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'attacker', 'Person', 'p1', 'UPDATE');
      auditService.log(ORG, 'user-1', 'Person', 'p1', 'DELETE');

      // Sanity: original log verifies clean.
      assert.strictEqual((await auditService.verifyChain()).valid, true);

      const rehashed = await auditService.redactPerson('attacker');
      assert.ok(rehashed >= 1, `expected redactPerson to touch >= 1 entry, got ${rehashed}`);

      // The middle entry's userId now reads [deleted].
      assert.strictEqual(auditLogs[1].userId, '[deleted]');
      // Chain still verifies after the in-place rehash.
      const result = await auditService.verifyChain();
      assert.strictEqual(result.valid, true,
        `chain should remain valid after redaction; reason: ${result.reason}`);
    });

    it('scrubs PII fields out of before / after payloads', async () => {
      auditService.log(ORG, 'u1', 'Person', 'p1', 'CREATE', null, {
        email: 'leak@example.com', name: 'Leak Name', other: 'kept',
      });
      await auditService.redactPerson('u1');

      const after = auditLogs[0].after as Record<string, unknown>;
      assert.strictEqual(after.email, '[redacted]');
      assert.strictEqual(after.name, '[redacted]');
      assert.strictEqual(after.other, 'kept');
    });

    it('returns 0 when no entries reference the person', async () => {
      auditService.log(ORG, 'u1', 'Person', 'p1', 'CREATE');
      const rehashed = await auditService.redactPerson('does-not-exist');
      assert.strictEqual(rehashed, 0);
    });

    it('leaves untouched entries (before the first modified index) bit-identical', async () => {
      auditService.log(ORG, 'u1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'u1', 'Person', 'p1', 'UPDATE');
      auditService.log(ORG, 'TARGET', 'Person', 'p1', 'DELETE');
      auditService.log(ORG, 'u1', 'Person', 'p1', 'NOTE');

      const hashesBefore = auditLogs.slice(0, 2).map((e) => e.entryHash);
      await auditService.redactPerson('TARGET');
      const hashesAfter = auditLogs.slice(0, 2).map((e) => e.entryHash);
      assert.deepStrictEqual(hashesAfter, hashesBefore,
        'entries before the first redacted index should be untouched');
    });
  });

  describe('getByEntity()', () => {
    it('returns only entries matching the (entityType, entityId) pair', async () => {
      auditService.log(ORG, 'u1', 'Person', 'p1', 'CREATE');
      auditService.log(ORG, 'u1', 'System', 's1', 'CREATE');
      auditService.log(ORG, 'u1', 'Person', 'p2', 'CREATE');
      auditService.log(ORG, 'u1', 'Person', 'p1', 'UPDATE');

      const hits = await auditService.getByEntity('Person', 'p1');
      assert.strictEqual(hits.length, 2);
      assert.ok(hits.every((h) => h.entityType === 'Person' && h.entityId === 'p1'));
    });
  });
});
