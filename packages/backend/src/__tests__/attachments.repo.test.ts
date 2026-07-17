import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAttachmentsRepository,
  prismaAttachmentsRepository,
  type PrismaAttachmentDelegate,
} from '../db/attachments.repo';
import type { StoredAttachment } from '../routes/attachments';

const make = (over: Partial<StoredAttachment> = {}): StoredAttachment => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  entityType: 'ProcessNode',
  entityId: 'n1',
  type: 'URL',
  name: 'ref',
  description: '',
  uploadedBy: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAttachmentsRepository', () => {
  let store: StoredAttachment[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonAttachmentsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonAttachmentsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});

describe('prismaAttachmentsRepository', () => {
  function delegate(over: Partial<PrismaAttachmentDelegate> = {}): PrismaAttachmentDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps nulls to undefined/empty', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', entityType: 'ProcessNode', entityId: 'n1',
        type: 'URL', name: 'r', description: null,
        fileName: null, filePath: null, fileSize: null, mimeType: null,
        url: 'https://x', uploadedBy: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaAttachmentsRepository(() => ({ attachment: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].description, '');
    assert.strictEqual(rows[0].fileName, undefined);
    assert.strictEqual(rows[0].url, 'https://x');
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaAttachmentsRepository(() => ({ attachment: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
