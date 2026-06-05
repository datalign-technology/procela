import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  isCaptchaRequired,
  recordLoginFailure,
  clearLoginFailures,
  verifyCaptchaToken,
  getCaptchaSiteKey,
} from '../services/login-challenge';

// Default threshold is 3 (configurable via CAPTCHA_THRESHOLD env). The
// service ships values fixed at module-load, so these tests use the
// default and exercise behaviour at the 3-failure boundary.

describe('login-challenge', () => {
  // Each test starts with no state for the IPs it uses. Use unique
  // IPs per assertion so tests don't interfere with each other.
  beforeEach(() => {
    clearLoginFailures('10.0.0.1');
    clearLoginFailures('10.0.0.2');
    clearLoginFailures('10.0.0.3');
    clearLoginFailures(undefined);
  });

  afterEach(() => {
    clearLoginFailures('10.0.0.1');
    clearLoginFailures('10.0.0.2');
    clearLoginFailures('10.0.0.3');
    clearLoginFailures(undefined);
  });

  describe('isCaptchaRequired', () => {
    it('returns false for an IP with no recorded failures', () => {
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), false);
    });

    it('returns false until the threshold is reached', () => {
      recordLoginFailure('10.0.0.1');
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), false);
      recordLoginFailure('10.0.0.1');
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), false);
    });

    it('returns true once the threshold is reached', () => {
      recordLoginFailure('10.0.0.1');
      recordLoginFailure('10.0.0.1');
      recordLoginFailure('10.0.0.1');
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), true);
    });

    it('treats undefined IP as a stable key (does not crash, does count)', () => {
      recordLoginFailure(undefined);
      recordLoginFailure(undefined);
      recordLoginFailure(undefined);
      assert.strictEqual(isCaptchaRequired(undefined), true);
    });
  });

  describe('clearLoginFailures', () => {
    it('drops the IP back below the threshold', () => {
      recordLoginFailure('10.0.0.1');
      recordLoginFailure('10.0.0.1');
      recordLoginFailure('10.0.0.1');
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), true);
      clearLoginFailures('10.0.0.1');
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), false);
    });

    it('is a no-op for an IP with no state', () => {
      // No assertion to make — just confirms it doesn't throw.
      clearLoginFailures('10.0.0.99');
      assert.strictEqual(isCaptchaRequired('10.0.0.99'), false);
    });
  });

  describe('isolation across IPs', () => {
    it('failures on one IP do not promote another IP over the threshold', () => {
      recordLoginFailure('10.0.0.1');
      recordLoginFailure('10.0.0.1');
      recordLoginFailure('10.0.0.1');
      assert.strictEqual(isCaptchaRequired('10.0.0.1'), true);
      assert.strictEqual(isCaptchaRequired('10.0.0.2'), false);
    });
  });

  describe('verifyCaptchaToken (dev mode — HCAPTCHA_SECRET unset)', () => {
    // The service reads HCAPTCHA_SECRET each call, so explicit unset
    // here regardless of test runner inheritance.
    beforeEach(() => { delete process.env.HCAPTCHA_SECRET; });

    it('rejects an empty token', async () => {
      assert.strictEqual(await verifyCaptchaToken('', '10.0.0.1'), false);
    });

    it('rejects an undefined token', async () => {
      assert.strictEqual(await verifyCaptchaToken(undefined, '10.0.0.1'), false);
    });

    it('accepts any non-empty token when no secret is configured', async () => {
      assert.strictEqual(await verifyCaptchaToken('human-confirmed-xyz', '10.0.0.1'), true);
      assert.strictEqual(await verifyCaptchaToken('any-thing-at-all', '10.0.0.1'), true);
    });
  });

  describe('getCaptchaSiteKey', () => {
    it('reflects the HCAPTCHA_SITE_KEY env value', () => {
      const previous = process.env.HCAPTCHA_SITE_KEY;
      try {
        process.env.HCAPTCHA_SITE_KEY = 'site-key-for-test';
        assert.strictEqual(getCaptchaSiteKey(), 'site-key-for-test');
      } finally {
        if (previous === undefined) delete process.env.HCAPTCHA_SITE_KEY;
        else process.env.HCAPTCHA_SITE_KEY = previous;
      }
    });

    it('returns empty string when HCAPTCHA_SITE_KEY is unset', () => {
      const previous = process.env.HCAPTCHA_SITE_KEY;
      try {
        delete process.env.HCAPTCHA_SITE_KEY;
        assert.strictEqual(getCaptchaSiteKey(), '');
      } finally {
        if (previous !== undefined) process.env.HCAPTCHA_SITE_KEY = previous;
      }
    });
  });
});
