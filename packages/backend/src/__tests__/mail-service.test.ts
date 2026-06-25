// Tests for services/mail.service — flagged in COVERAGE.md as Tier 1
// at 58% (only the "no SMTP configured" branch was previously hit).
//
// The module reads SMTP env at import time and freezes its state, so
// the "configured" path can't be exercised without re-importing under
// a different env. We isolate by mutating env, deleting the require
// cache for the module + its sole dependency (resolveEnvSecretSync
// reads env synchronously), then re-requiring.
//
// We don't try to verify against a real SMTP server — that's an
// integration concern. Here we lock in:
//   - isConfigured() = false when env is incomplete (each missing var)
//   - isConfigured() = false when env is complete (transporter is
//     constructed, but verify() runs async; until it resolves, ready
//     stays false → caller falls back to the dev path)
//   - getAppUrl() = '' when not configured
//   - sendPasswordResetEmail() returns false when not configured —
//     short-circuits before touching the network

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';

const MODULE_PATH = path.resolve(__dirname, '../services/mail.service');
const CRYPTO_PATH = path.resolve(__dirname, '../services/crypto.service');

const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL', 'SMTP_SECURE'];

function reset(env: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  // Force a fresh load so module-init reads our env.
  delete require.cache[require.resolve(MODULE_PATH)];
  delete require.cache[require.resolve(CRYPTO_PATH)];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(MODULE_PATH);
}

describe('mail.service', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[require.resolve(MODULE_PATH)];
    delete require.cache[require.resolve(CRYPTO_PATH)];
  });

  it('isConfigured() returns false when no SMTP env is set', () => {
    const mod = reset({});
    assert.strictEqual(mod.isConfigured(), false);
    assert.strictEqual(mod.getAppUrl(), '');
  });

  for (const missing of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL']) {
    it(`isConfigured() returns false when ${missing} is missing`, () => {
      const full: Record<string, string | undefined> = {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        MAIL_FROM: 'Procela <noreply@procela.io>',
        APP_URL: 'https://app.procela.io',
      };
      full[missing] = undefined;
      const mod = reset(full);
      assert.strictEqual(mod.isConfigured(), false, `${missing} missing should leave it unconfigured`);
    });
  }

  it('sendPasswordResetEmail() short-circuits to false when not configured', async () => {
    const mod = reset({});
    const sent = await mod.sendPasswordResetEmail({
      to: 'a@b.com', name: 'Alice', token: 'tok-123', ttlMinutes: 30,
    });
    assert.strictEqual(sent, false);
  });

  it('with a complete config, the module loads without throwing and exposes getAppUrl', () => {
    // verify() runs asynchronously and won't resolve against a fake
    // host, so isConfigured() remains false (verify never sets ready
    // to true). getAppUrl reads the synchronously-parsed config and
    // returns the configured base url either way — the link-build
    // path needs to work even before SMTP is verified, because
    // /forgot still records the audit-log fallback with the link.
    const mod = reset({
      SMTP_HOST: 'smtp.invalid.example',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      MAIL_FROM: 'Procela <noreply@procela.io>',
      APP_URL: 'https://app.procela.io',
    });
    assert.strictEqual(mod.getAppUrl(), 'https://app.procela.io');
  });
});
