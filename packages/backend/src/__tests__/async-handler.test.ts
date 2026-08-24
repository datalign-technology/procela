import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncHandler } from '../middleware/asyncHandler';

// The crash-guard for the agent-facing connector endpoints. Express 4 does not
// catch throws from async handlers, so without this a rejected promise (e.g. a
// Prisma foreign-key violation on a connector's asset report) becomes an
// unhandled rejection and exits the process. asyncHandler must instead route
// that error to Express's error middleware via next(err).

function fakeReqRes() {
  return { req: {} as any, res: {} as any };
}

test('asyncHandler forwards a rejected promise to next(err)', async () => {
  const boom = new Error('kaboom');
  const handler = asyncHandler(async () => {
    throw boom;
  });

  const { req, res } = fakeReqRes();
  let forwarded: unknown;
  await new Promise<void>((resolve) => {
    handler(req, res, (err?: unknown) => {
      forwarded = err;
      resolve();
    });
  });

  assert.equal(forwarded, boom, 'the thrown error must reach next()');
});

test('asyncHandler does not call next when the handler resolves', async () => {
  const handler = asyncHandler(async (_req, res: any) => {
    res.sent = true;
  });

  const { req } = fakeReqRes();
  const res = {} as any;
  let nextCalled = false;
  handler(req, res, () => {
    nextCalled = true;
  });

  // Let the microtask queue drain so a stray rejection would have surfaced.
  await new Promise((r) => setImmediate(r));

  assert.equal(res.sent, true, 'the wrapped handler still runs');
  assert.equal(nextCalled, false, 'next must not be called on success');
});
