// Layer-2 (per-record "assigned" scoping) wired into the collaboration
// bucket: comments, tags, attachments — the last CONTRIBUTOR-writable
// surfaces. A CONTRIBUTOR may only mutate records they authored/uploaded;
// EDITOR / ORG_ADMIN / SUPER_ADMIN keep org-wide write (moderation).
//
// Routers are mounted WITHOUT authenticateToken; a stub middleware injects
// `req.user` from an `x-test-user` header. enforceAssignment passes through
// when there is no user, so existing no-auth tests are unaffected.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const commentsRouter = require('../routes/comments').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { comments } = require('../routes/comments');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tagsRouter = require('../routes/tags').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { tags } = require('../routes/tags');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const attachmentsRouter = require('../routes/attachments').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attachments } = require('../routes/attachments');

type User = { sub: string; role: string };

// NB: request paths in these tests use only compile-time-constant ids
// (the PREFIX seeds). We deliberately never interpolate a value read back
// from a response body or from the file-backed module stores into a path —
// CodeQL flags either as tainted data reaching an outbound request
// (js/request-forgery, js/file-access-to-http). "Create-owns" is asserted
// on the POST response; "can edit/delete own" uses a pre-seeded record the
// contributor owns, addressed by its constant id.
function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  user?: User,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    if (user) headers['x-test-user'] = JSON.stringify(user);
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const PREFIX = 'test-collab-';
const orgId = PREFIX + 'org';
const OWNER = 'person-owner';
const CONTRIB = { sub: 'person-contrib', role: 'CONTRIBUTOR' };
const OTHER_CONTRIB = { sub: 'person-other', role: 'CONTRIBUTOR' };
const EDITOR = { sub: 'person-editor', role: 'EDITOR' };

describe('layer-2 assigned scoping — collaboration bucket routes', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const h = req.headers['x-test-user'];
      if (typeof h === 'string') { try { (req as any).user = JSON.parse(h); } catch { /* ignore */ } }
      next();
    });
    app.use('/comments', commentsRouter);
    app.use('/tags', tagsRouter);
    app.use('/attachments', attachmentsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    // Sweep both the PREFIX seeds and anything created during a test under
    // our (unique) test orgId — POST-created rows get uuid ids and are
    // persisted via saveStore, so without the orgId clause a leaked row
    // survives on disk and collides on the next run (e.g. a duplicate tag).
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id?.startsWith(PREFIX) || arr[i].orgId === orgId) arr.splice(i, 1);
      }
    };
    sweep(comments);
    sweep(tags);
    sweep(attachments);
    const now = new Date().toISOString();
    // Records owned by someone else…
    comments.push({
      id: PREFIX + 'c-owned', orgId, entityType: 'DataAsset', entityId: 'e1',
      parentId: null, userId: OWNER, userName: 'Owner', content: 'hi',
      mentions: [], createdAt: now, updatedAt: now, deletedAt: null,
    });
    tags.push({
      id: PREFIX + 't-owned', orgId, entityType: 'DataAsset', entityId: 'e1',
      tag: 'pii', createdBy: OWNER, createdAt: now,
    });
    attachments.push({
      id: PREFIX + 'a-owned', orgId, entityType: 'DataAsset', entityId: 'e1',
      type: 'URL', name: 'ref', description: '', url: 'https://x',
      uploadedBy: OWNER, createdAt: now, updatedAt: now,
    });
    // …and records the test contributor owns.
    comments.push({
      id: PREFIX + 'c-mine', orgId, entityType: 'DataAsset', entityId: 'e1',
      parentId: null, userId: CONTRIB.sub, userName: 'Me', content: 'mine',
      mentions: [], createdAt: now, updatedAt: now, deletedAt: null,
    });
    tags.push({
      id: PREFIX + 't-mine', orgId, entityType: 'DataAsset', entityId: 'e1',
      tag: 'mine', createdBy: CONTRIB.sub, createdAt: now,
    });
    attachments.push({
      id: PREFIX + 'a-mine', orgId, entityType: 'DataAsset', entityId: 'e1',
      type: 'URL', name: 'mine', description: '', url: 'https://y',
      uploadedBy: CONTRIB.sub, createdAt: now, updatedAt: now,
    });
  });

  // ── comments (author-scoped delete; edit stays author-only elsewhere) ──

  it('comments: CONTRIBUTOR create is authored by them, and they can delete their own', async () => {
    const created = await request(port, 'POST', '/comments',
      { entityType: 'DataAsset', entityId: 'e1', content: 'mine', orgId }, CONTRIB);
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.userId, CONTRIB.sub);
    const del = await request(port, 'DELETE', `/comments/${PREFIX}c-mine`, undefined, CONTRIB);
    assert.strictEqual(del.status, 204);
  });

  it('comments: CONTRIBUTOR is 403 deleting a comment authored by someone else', async () => {
    const res = await request(port, 'DELETE', `/comments/${PREFIX}c-owned`, undefined, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('comments: EDITOR may delete any comment (moderation)', async () => {
    const res = await request(port, 'DELETE', `/comments/${PREFIX}c-owned`, undefined, EDITOR);
    assert.strictEqual(res.status, 204);
  });

  // ── tags ──

  it('tags: CONTRIBUTOR create records them as creator, and they can delete their own', async () => {
    const created = await request(port, 'POST', '/tags',
      { entityType: 'DataAsset', entityId: 'e2', tag: 'mine', orgId }, CONTRIB);
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.createdBy, CONTRIB.sub);
    const del = await request(port, 'DELETE', `/tags/${PREFIX}t-mine`, undefined, CONTRIB);
    assert.strictEqual(del.status, 204);
  });

  it('tags: CONTRIBUTOR is 403 deleting a tag created by someone else', async () => {
    const res = await request(port, 'DELETE', `/tags/${PREFIX}t-owned`, undefined, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('tags: EDITOR may delete any tag', async () => {
    const res = await request(port, 'DELETE', `/tags/${PREFIX}t-owned`, undefined, EDITOR);
    assert.strictEqual(res.status, 204);
  });

  // ── attachments ──

  it('attachments: CONTRIBUTOR create records them as uploader, and they can edit their own', async () => {
    const created = await request(port, 'POST', '/attachments/url',
      { entityType: 'DataAsset', entityId: 'e1', name: 'mine', url: 'https://y', orgId }, CONTRIB);
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.uploadedBy, CONTRIB.sub);
    const put = await request(port, 'PUT', `/attachments/${PREFIX}a-mine`, { name: 'mine v2' }, CONTRIB);
    assert.strictEqual(put.status, 200);
  });

  it('attachments: CONTRIBUTOR is 403 editing an attachment uploaded by someone else', async () => {
    const res = await request(port, 'PUT', `/attachments/${PREFIX}a-owned`, { name: 'hijack' }, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('attachments: CONTRIBUTOR is 403 deleting an attachment uploaded by someone else', async () => {
    const res = await request(port, 'DELETE', `/attachments/${PREFIX}a-owned`, undefined, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('attachments: EDITOR may edit any attachment', async () => {
    const res = await request(port, 'PUT', `/attachments/${PREFIX}a-owned`, { name: 'edited' }, EDITOR);
    assert.strictEqual(res.status, 200);
  });
});
