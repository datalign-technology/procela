import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { organizations, StoredOrg } from '../routes/organizations';
import { people, getVisibleOrgIds, canAccessOrg, StoredPerson } from '../routes/people';

// ── Fixtures ──
// Mirrors the Huntington Ingalls structure used in test-data/organizations.csv
// so we can verify that a user scoped to "Newport News Shipbuilding" sees
// only NNS and its descendants.

const TEST_IDS = {
  HII: 'test-hii',
  NNS: 'test-nns',
  NNS_CARRIER: 'test-nns-carrier',
  NNS_SUB: 'test-nns-sub',
  INGALLS: 'test-ingalls',
  INGALLS_SURFACE: 'test-ingalls-surface',
  MISSION: 'test-mission',
};

const FIXTURE_ORGS: StoredOrg[] = [
  { id: TEST_IDS.HII, parentId: null, name: 'Huntington Ingalls Industries', type: 'company', industry: 'Defense', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.NNS, parentId: TEST_IDS.HII, name: 'Newport News Shipbuilding', type: 'division', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.NNS_CARRIER, parentId: TEST_IDS.NNS, name: 'Carrier Construction', type: 'department', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.NNS_SUB, parentId: TEST_IDS.NNS, name: 'Submarine Construction', type: 'department', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.INGALLS, parentId: TEST_IDS.HII, name: 'Ingalls Shipbuilding', type: 'division', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.INGALLS_SURFACE, parentId: TEST_IDS.INGALLS, name: 'Surface Combatants', type: 'department', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.MISSION, parentId: TEST_IDS.HII, name: 'Mission Technologies', type: 'division', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
];

const FIXTURE_PEOPLE: StoredPerson[] = [
  { id: 'p-nns-admin', orgIds: [TEST_IDS.NNS], accessibleOrgIds: [], name: 'NNS Admin', email: 'nns-admin@test.com', role: 'ORG_ADMIN', title: '', skillIds: [], createdAt: '', updatedAt: '' },
  { id: 'p-nns-viewer', orgIds: [TEST_IDS.NNS], accessibleOrgIds: [], name: 'NNS Viewer', email: 'nns-viewer@test.com', role: 'VIEWER', title: '', skillIds: [], createdAt: '', updatedAt: '' },
  { id: 'p-hii-admin', orgIds: [TEST_IDS.HII], accessibleOrgIds: [], name: 'HII Admin', email: 'hii-admin@test.com', role: 'ORG_ADMIN', title: '', skillIds: [], createdAt: '', updatedAt: '' },
  { id: 'p-super', orgIds: [], accessibleOrgIds: [], name: 'Super', email: 'super@test.com', role: 'SUPER_ADMIN', title: '', skillIds: [], createdAt: '', updatedAt: '' },
];

describe('org access scoping', () => {
  // Snapshots so we can restore module-level state after the suite runs.
  const orgsSnapshot: StoredOrg[] = [];
  const peopleSnapshot: StoredPerson[] = [];

  before(() => {
    orgsSnapshot.push(...organizations);
    peopleSnapshot.push(...people);
    organizations.length = 0;
    organizations.push(...FIXTURE_ORGS);
    people.length = 0;
    people.push(...FIXTURE_PEOPLE);
  });

  after(() => {
    organizations.length = 0;
    organizations.push(...orgsSnapshot);
    people.length = 0;
    people.push(...peopleSnapshot);
  });

  describe('getVisibleOrgIds', () => {
    it('returns null (unrestricted) when user has SUPER_ADMIN role in the token', () => {
      const visible = getVisibleOrgIds({ email: 'anyone@test.com', role: 'SUPER_ADMIN' });
      assert.strictEqual(visible, null);
    });

    it('returns null (unrestricted) when no people record matches (dev fallback)', () => {
      const visible = getVisibleOrgIds({ email: 'ghost@test.com', role: 'VIEWER' });
      assert.strictEqual(visible, null);
    });

    it('returns null (unrestricted) when the matched person is SUPER_ADMIN', () => {
      const visible = getVisibleOrgIds({ email: 'super@test.com', role: 'VIEWER' });
      assert.strictEqual(visible, null);
    });

    it('scopes an ORG_ADMIN at a division to that division plus its descendants', () => {
      const visible = getVisibleOrgIds({ email: 'nns-admin@test.com', role: 'ORG_ADMIN' });
      assert.ok(visible, 'expected restricted set');
      assert.ok(visible!.has(TEST_IDS.NNS), 'NNS itself should be visible');
      assert.ok(visible!.has(TEST_IDS.NNS_CARRIER), 'Carrier Construction should be visible');
      assert.ok(visible!.has(TEST_IDS.NNS_SUB), 'Submarine Construction should be visible');
      assert.ok(!visible!.has(TEST_IDS.HII), 'parent HII must not be visible');
      assert.ok(!visible!.has(TEST_IDS.INGALLS), 'sibling division Ingalls must not be visible');
      assert.ok(!visible!.has(TEST_IDS.INGALLS_SURFACE), "sibling division's descendant must not be visible");
      assert.ok(!visible!.has(TEST_IDS.MISSION), 'unrelated sibling division must not be visible');
    });

    it('scopes a non-admin at a division to that division plus its descendants', () => {
      const visible = getVisibleOrgIds({ email: 'nns-viewer@test.com', role: 'VIEWER' });
      assert.ok(visible);
      assert.ok(visible!.has(TEST_IDS.NNS));
      assert.ok(visible!.has(TEST_IDS.NNS_CARRIER));
      assert.ok(!visible!.has(TEST_IDS.INGALLS));
    });

    it('expands an ORG_ADMIN at a company to the whole subtree', () => {
      const visible = getVisibleOrgIds({ email: 'hii-admin@test.com', role: 'ORG_ADMIN' });
      assert.ok(visible);
      assert.ok(visible!.has(TEST_IDS.HII));
      assert.ok(visible!.has(TEST_IDS.NNS));
      assert.ok(visible!.has(TEST_IDS.NNS_CARRIER));
      assert.ok(visible!.has(TEST_IDS.INGALLS));
      assert.ok(visible!.has(TEST_IDS.INGALLS_SURFACE));
      assert.ok(visible!.has(TEST_IDS.MISSION));
    });
  });

  describe('canAccessOrg', () => {
    it('allows anything for unrestricted users', () => {
      assert.strictEqual(canAccessOrg({ email: 'super@test.com', role: 'SUPER_ADMIN' }, TEST_IDS.INGALLS), true);
    });

    it('denies out-of-scope orgs for restricted users', () => {
      const user = { email: 'nns-admin@test.com', role: 'ORG_ADMIN' };
      assert.strictEqual(canAccessOrg(user, TEST_IDS.NNS), true);
      assert.strictEqual(canAccessOrg(user, TEST_IDS.NNS_CARRIER), true);
      assert.strictEqual(canAccessOrg(user, TEST_IDS.INGALLS), false);
      assert.strictEqual(canAccessOrg(user, TEST_IDS.HII), false);
    });
  });
});
