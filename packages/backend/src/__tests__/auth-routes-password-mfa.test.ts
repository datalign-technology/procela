// HTTP-layer tests for the password-reset and MFA-enrol flows on
// routes/auth.ts. The unit-level service tests under
// reset-tokens.test.ts and mfa.test.ts cover the underlying logic;
// what's missing in the coverage map is the wiring — request shape,
// response shape, status codes, the rate limiter, the audit entry
// per branch. These fill those.
//
// Each test uses a unique email so the per-email forgot-password
// rate limiter (5/hr) never bites across the suite.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import jwt from 'jsonwebtoken';
import { generate as generateTotp, NobleCryptoPlugin } from 'otplib';

// Match the mfa.service config (sha1, 6 digits, 30-second step) so
// the generated code lines up with what the route's verifyToken will
// accept. Lives at module scope so every test reuses the same plugin
// instance — building one per test is wasteful.
const totpCrypto = new NobleCryptoPlugin();
import * as argon2 from 'argon2';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import config from '../config';
import authRouter from '../routes/auth';
import { people, type StoredPerson } from '../routes/people';
import { auditLogs } from '../services/audit.service';
import { _resetRateLimitForTesting } from '../middleware/rate-limit';
import { replaceArray } from './_helpers/store-isolation';

interface ResponseEnvelope {
  status: number;
  body: any;
}

async function call(
  base: string,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<ResponseEnvelope> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

function mintAccessToken(personId: string, email: string, role = 'ORG_ADMIN'): string {
  return jwt.sign(
    { sub: personId, email, orgId: 'org-test-1', role, type: 'access' },
    config.jwtSecret,
    { expiresIn: '1h' },
  );
}

async function seedPerson(personId: string, email: string, opts: { password?: string; mfaEnrolled?: boolean } = {}): Promise<StoredPerson> {
  const now = new Date().toISOString();
  const person: StoredPerson = {
    id: personId,
    name: 'Test User',
    email,
    role: 'ORG_ADMIN',
    orgIds: ['org-test-1'],
    title: '',
    department: '',
    jobRole: null,
    accessibleOrgIds: ['org-test-1'],
    passwordHash: opts.password ? await argon2.hash(opts.password) : null,
    passwordUpdatedAt: opts.password ? now : null,
    passwordMustChange: false,
    mfaEnrolled: !!opts.mfaEnrolled,
    mfaSecret: null,
    mfaBackupCodes: [],
    activeSessions: [],
    skillIds: [],
    revokedTokens: [],
    createdAt: now,
    updatedAt: now,
  } as StoredPerson;
  people.push(person);
  return person;
}

let app: { url: string; close: () => Promise<void> };

before(async () => {
  const expressApp = express();
  expressApp.use(express.json());
  expressApp.use('/auth', authRouter);
  return new Promise<void>((resolve, reject) => {
    const server: Server = expressApp.listen(0, () => {
      const addr = server.address() as AddressInfo;
      app = {
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      };
      resolve();
    });
    server.on('error', reject);
  });
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  // Reset shared in-memory stores so tests don't interfere via state
  // leaked from previous cases. The persistence layer's disk files
  // are left alone — the tests below operate purely on the in-memory
  // arrays, which is what the route handlers also read from.
  replaceArray(people, []);
  replaceArray(auditLogs, []);
  // The /password/{forgot,reset} endpoints share a forgot-password
  // rate limiter (5/hr per email key, with empty-string key when the
  // body has no email — i.e. every /reset call). Without resetting
  // the counter between tests the suite eats the budget and the
  // later happy-path tests get 429s.
  _resetRateLimitForTesting();
});

describe('POST /auth/password/forgot', () => {
  it('returns 400 when email is missing', async () => {
    const res = await call(app.url, 'POST', '/auth/password/forgot', { body: {} });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body?.success, false);
    assert.match(res.body?.error || '', /email is required/i);
  });

  it('returns 204 for an unknown email (no enumeration leak)', async () => {
    const res = await call(app.url, 'POST', '/auth/password/forgot', {
      body: { email: 'nobody-unknown@example.com' },
    });
    // The uniform 204 is the whole point — the caller learns nothing
    // about whether the email matched a real account.
    assert.strictEqual(res.status, 204);
    // No PASSWORD_RESET_REQUESTED audit entry should land for the
    // unknown email; only a logger.info goes out.
    assert.ok(
      !auditLogs.some((a) => a.action === 'PASSWORD_RESET_REQUESTED'),
      'unknown email must not write an audit entry',
    );
  });

  it('returns 204 for a known email and writes an audit entry with the dev token', async () => {
    const person = await seedPerson('person-forgot-known', 'known-forgot@example.com');
    const res = await call(app.url, 'POST', '/auth/password/forgot', {
      body: { email: person.email },
    });
    assert.strictEqual(res.status, 204);
    // The audit entry carries the plaintext token in the dev path
    // (no SMTP configured in tests). This is how the test below
    // gets the token without having to peek at internal state.
    const audit = auditLogs.find((a) => a.action === 'PASSWORD_RESET_REQUESTED');
    assert.ok(audit, 'PASSWORD_RESET_REQUESTED audit entry must exist');
    assert.strictEqual((audit?.after as any)?.targetPersonId, person.id);
    assert.strictEqual((audit?.after as any)?.deliveryChannel, 'audit');
    assert.ok((audit?.after as any)?.resetTokenDev, 'dev token must be exposed via audit when SMTP off');
  });

  it('email match is case-insensitive', async () => {
    await seedPerson('person-forgot-case', 'Mixed-Case@Example.com');
    const res = await call(app.url, 'POST', '/auth/password/forgot', {
      body: { email: 'mixed-case@example.com' },
    });
    assert.strictEqual(res.status, 204);
    assert.ok(auditLogs.some((a) => a.action === 'PASSWORD_RESET_REQUESTED'));
  });
});

