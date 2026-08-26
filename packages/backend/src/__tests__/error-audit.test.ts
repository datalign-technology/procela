// errorHandler records UNEXPECTED errors (500s / non-operational) in the
// tamper-evident audit log with request context, and leaves routine 4xx out.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { errorHandler, AppError } from '../middleware/errorHandler';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { auditLogs } = require('../services/audit.service');

const PREFIX = '/test-eh-';

function mockReq(path: string, user?: { id?: string; orgId?: string }) {
  return { method: 'GET', originalUrl: path, path, user } as any;
}
function mockRes() {
  const res: any = {
    statusCode: 0, body: undefined,
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
}
const noop = (() => { /* next */ }) as any;

function errorEntries() {
  return auditLogs.filter((e: any) => e.action === 'ERROR' && typeof e.entityId === 'string' && e.entityId.includes(PREFIX));
}

describe('errorHandler audit logging', () => {
  beforeEach(() => {
    for (let i = auditLogs.length - 1; i >= 0; i--) {
      if (typeof auditLogs[i].entityId === 'string' && auditLogs[i].entityId.includes(PREFIX)) auditLogs.splice(i, 1);
    }
  });

  it('records an unexpected (non-AppError) error with full detail', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), mockReq(`${PREFIX}unhandled`, { id: 'u1', orgId: 'o1' }), res, noop);
    assert.strictEqual(res.statusCode, 500);

    const entries = errorEntries();
    assert.strictEqual(entries.length, 1);
    const e = entries[0];
    assert.strictEqual(e.orgId, 'o1');
    assert.strictEqual(e.userId, 'u1');
    assert.strictEqual(e.entityType, 'System');
    assert.strictEqual(e.entityId, `GET ${PREFIX}unhandled`);
    assert.strictEqual(e.after.statusCode, 500);
    assert.strictEqual(e.after.message, 'boom');
    assert.ok(typeof e.after.stack === 'string' && e.after.stack.length > 0, 'stack captured');
  });

  it('records a 5xx AppError', () => {
    const res = mockRes();
    errorHandler(new AppError('kaboom', 500), mockReq(`${PREFIX}five`, { id: 'u2', orgId: 'o2' }), res, noop);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(errorEntries().length, 1);
  });

  it('records a non-operational AppError even at 4xx', () => {
    const res = mockRes();
    errorHandler(new AppError('weird', 400, false), mockReq(`${PREFIX}nonop`), res, noop);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(errorEntries().length, 1);
    // No user on the request → system-scoped org, null user.
    assert.strictEqual(errorEntries()[0].orgId, 'system');
    assert.strictEqual(errorEntries()[0].userId, null);
  });

  it('does NOT audit a routine 4xx operational error', () => {
    const res = mockRes();
    errorHandler(new AppError('not found', 404), mockReq(`${PREFIX}notfound`), res, noop);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.error, 'not found');
    assert.strictEqual(errorEntries().length, 0, '4xx operational errors stay out of the audit log');
  });
});
