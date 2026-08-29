// requireAiEnabled — the hard gate that turns the AI integration surface
// off when AI_FEATURES_ENABLED=false. The middleware reads config at call
// time, so the test flips the flag around each assertion.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';

import { config } from '../config';
import { requireAiEnabled } from '../middleware/ai-enabled';

// Minimal Express req/res/next doubles.
function makeRes() {
  const res: {
    statusCode?: number;
    body?: unknown;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
  } = {
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
}

describe('requireAiEnabled', () => {
  const original = config.aiFeaturesEnabled;
  afterEach(() => { config.aiFeaturesEnabled = original; });

  it('calls next() when AI features are enabled', () => {
    config.aiFeaturesEnabled = true;
    let called = false;
    const res = makeRes();
    requireAiEnabled({} as never, res as never, () => { called = true; });
    assert.strictEqual(called, true);
    assert.strictEqual(res.statusCode, undefined, 'must not write a response');
  });

  it('refuses with 403 AI_DISABLED when AI features are off', () => {
    config.aiFeaturesEnabled = false;
    let called = false;
    const res = makeRes();
    requireAiEnabled({} as never, res as never, () => { called = true; });
    assert.strictEqual(called, false, 'next() must not run when AI is off');
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(
      (res.body as { success: boolean; code: string }).success, false,
    );
    assert.strictEqual((res.body as { code: string }).code, 'AI_DISABLED');
  });
});