describe('POST /auth/password/reset', () => {
  it('returns 400 when token or newPassword is missing', async () => {
    const noBoth = await call(app.url, 'POST', '/auth/password/reset', { body: {} });
    assert.strictEqual(noBoth.status, 400);
    assert.match(noBoth.body?.error || '', /token and newPassword are required/i);

    const noPassword = await call(app.url, 'POST', '/auth/password/reset', { body: { token: 'abc' } });
    assert.strictEqual(noPassword.status, 400);
    assert.match(noPassword.body?.error || '', /token and newPassword are required/i);

    const noToken = await call(app.url, 'POST', '/auth/password/reset', { body: { newPassword: 'P@ssw0rd!Strong1' } });
    assert.strictEqual(noToken.status, 400);
    assert.match(noToken.body?.error || '', /token and newPassword are required/i);
  });

  it('returns 400 for an unknown token', async () => {
    const res = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token: 'never-issued-token', newPassword: 'P@ssw0rd!Strong1' },
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body?.error || '', /Invalid or expired token/i);
  });

  it('happy path: token from /forgot can be consumed to set a new password', async () => {
    const person = await seedPerson('person-reset-happy', 'reset-happy@example.com');
    const forgot = await call(app.url, 'POST', '/auth/password/forgot', {
      body: { email: person.email },
    });
    assert.strictEqual(forgot.status, 204);

    const audit = auditLogs.find((a) => a.action === 'PASSWORD_RESET_REQUESTED');
    const token = (audit?.after as any)?.resetTokenDev as string;
    assert.ok(token, 'dev token must be present in audit entry');

    const newPassword = 'BrandNewStrong#1';
    const reset = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token, newPassword },
    });
    assert.strictEqual(reset.status, 204);

    // The person record now has a hashed password and the
    // PASSWORD_RESET_CONSUMED audit entry exists.
    const updated = people.find((p) => p.id === person.id)!;
    assert.ok(updated.passwordHash, 'password hash must be set');
    assert.ok(await argon2.verify(updated.passwordHash, newPassword), 'hash must verify the new password');
    assert.strictEqual(updated.passwordMustChange, false);
    assert.ok(auditLogs.some((a) => a.action === 'PASSWORD_RESET_CONSUMED'));
  });

  it('token is single-use: second reset with the same token returns 400', async () => {
    const person = await seedPerson('person-reset-single', 'reset-single@example.com');
    await call(app.url, 'POST', '/auth/password/forgot', { body: { email: person.email } });
    const token = (auditLogs.find((a) => a.action === 'PASSWORD_RESET_REQUESTED')?.after as any)?.resetTokenDev as string;

    const first = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token, newPassword: 'FirstUseStrong#1' },
    });
    assert.strictEqual(first.status, 204);

    const second = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token, newPassword: 'SecondUseStrong#2' },
    });
    assert.strictEqual(second.status, 400);
    assert.match(second.body?.error || '', /Invalid or expired token/i);
  });

  it('rejects a weak password and burns the token (single-use semantics)', async () => {
    const person = await seedPerson('person-reset-weak', 'reset-weak@example.com');
    await call(app.url, 'POST', '/auth/password/forgot', { body: { email: person.email } });
    const token = (auditLogs.find((a) => a.action === 'PASSWORD_RESET_REQUESTED')?.after as any)?.resetTokenDev as string;

    const weak = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token, newPassword: 'short' },
    });
    assert.strictEqual(weak.status, 400);
    // The error message comes from the password policy, not the
    // generic "invalid token" message — caller knows the token was
    // valid but the password failed.
    assert.notStrictEqual(weak.body?.error, 'Invalid or expired token');

    // Token was consumed up-front (defensive: prevents a brute-force
    // retry loop against the policy).
    const second = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token, newPassword: 'NowStrongEnough#1' },
    });
    assert.strictEqual(second.status, 400);
    assert.match(second.body?.error || '', /Invalid or expired token/i);
  });

  it('returns 400 (uniform) when the token references a deleted person', async () => {
    const person = await seedPerson('person-reset-orphan', 'reset-orphan@example.com');
    await call(app.url, 'POST', '/auth/password/forgot', { body: { email: person.email } });
    const token = (auditLogs.find((a) => a.action === 'PASSWORD_RESET_REQUESTED')?.after as any)?.resetTokenDev as string;

    // Delete the person AFTER minting the token. The reset attempt
    // should look identical to "invalid token" from the caller's
    // perspective — no leak that the account ever existed.
    const idx = people.findIndex((p) => p.id === person.id);
    people.splice(idx, 1);

    const res = await call(app.url, 'POST', '/auth/password/reset', {
      body: { token, newPassword: 'StrongEnough#1' },
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body?.error || '', /Invalid or expired token/i);
  });
});

