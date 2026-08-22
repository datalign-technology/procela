import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  hasPermission,
  getPermissionsForRole,
  ROLES,
  requireResource,
  actionForMethod,
} from '../lib/permissions';

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

  it('legacy PROCESS_OWNER / DATA_STEWARD are no longer valid roles', () => {
    // These were removed — existing records are migrated to EDITOR on
    // startup. If anyone still has them, hasPermission should return
    // false (unknown role) rather than granting stale permissions.
    assert.strictEqual(hasPermission('PROCESS_OWNER', 'process:read'), false);
    assert.strictEqual(hasPermission('DATA_STEWARD', 'data-asset:read'), false);
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
    assert.ok(ROLES.length >= 5);
  });
});

describe('read/write catalog invariants', () => {
  it('every role is a superset of VIEWER reads (catalog stays readable)', () => {
    const viewerReads = getPermissionsForRole('VIEWER');
    for (const role of ['CONTRIBUTOR', 'EDITOR']) {
      for (const p of viewerReads) {
        assert.ok(hasPermission(role, p), `${role} should inherit VIEWER perm ${p}`);
      }
    }
  });

  it('EDITOR writes the data/system registry but not governance/people/org', () => {
    assert.strictEqual(hasPermission('EDITOR', 'data-asset:write'), true);
    assert.strictEqual(hasPermission('EDITOR', 'system:write'), true);
    assert.strictEqual(hasPermission('EDITOR', 'mapping:write'), true);
    assert.strictEqual(hasPermission('EDITOR', 'connection:write'), true);
    assert.strictEqual(hasPermission('EDITOR', 'governance:write'), false);
    assert.strictEqual(hasPermission('EDITOR', 'people:write'), false);
    assert.strictEqual(hasPermission('EDITOR', 'org:write'), false);
  });

  it('CONTRIBUTOR authors processes + collaboration only', () => {
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'process:write'), true);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'collaboration:write'), true);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'data-asset:write'), false);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'connection:write'), false);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'governance:write'), false);
  });

  it('VIEWER cannot write anything, including collaboration', () => {
    for (const perm of ['process:write', 'data-asset:write', 'collaboration:write', 'connection:write']) {
      assert.strictEqual(hasPermission('VIEWER', perm), false);
    }
  });

  it('skills catalog: read open to all, write is EDITOR+ (not VIEWER/CONTRIBUTOR)', () => {
    for (const role of ['VIEWER', 'CONTRIBUTOR', 'EDITOR', 'ORG_ADMIN', 'SUPER_ADMIN']) {
      assert.strictEqual(hasPermission(role, 'skill:read'), true, `${role} should read skills`);
    }
    assert.strictEqual(hasPermission('VIEWER', 'skill:write'), false);
    assert.strictEqual(hasPermission('CONTRIBUTOR', 'skill:write'), false);
    assert.strictEqual(hasPermission('EDITOR', 'skill:write'), true);
    assert.strictEqual(hasPermission('ORG_ADMIN', 'skill:write'), true);
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'skill:write'), true);
  });

  it('sensitive buckets (agent/audit/admin/backup) are ORG_ADMIN+ only', () => {
    for (const perm of ['agent:read', 'agent:write', 'audit:read', 'admin:write']) {
      assert.strictEqual(hasPermission('VIEWER', perm), false);
      assert.strictEqual(hasPermission('EDITOR', perm), false);
      assert.strictEqual(hasPermission('CONTRIBUTOR', perm), false);
      assert.strictEqual(hasPermission('ORG_ADMIN', perm), true);
      assert.strictEqual(hasPermission('SUPER_ADMIN', perm), true);
    }
    // backup is SUPER-only (no ORG_ADMIN grant)
    assert.strictEqual(hasPermission('ORG_ADMIN', 'backup:write'), false);
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'backup:write'), true);
  });
});

describe('actionForMethod', () => {
  it('maps read verbs to read', () => {
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS']) {
      assert.strictEqual(actionForMethod(m), 'read');
    }
  });
  it('maps mutating verbs to write', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.strictEqual(actionForMethod(m), 'write');
    }
  });
});

describe('requireResource middleware', () => {
  function run(role: string | undefined, method: string, resource: string) {
    const req: any = { method, user: role ? { role } : undefined };
    let captured: any = 'next-not-called';
    const next = (err?: unknown) => { captured = err ?? null; };
    requireResource(resource)(req, {} as any, next);
    return captured;
  }

  it('401s when unauthenticated', () => {
    const err: any = run(undefined, 'GET', 'process');
    assert.strictEqual(err?.statusCode, 401);
  });

  it('lets VIEWER read but 403s VIEWER writes', () => {
    assert.strictEqual(run('VIEWER', 'GET', 'data-asset'), null);
    const err: any = run('VIEWER', 'POST', 'data-asset');
    assert.strictEqual(err?.statusCode, 403);
  });

  it('lets EDITOR write the data registry but 403s governance writes', () => {
    assert.strictEqual(run('EDITOR', 'PUT', 'data-asset'), null);
    const err: any = run('EDITOR', 'POST', 'governance');
    assert.strictEqual(err?.statusCode, 403);
  });

  it('403s a CONTRIBUTOR deleting a connection but allows ORG_ADMIN', () => {
    const err: any = run('CONTRIBUTOR', 'DELETE', 'connection');
    assert.strictEqual(err?.statusCode, 403);
    assert.strictEqual(run('ORG_ADMIN', 'DELETE', 'connection'), null);
  });

  it('hides agent routes from non-admins even on read', () => {
    const err: any = run('EDITOR', 'GET', 'agent');
    assert.strictEqual(err?.statusCode, 403);
    assert.strictEqual(run('ORG_ADMIN', 'GET', 'agent'), null);
  });

  it('skills catalog: VIEWER reads but 403s writes; EDITOR writes; CONTRIBUTOR 403s writes', () => {
    assert.strictEqual(run('VIEWER', 'GET', 'skill'), null);
    assert.strictEqual((run('VIEWER', 'POST', 'skill') as any)?.statusCode, 403);
    assert.strictEqual((run('CONTRIBUTOR', 'DELETE', 'skill') as any)?.statusCode, 403);
    assert.strictEqual(run('EDITOR', 'POST', 'skill'), null);
    assert.strictEqual(run('EDITOR', 'DELETE', 'skill'), null);
  });
});
