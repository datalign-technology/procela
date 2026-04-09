import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hasPermission, getPermissionsForRole, ROLES } from '../lib/permissions';

describe('hasPermission', () => {
  it('SUPER_ADMIN has all permissions', () => {
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'process:write'), true);
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'process:read'), true);
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'anything:whatever'), true);
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'org:delete'), true);
  });

  it('VIEWER can read but not write', () => {
    assert.strictEqual(hasPermission('VIEWER', 'process:read'), true);
    assert.strictEqual(hasPermission('VIEWER', 'system:read'), true);
    assert.strictEqual(hasPermission('VIEWER', 'process:write'), false);
    assert.strictEqual(hasPermission('VIEWER', 'data-asset:write'), false);
  });

  it('ORG_ADMIN has wildcard access on org resources', () => {
    assert.strictEqual(hasPermission('ORG_ADMIN', 'org:read'), true);
    assert.strictEqual(hasPermission('ORG_ADMIN', 'org:write'), true);
    assert.strictEqual(hasPermission('ORG_ADMIN', 'org:delete'), true);
    assert.strictEqual(hasPermission('ORG_ADMIN', 'process:read'), true);
    assert.strictEqual(hasPermission('ORG_ADMIN', 'process:write'), true);
  });

  it('PROCESS_OWNER can read/write processes and mappings', () => {
    assert.strictEqual(hasPermission('PROCESS_OWNER', 'process:read'), true);
    assert.strictEqual(hasPermission('PROCESS_OWNER', 'process:write'), true);
    assert.strictEqual(hasPermission('PROCESS_OWNER', 'mapping:read'), true);
    assert.strictEqual(hasPermission('PROCESS_OWNER', 'mapping:write'), true);
    assert.strictEqual(hasPermission('PROCESS_OWNER', 'data-asset:write'), false);
  });

  it('DATA_STEWARD can read/write data assets and mappings', () => {
    assert.strictEqual(hasPermission('DATA_STEWARD', 'data-asset:read'), true);
    assert.strictEqual(hasPermission('DATA_STEWARD', 'data-asset:write'), true);
    assert.strictEqual(hasPermission('DATA_STEWARD', 'mapping:read'), true);
    assert.strictEqual(hasPermission('DATA_STEWARD', 'mapping:write'), true);
    assert.strictEqual(hasPermission('DATA_STEWARD', 'process:write'), false);
  });

  it('CONTRIBUTOR can read and write processes but not data assets', () => {
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'process:read'), true);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'process:write'), true);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'data-asset:read'), true);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'data-asset:write'), false);
  });

  it('returns false for unknown role', () => {
    assert.strictEqual(hasPermission('NONEXISTENT', 'process:read'), false);
  });
});

describe('getPermissionsForRole', () => {
  it('returns permissions array for known role', () => {
    const perms = getPermissionsForRole('SUPER_ADMIN');
    assert.ok(Array.isArray(perms));
    assert.ok(perms.includes('*'));
  });

  it('returns empty array for unknown role', () => {
    const perms = getPermissionsForRole('NONEXISTENT');
    assert.ok(Array.isArray(perms));
    assert.strictEqual(perms.length, 0);
  });

  it('VIEWER has only read permissions', () => {
    const perms = getPermissionsForRole('VIEWER');
    for (const p of perms) {
      assert.ok(p.endsWith(':read'), `Expected read permission, got: ${p}`);
    }
  });
});

describe('ROLES', () => {
  it('exports a list of known roles', () => {
    assert.ok(Array.isArray(ROLES));
    assert.ok(ROLES.includes('SUPER_ADMIN'));
    assert.ok(ROLES.includes('VIEWER'));
    assert.ok(ROLES.length >= 6);
  });
});