describe('POST /auth/mfa/start + /auth/mfa/verify (enrolment flow)', () => {
  it('start: 401 without a token', async () => {
    const res = await call(app.url, 'POST', '/auth/mfa/start', { body: {} });
    assert.strictEqual(res.status, 401);
  });

  it('start: 404 when the JWT references a non-existent person', async () => {
    const token = mintAccessToken('person-ghost', 'ghost@example.com');
    const res = await call(app.url, 'POST', '/auth/mfa/start', { body: {}, token });
    assert.strictEqual(res.status, 404);
    assert.match(res.body?.error || '', /No person record/i);
  });

  it('start: returns secret + uri + qrDataUrl for a real person', async () => {
    const person = await seedPerson('person-mfa-start', 'mfa-start@example.com');
    const token = mintAccessToken(person.id, person.email);

    const res = await call(app.url, 'POST', '/auth/mfa/start', { body: {}, token });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body?.success, true);
    assert.ok(res.body?.data?.secret, 'secret must be present');
    assert.ok((res.body.data.uri as string).startsWith('otpauth://totp/'), 'otpauth URI');
    assert.ok((res.body.data.qrDataUrl as string).startsWith('data:image/'), 'QR data URL');
    assert.strictEqual(res.body.data.replacing, false, 'not replacing on a fresh enrolment');
    assert.ok(auditLogs.some((a) => a.action === 'MFA_ENROLLMENT_STARTED'));
  });

  it('start: flags replacing=true when the user is already enrolled', async () => {
    const person = await seedPerson('person-mfa-replacing', 'mfa-replacing@example.com', { mfaEnrolled: true });
    const token = mintAccessToken(person.id, person.email);
    const res = await call(app.url, 'POST', '/auth/mfa/start', { body: {}, token });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.replacing, true);
  });

  it('verify: 400 when code is missing', async () => {
    const person = await seedPerson('person-mfa-nocode', 'mfa-nocode@example.com');
    const token = mintAccessToken(person.id, person.email);
    await call(app.url, 'POST', '/auth/mfa/start', { body: {}, token });
    const res = await call(app.url, 'POST', '/auth/mfa/verify', { body: {}, token });
    assert.strictEqual(res.status, 400);
    assert.match(res.body?.error || '', /code is required/i);
  });

  it('verify: 400 when no enrolment is pending', async () => {
    const person = await seedPerson('person-mfa-nostart', 'mfa-nostart@example.com');
    const token = mintAccessToken(person.id, person.email);
    // Skip the /mfa/start call — verify should refuse to proceed.
    const res = await call(app.url, 'POST', '/auth/mfa/verify', {
      body: { code: '000000' },
      token,
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body?.error || '', /No active enrolment|No active enrollment/i);
  });

  it('verify: 401 for a wrong TOTP code, audits the failed attempt', async () => {
    const person = await seedPerson('person-mfa-wrong', 'mfa-wrong@example.com');
    const token = mintAccessToken(person.id, person.email);
    await call(app.url, 'POST', '/auth/mfa/start', { body: {}, token });

    const res = await call(app.url, 'POST', '/auth/mfa/verify', {
      body: { code: '000000' },
      token,
    });
    assert.strictEqual(res.status, 401);
    assert.match(res.body?.error || '', /Invalid code/i);
    assert.ok(auditLogs.some((a) => a.action === 'MFA_ENROLLMENT_FAILED'));
    // The person record must NOT have been flipped to enrolled.
    const updated = people.find((p) => p.id === person.id)!;
    assert.strictEqual(updated.mfaEnrolled, false);
  });

  it('happy path: start → verify with a real TOTP code → enrolled + backup codes', async () => {
    const person = await seedPerson('person-mfa-happy', 'mfa-happy@example.com');
    const token = mintAccessToken(person.id, person.email);

    const startRes = await call(app.url, 'POST', '/auth/mfa/start', { body: {}, token });
    assert.strictEqual(startRes.status, 200);
    const secret = startRes.body.data.secret as string;

    // Generate the actual TOTP code that the user's authenticator
    // app would produce for this secret at this moment. Args match
    // the mfa.service config — same digits, same step.
    const code = await generateTotp({
      secret,
      digits: 6,
      period: 30,
      algorithm: 'sha1',
      crypto: totpCrypto,
    });

    const verifyRes = await call(app.url, 'POST', '/auth/mfa/verify', {
      body: { code },
      token,
    });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.body?.data?.enrolled, true);
    assert.ok(Array.isArray(verifyRes.body?.data?.backupCodes));
    assert.ok((verifyRes.body.data.backupCodes as string[]).length >= 8, 'returns a usable set of backup codes');

    // The person record now reflects enrolment + has hashed backup
    // codes + encrypted (or plaintext-in-dev) secret.
    const updated = people.find((p) => p.id === person.id)!;
    assert.strictEqual(updated.mfaEnrolled, true);
    assert.ok(updated.mfaSecret, 'mfaSecret must be set');
    assert.ok(Array.isArray(updated.mfaBackupCodes) && updated.mfaBackupCodes.length === verifyRes.body.data.backupCodes.length);
    // Backup codes stored on the record are HASHED — the plaintext
    // returned in the response must not equal what's on disk.
    for (const stored of updated.mfaBackupCodes) {
      assert.ok(!(verifyRes.body.data.backupCodes as string[]).includes(stored), 'stored backup code must be hashed, not plaintext');
    }
    assert.ok(auditLogs.some((a) => a.action === 'MFA_ENROLLED'));
  });
});
