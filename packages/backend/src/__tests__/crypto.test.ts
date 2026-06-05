import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// The crypto service picks its provider at module load from
// MFA_ENCRYPTION_KEY / KMS_PROVIDER. Set the local AES key BEFORE the
// import so the LocalAesProvider is active for the round-trip tests.
const KEY_BEFORE = process.env.MFA_ENCRYPTION_KEY;
process.env.MFA_ENCRYPTION_KEY = 'unit-test-master-key-please-replace-in-prod';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require('../services/crypto.service') as typeof import('../services/crypto.service');

after(() => {
  if (KEY_BEFORE === undefined) delete process.env.MFA_ENCRYPTION_KEY;
  else process.env.MFA_ENCRYPTION_KEY = KEY_BEFORE;
});

describe('crypto.service — LocalAesProvider', () => {
  before(() => {
    // Sanity check that the provider that loaded is actually the
    // local AES one; the rest of the file depends on it.
    assert.strictEqual(crypto.getKmsProvider().name, 'local-aes-256-gcm');
    assert.strictEqual(crypto.isEncryptionConfigured(), true);
  });

  describe('encryptSecret / decryptSecret round-trip', () => {
    it('round-trips an ASCII string', async () => {
      const plain = 'super-secret-totp-key-bytes';
      const cipher = await crypto.encryptSecret(plain);
      assert.notStrictEqual(cipher, plain);
      assert.ok(cipher.startsWith('enc:v1:'), `unexpected envelope prefix: ${cipher.slice(0, 20)}`);
      const back = await crypto.decryptSecret(cipher);
      assert.strictEqual(back, plain);
    });

    it('round-trips unicode and emoji', async () => {
      const plain = 'café — naïve résumé 🔐';
      const cipher = await crypto.encryptSecret(plain);
      const back = await crypto.decryptSecret(cipher);
      assert.strictEqual(back, plain);
    });

    it('round-trips an empty string', async () => {
      const cipher = await crypto.encryptSecret('');
      const back = await crypto.decryptSecret(cipher);
      assert.strictEqual(back, '');
    });

    it('produces a different envelope each call (fresh IV)', async () => {
      const a = await crypto.encryptSecret('hello');
      const b = await crypto.encryptSecret('hello');
      assert.notStrictEqual(a, b, 'IV reuse — every encrypt should freshly randomise the IV');
    });
  });

  describe('decryptSecret legacy / pass-through paths', () => {
    it('returns the value unchanged when there is no colon (legacy plaintext)', async () => {
      const back = await crypto.decryptSecret('plain-no-envelope');
      assert.strictEqual(back, 'plain-no-envelope');
    });

    it('returns the value unchanged for an unknown envelope prefix', async () => {
      // Unknown prefixes pass through rather than throwing — the
      // caller surfaces the failure as "invalid code" or similar.
      const back = await crypto.decryptSecret('enc:future:v9:not-yet-implemented');
      assert.strictEqual(back, 'enc:future:v9:not-yet-implemented');
    });
  });

  describe('tamper detection', () => {
    it('throws on a corrupted ciphertext', async () => {
      const cipher = await crypto.encryptSecret('important secret');
      // Flip a character inside the ciphertext body.
      const tampered = cipher.slice(0, -4) + 'AAAA';
      await assert.rejects(crypto.decryptSecret(tampered));
    });

    it('throws on a truncated envelope', async () => {
      await assert.rejects(crypto.decryptSecret('enc:v1:short'));
    });
  });

  describe('resolveEnvSecretSync', () => {
    it('returns plaintext unchanged', () => {
      assert.strictEqual(crypto.resolveEnvSecretSync('plain-smtp-pass'), 'plain-smtp-pass');
    });

    it('returns empty string for undefined / empty input', () => {
      assert.strictEqual(crypto.resolveEnvSecretSync(undefined), '');
      assert.strictEqual(crypto.resolveEnvSecretSync(''), '');
    });

    it('decrypts an enc:v1 envelope synchronously', async () => {
      // Encrypt async, decrypt sync — exercises the bridge that
      // /etc-loaders use to consume encrypted env values at boot.
      const plain = 'smtp-password-from-env';
      const envelope = await crypto.encryptSecret(plain);
      assert.strictEqual(crypto.resolveEnvSecretSync(envelope), plain);
    });
  });
});
