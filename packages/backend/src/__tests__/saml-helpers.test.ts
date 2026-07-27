import { describe, it } from 'node:test';
import assert from 'node:assert';

import { mapClaimToRole, normaliseCert } from '../services/saml.service';

describe('saml.service — mapClaimToRole', () => {
  it('passes Procela-canonical application roles through unchanged', () => {
    // The canonical set is exactly ROLE_PERMISSIONS' keys — the roles
    // requirePermission() actually enforces.
    for (const role of ['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER']) {
      assert.strictEqual(mapClaimToRole(role), role);
    }
  });

  it('never emits a role that has no permission entry', () => {
    // Regression guard for the SAML/RBAC drift: PROCESS_OWNER and
    // DATA_STEWARD used to be emitted but grant no permissions, so a
    // user mapped to them could do nothing. Every output must be a
    // real, enforceable role.
    const canonical = new Set(['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER']);
    for (const claim of ['steward', 'Data Steward', 'process-owner', 'owner', 'PROCESS_OWNER', 'DATA_STEWARD', 'engineer', 'anything']) {
      assert.ok(canonical.has(mapClaimToRole(claim)), `${claim} mapped outside the canonical set`);
    }
  });

  it('is case-insensitive on canonical roles', () => {
    assert.strictEqual(mapClaimToRole('org_admin'), 'ORG_ADMIN');
    assert.strictEqual(mapClaimToRole('editor'), 'EDITOR');
    assert.strictEqual(mapClaimToRole('Viewer'), 'VIEWER');
  });

  it('matches admin-style short codes to ORG_ADMIN', () => {
    // IdPs in the wild emit "admin", "administrator", "system-admin"
    assert.strictEqual(mapClaimToRole('admin'), 'ORG_ADMIN');
    assert.strictEqual(mapClaimToRole('administrator'), 'ORG_ADMIN');
    assert.strictEqual(mapClaimToRole('system-admin'), 'ORG_ADMIN');
  });

  it('maps steward- and owner-style groups to EDITOR', () => {
    // DAMA governance groups (Data Steward, Data/Process Owner) are not
    // permission roles — they resolve to EDITOR, the read-write catalog
    // role, not to a non-existent governance role name.
    assert.strictEqual(mapClaimToRole('steward'), 'EDITOR');
    assert.strictEqual(mapClaimToRole('Data Steward'), 'EDITOR');
    assert.strictEqual(mapClaimToRole('process-owner'), 'EDITOR');
    assert.strictEqual(mapClaimToRole('owner'), 'EDITOR');
  });

  it('matches editor-style codes to EDITOR', () => {
    assert.strictEqual(mapClaimToRole('editor'), 'EDITOR');
    assert.strictEqual(mapClaimToRole('content-editor'), 'EDITOR');
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
