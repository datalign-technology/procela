import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  generateEnrollment,
  verifyToken,
  generateCurrentToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  BACKUP_CODE_COUNT,
  mintOpaqueMfaToken,
} from '../services/mfa.service';

describe('mfa.service', () => {
  describe('generateEnrollment', () => {
    it('returns a base32 secret, otpauth URI, and a PNG data URL', async () => {
      const e = await generateEnrollment('alice@example.com');
      // Base32 alphabet — uppercase letters + digits 2-7, optional padding.
      assert.match(e.secret, /^[A-Z2-7=]+$/);
      // 20 raw bytes encode to 32 base32 chars.
      assert.ok(e.secret.length >= 32, `secret too short: ${e.secret.length}`);
      assert.ok(e.uri.startsWith('otpauth://totp/'), 'URI scheme');
      assert.ok(e.uri.includes('alice%40example.com') || e.uri.includes('alice@example.com'), 'URI carries label');
      assert.ok(e.uri.includes('issuer=Procela'), 'URI carries issuer');
      assert.ok(e.qrDataUrl.startsWith('data:image/png;base64,'), 'QR is a PNG data URL');
    });

    it('produces a different secret each call', async () => {
      const a = await generateEnrollment('a@example.com');
      const b = await generateEnrollment('a@example.com');
      assert.notStrictEqual(a.secret, b.secret);
    });
  });

  describe('verifyToken', () => {
    it('accepts a freshly generated current code', async () => {
      const { secret } = await generateEnrollment('a@example.com');
      const token = await generateCurrentToken(secret);
      assert.strictEqual(await verifyToken(secret, token), true);
    });

    it('rejects an obviously wrong code', async () => {
      const { secret } = await generateEnrollment('a@example.com');
      assert.strictEqual(await verifyToken(secret, '000000'), false);
    });

    it('rejects an empty code', async () => {
      const { secret } = await generateEnrollment('a@example.com');
      assert.strictEqual(await verifyToken(secret, ''), false);
    });

    it('rejects an empty secret', async () => {
      assert.strictEqual(await verifyToken('', '123456'), false);
    });

    it('does not throw on malformed input', async () => {
      // otplib has thrown on malformed secrets in the past — the service
      // wraps the call in try/catch and returns false. Verify that contract.
      const result = await verifyToken('not-base32!', 'abcdef');
      assert.strictEqual(result, false);
    });

    it('tolerates whitespace around the code', async () => {
      const { secret } = await generateEnrollment('a@example.com');
      const token = await generateCurrentToken(secret);
      assert.strictEqual(await verifyToken(secret, `  ${token}  `), true);
    });
  });

  describe('backup codes', () => {
    it('generates exactly BACKUP_CODE_COUNT codes', () => {
      const codes = generateBackupCodes();
      assert.strictEqual(codes.length, BACKUP_CODE_COUNT);
    });

    it('produces codes in the documented format (5-char chunks, hyphen, only safe alphabet)', () => {
      const codes = generateBackupCodes();
      for (const c of codes) {
        // Five chars + hyphen + five chars.
        assert.match(c, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/, `bad code format: ${c}`);
      }
    });

    it('returns unique codes within a single generation', () => {
      const codes = generateBackupCodes();
      const set = new Set(codes);
      assert.strictEqual(set.size, codes.length, 'duplicate backup codes generated');
    });

    it('verifyBackupCode returns the index of the matching hash on success', async () => {
      const plain = generateBackupCodes();
      const hashes = await hashBackupCodes(plain);
      // Pick the middle one to make sure indexing isn't always 0.
      const targetIdx = 4;
      const idx = await verifyBackupCode(hashes, plain[targetIdx]);
      assert.strictEqual(idx, targetIdx);
    });

    it('returns -1 for a non-matching code', async () => {
      const plain = generateBackupCodes();
      const hashes = await hashBackupCodes(plain);
      const idx = await verifyBackupCode(hashes, 'ABCDE-FGHJK');
      assert.strictEqual(idx, -1);
    });

    it('accepts a code with stripped hyphens', async () => {
      const plain = generateBackupCodes();
      const hashes = await hashBackupCodes(plain);
      const noHyphen = plain[0].replace('-', '');
      const idx = await verifyBackupCode(hashes, noHyphen);
      assert.strictEqual(idx, 0);
    });

    it('accepts a code in mixed case', async () => {
      const plain = generateBackupCodes();
      const hashes = await hashBackupCodes(plain);
      const idx = await verifyBackupCode(hashes, plain[0].toLowerCase());
      assert.strictEqual(idx, 0);
    });

    it('accepts a code with surrounding whitespace', async () => {
      const plain = generateBackupCodes();
      const hashes = await hashBackupCodes(plain);
      const idx = await verifyBackupCode(hashes, `  ${plain[0]}  `);
      assert.strictEqual(idx, 0);
    });

    it('returns -1 for an empty input', async () => {
      const hashes = await hashBackupCodes(generateBackupCodes());
      assert.strictEqual(await verifyBackupCode(hashes, ''), -1);
    });

    it('survives malformed hashes in the array', async () => {
      // A leaked half-written record shouldn't crash verification of
      // the rest. Insert a junk string between two real hashes.
      const plain = generateBackupCodes();
      const hashes = await hashBackupCodes(plain.slice(0, 2));
      const mixed = [hashes[0], 'not-a-real-argon2-hash', hashes[1]];
      assert.strictEqual(await verifyBackupCode(mixed, plain[1]), 2);
    });
  });

  describe('mintOpaqueMfaToken', () => {
    it('produces a url-safe-base64 string of the expected length', () => {
      const token = mintOpaqueMfaToken();
      // 24 random bytes → 32 base64url chars (no padding).
      assert.strictEqual(token.length, 32);
      assert.match(token, /^[A-Za-z0-9_-]+$/);
    });

    it('produces unique tokens each call', () => {
      const tokens = new Set([
        mintOpaqueMfaToken(),
        mintOpaqueMfaToken(),
        mintOpaqueMfaToken(),
      ]);
      assert.strictEqual(tokens.size, 3);
    });
  });
});
