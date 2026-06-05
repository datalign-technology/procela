import { describe, it } from 'node:test';
import assert from 'node:assert';

import { mapClaimToRole, normaliseCert } from '../services/saml.service';

describe('saml.service — mapClaimToRole', () => {
  it('passes Procela-canonical roles through unchanged', () => {
    for (const role of ['SUPER_ADMIN', 'ORG_ADMIN', 'PROCESS_OWNER', 'DATA_STEWARD', 'CONTRIBUTOR', 'VIEWER']) {
      assert.strictEqual(mapClaimToRole(role), role);
    }
  });

  it('is case-insensitive on canonical roles', () => {
    assert.strictEqual(mapClaimToRole('org_admin'), 'ORG_ADMIN');
    assert.strictEqual(mapClaimToRole('Viewer'), 'VIEWER');
  });

  it('matches admin-style short codes to ORG_ADMIN', () => {
    // IdPs in the wild emit "admin", "administrator", "system-admin"
    assert.strictEqual(mapClaimToRole('admin'), 'ORG_ADMIN');
    assert.strictEqual(mapClaimToRole('administrator'), 'ORG_ADMIN');
    assert.strictEqual(mapClaimToRole('system-admin'), 'ORG_ADMIN');
  });

  it('matches steward-style codes to DATA_STEWARD', () => {
    assert.strictEqual(mapClaimToRole('steward'), 'DATA_STEWARD');
    assert.strictEqual(mapClaimToRole('Data Steward'), 'DATA_STEWARD');
  });

  it('matches owner-style codes to PROCESS_OWNER', () => {
    assert.strictEqual(mapClaimToRole('process-owner'), 'PROCESS_OWNER');
    assert.strictEqual(mapClaimToRole('owner'), 'PROCESS_OWNER');
  });

  it('matches contrib* to CONTRIBUTOR', () => {
    assert.strictEqual(mapClaimToRole('contributor'), 'CONTRIBUTOR');
    assert.strictEqual(mapClaimToRole('contrib'), 'CONTRIBUTOR');
  });

  it('falls back to VIEWER for anything else', () => {
    assert.strictEqual(mapClaimToRole('random-group-name'), 'VIEWER');
    assert.strictEqual(mapClaimToRole(''), 'VIEWER');
    assert.strictEqual(mapClaimToRole('engineer'), 'VIEWER');
  });

  it('SUPER_ADMIN matches the substring rule too if no exact match', () => {
    // 'super-admin' has ADMIN in it — exact-match doesn't catch the
    // hyphenated form, but the includes('ADMIN') branch does.
    assert.strictEqual(mapClaimToRole('super-admin'), 'ORG_ADMIN');
  });
});

describe('saml.service — normaliseCert', () => {
  const FAKE_CERT_BODY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  it('wraps headerless cert bodies in BEGIN/END markers', () => {
    const out = normaliseCert(FAKE_CERT_BODY);
    assert.ok(out.startsWith('-----BEGIN CERTIFICATE-----\n'), out);
    assert.ok(out.endsWith('\n-----END CERTIFICATE-----'), out);
  });

  it('re-wraps a cert that already has headers', () => {
    const input = `-----BEGIN CERTIFICATE-----\n${FAKE_CERT_BODY}\n-----END CERTIFICATE-----`;
    const out = normaliseCert(input);
    // Headers appear exactly once at start and end.
    const beginCount = (out.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
    const endCount = (out.match(/-----END CERTIFICATE-----/g) || []).length;
    assert.strictEqual(beginCount, 1);
    assert.strictEqual(endCount, 1);
  });

  it('handles a single-line cert pasted into an env var', () => {
    // Common admin shortcut — paste the cert body on one line with
    // spaces / tabs / newlines collapsed however. node-saml expects
    // proper PEM line-wrapping.
    const oneLine = `   ${FAKE_CERT_BODY}   `;
    const out = normaliseCert(oneLine);
    // The body inside the wrapper must be wrapped at <= 64-char lines.
    const body = out
      .replace('-----BEGIN CERTIFICATE-----\n', '')
      .replace('\n-----END CERTIFICATE-----', '');
    for (const line of body.split('\n')) {
      assert.ok(line.length <= 64, `line longer than 64 chars: ${line.length}`);
    }
  });

  it('strips whitespace inside the body', () => {
    const messy = `-----BEGIN CERTIFICATE-----\n${FAKE_CERT_BODY.slice(0, 32)}\n   ${FAKE_CERT_BODY.slice(32)}\n-----END CERTIFICATE-----`;
    const out = normaliseCert(messy);
    const body = out
      .replace('-----BEGIN CERTIFICATE-----\n', '')
      .replace('\n-----END CERTIFICATE-----', '');
    // No internal whitespace within the body chars.
    assert.ok(!/\s/.test(body.replace(/\n/g, '')), 'body still contains whitespace');
  });
});
