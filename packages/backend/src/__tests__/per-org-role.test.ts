import { describe, it } from 'node:test';
import assert from 'node:assert';

import { getRoleForOrg, type StoredPerson } from '../routes/people';

// Per-org role resolution — the bridge between the data model
// (orgRoles[]) and what the access token actually carries. Critical
// path: anything that gates authorisation in the API ends up reading
// this value, so a regression here silently elevates or demotes users.

function person(overrides: Partial<StoredPerson> = {}): StoredPerson {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    orgIds: ['org-a', 'org-b'],
    accessibleOrgIds: ['org-a', 'org-b'],
    name: 'Test',
    email: 'test@example.com',
    role: 'VIEWER',
    title: '',
    skillIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('getRoleForOrg', () => {
  it('returns the default role when no org is passed', () => {
    assert.strictEqual(getRoleForOrg(person({ role: 'CONTRIBUTOR' })), 'CONTRIBUTOR');
  });

  it('returns the default role when orgRoles is absent', () => {
    const p = person({ role: 'CONTRIBUTOR' });
    assert.strictEqual(getRoleForOrg(p, 'org-a'), 'CONTRIBUTOR');
  });

  it('returns the default role when no matching orgRoles entry exists', () => {
    const p = person({
      role: 'VIEWER',
      orgRoles: [{ orgId: 'org-z', role: 'ORG_ADMIN' }],
    });
    assert.strictEqual(getRoleForOrg(p, 'org-a'), 'VIEWER');
  });

  it('returns the override when an orgRoles entry matches', () => {
    const p = person({
      role: 'VIEWER',
      orgRoles: [{ orgId: 'org-a', role: 'PROCESS_OWNER' }],
    });
    assert.strictEqual(getRoleForOrg(p, 'org-a'), 'PROCESS_OWNER');
  });

  it('returns different roles for different orgs on the same person', () => {
    const p = person({
      role: 'VIEWER',
      orgRoles: [
        { orgId: 'org-a', role: 'ORG_ADMIN' },
        { orgId: 'org-b', role: 'CONTRIBUTOR' },
      ],
    });
    assert.strictEqual(getRoleForOrg(p, 'org-a'), 'ORG_ADMIN');
    assert.strictEqual(getRoleForOrg(p, 'org-b'), 'CONTRIBUTOR');
  });

  it('NEVER demotes a SUPER_ADMIN via an orgRoles entry (defence in depth)', () => {
    // If a misconfigured admin pushed { orgId: x, role: VIEWER } onto
    // a super-admin, the system should still treat them as SUPER_ADMIN.
    const p = person({
      role: 'SUPER_ADMIN',
      orgRoles: [{ orgId: 'org-a', role: 'VIEWER' }],
    });
    assert.strictEqual(getRoleForOrg(p, 'org-a'), 'SUPER_ADMIN');
  });

  it('treats null / empty orgId as "use the default"', () => {
    const p = person({
      role: 'VIEWER',
      orgRoles: [{ orgId: 'org-a', role: 'ORG_ADMIN' }],
    });
    assert.strictEqual(getRoleForOrg(p, null), 'VIEWER');
    assert.strictEqual(getRoleForOrg(p, ''), 'VIEWER');
  });
});
