import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { organizations, StoredOrg } from '../routes/organizations';
import { people, getVisibleOrgIds, canAccessOrg, StoredPerson } from '../routes/people';

// ── Fixtures ──
// Mirrors the Momentum Industries structure used in test-data/organizations.csv
// so we can verify that a user scoped to "Momentum Tidewater Shipyard" sees
// only Tidewater and its descendants.

const TEST_IDS = {
  MOMENTUM: 'test-momentum',
  TIDEWATER: 'test-tidewater',
  TIDEWATER_CARRIER: 'test-tidewater-carrier',
  TIDEWATER_SUB: 'test-tidewater-sub',
  GULF: 'test-gulf',
  GULF_SURFACE: 'test-gulf-surface',
  MISSION: 'test-mission',
};

const FIXTURE_ORGS: StoredOrg[] = [
  { id: TEST_IDS.MOMENTUM, parentId: null, name: 'Momentum Industries', type: 'company', industry: 'Defense', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.TIDEWATER, parentId: TEST_IDS.MOMENTUM, name: 'Momentum Tidewater Shipyard', type: 'division', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.TIDEWATER_CARRIER, parentId: TEST_IDS.TIDEWATER, name: 'Carrier Construction', type: 'department', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.TIDEWATER_SUB, parentId: TEST_IDS.TIDEWATER, name: 'Submarine Construction', type: 'department', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.GULF, parentId: TEST_IDS.MOMENTUM, name: 'Momentum Gulf Shipyard', type: 'division', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.GULF_SURFACE, parentId: TEST_IDS.GULF, name: 'Surface Combatants', type: 'department', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
  { id: TEST_IDS.MISSION, parentId: TEST_IDS.MOMENTUM, name: 'Mission Technologies', type: 'division', industry: '', description: '', headCount: 0, createdAt: '', updatedAt: '' },
];

const FIXTURE_PEOPLE: StoredPerson[] = [
  { id: 'p-tidewater-admin', orgIds: [TEST_IDS.TIDEWATER], accessibleOrgIds: [], name: 'Tidewater Admin', email: 'tidewater-admin@test.com', role: 'ORG_ADMIN', title: '', skillIds: [], createdAt: '', updatedAt: '' },
  { id: 'p-tidewater-viewer', orgIds: [TEST_IDS.TIDEWATER], accessibleOrgIds: [], name: 'Tidewater Viewer', email: 'tidewater-viewer@test.com', role: 'VIEWER', title: '', skillIds: [], createdAt: '', updatedAt: '' },
  { id: 'p-momentum-admin', orgIds: [TEST_IDS.MOMENTUM], accessibleOrgIds: [], name: 'Momentum Admin', email: 'momentum-admin@test.com', role: 'ORG_ADMIN', title: '', skillIds: [], createdAt: '', updatedAt: '' },
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
      const visible = getVisibleOrgIds({ email: 'tidewater-admin@test.com', role: 'ORG_ADMIN' });
      assert.ok(visible, 'expected restricted set');
      assert.ok(visible!.has(TEST_IDS.TIDEWATER), 'Tidewater itself should be visible');
      assert.ok(visible!.has(TEST_IDS.TIDEWATER_CARRIER), 'Carrier Construction should be visible');
      assert.ok(visible!.has(TEST_IDS.TIDEWATER_SUB), 'Submarine Construction should be visible');
      assert.ok(!visible!.has(TEST_IDS.MOMENTUM), 'parent company must not be visible');
      assert.ok(!visible!.has(TEST_IDS.GULF), 'sibling division Gulf must not be visible');
      assert.ok(!visible!.has(TEST_IDS.GULF_SURFACE), "sibling division's descendant must not be visible");
      assert.ok(!visible!.has(TEST_IDS.MISSION), 'unrelated sibling division must not be visible');
    });

    it('scopes a non-admin at a division to that division plus its descendants', () => {
      const visible = getVisibleOrgIds({ email: 'tidewater-viewer@test.com', role: 'VIEWER' });
      assert.ok(visible);
      assert.ok(visible!.has(TEST_IDS.TIDEWATER));
      assert.ok(visible!.has(TEST_IDS.TIDEWATER_CARRIER));
      assert.ok(!visible!.has(TEST_IDS.GULF));
    });

    it('expands an ORG_ADMIN at a company to the whole subtree', () => {
      const visible = getVisibleOrgIds({ email: 'momentum-admin@test.com', role: 'ORG_ADMIN' });
      assert.ok(visible);
      assert.ok(visible!.has(TEST_IDS.MOMENTUM));
      assert.ok(visible!.has(TEST_IDS.TIDEWATER));
      assert.ok(visible!.has(TEST_IDS.TIDEWATER_CARRIER));
      assert.ok(visible!.has(TEST_IDS.GULF));
      assert.ok(visible!.has(TEST_IDS.GULF_SURFACE));
      assert.ok(visible!.has(TEST_IDS.MISSION));
    });
  });

  describe('canAccessOrg', () => {
    it('allows anything for unrestricted users', () => {
      assert.strictEqual(canAccessOrg({ email: 'super@test.com', role: 'SUPER_ADMIN' }, TEST_IDS.GULF), true);
    });

    it('denies out-of-scope orgs for restricted users', () => {
      const user = { email: 'tidewater-admin@test.com', role: 'ORG_ADMIN' };
      assert.strictEqual(canAccessOrg(user, TEST_IDS.TIDEWATER), true);
      assert.strictEqual(canAccessOrg(user, TEST_IDS.TIDEWATER_CARRIER), true);
      assert.strictEqual(canAccessOrg(user, TEST_IDS.GULF), false);
      assert.strictEqual(canAccessOrg(user, TEST_IDS.MOMENTUM), false);
    });
  });
});
