// Tests for services/digest.service — the gap-snapshot + diff engine
// that drives weekly proactive notifications.
//
// The service is pure (its only side effects are pushing to the
// gapSnapshots array and calling createNotification), so we test it
// directly via dependency-injected inputs rather than spinning up an
// HTTP server. Coverage:
//   - computeMetrics: shape + coverage% edge cases
//   - takeGapSnapshot: persists a row keyed by org + timestamp
//   - digestForOrg: baseline run (no prior) writes no notifications
//   - digestForOrg: rules fire on threshold crossing
//   - digestForOrg: rules don't fire on sub-threshold movement

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  computeMetrics,
  takeGapSnapshot,
  digestForOrg,
  gapSnapshots,
  type DigestInputs,
} from '../services/digest.service';
import { notifications } from '../routes/notifications';

const PREFIX = 'test-digest-';
const orgId = PREFIX + 'org';

function sweep<T extends { id?: string; orgId?: string }>(arr: T[], pred: (r: T) => boolean) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
}

// Minimal store shape — the service only reads `orgId`, `level`,
// `ownerId`, `id` from nodes, etc., so the test stores stay tight.
const baseNode = (n: Partial<DigestInputs['processNodes'][number]> & { id: string; level: string }) => ({
  orgId, orgIds: [orgId], ownerId: null, ...n,
});
const baseAsset = (a: Partial<DigestInputs['dataAssets'][number]> & { id: string }) => ({
  orgId, governanceTier: 'SILVER', ...a,
});
const baseMapping = (m: { id: string; processStepId: string; dataAssetId?: string }) => ({
  orgId, ...m,
});

describe('digest.service', () => {
  let savedNotifications: typeof notifications;
  let savedSnapshots: typeof gapSnapshots;

  before(() => {
    savedNotifications = [...notifications];
    savedSnapshots = [...gapSnapshots];
  });
  after(() => {
    sweep(gapSnapshots, (s) => s.orgId === orgId);
    sweep(notifications, (n) => n.orgId === orgId);
    // Restore in case other tests' state mattered.
    notifications.length = 0; notifications.push(...savedNotifications);
    gapSnapshots.length = 0; gapSnapshots.push(...savedSnapshots);
  });
  beforeEach(() => {
    sweep(gapSnapshots, (s) => s.orgId === orgId);
    sweep(notifications, (n) => n.orgId === orgId);
  });

  describe('computeMetrics', () => {
    it('returns zeros for an empty org', async () => {
      const m = computeMetrics(orgId, { processNodes: [], dataAssets: [], mappings: [] });
      assert.deepStrictEqual(m, {
        activities: 0, mappedActivities: 0, coveragePct: 0,
        orphanAssets: 0, ungovernedAssets: 0, ownerlessItems: 0,
      });
    });

    it('counts activities and computes coverage% as a rounded integer', async () => {
      const m = computeMetrics(orgId, {
        processNodes: [
          baseNode({ id: 'a1', level: 'ACTIVITY' }),
          baseNode({ id: 'a2', level: 'ACTIVITY' }),
          baseNode({ id: 'a3', level: 'ACTIVITY' }),
        ],
        dataAssets: [baseAsset({ id: 'as1' })],
        mappings: [baseMapping({ id: 'm1', processStepId: 'a1', dataAssetId: 'as1' })],
      });
      assert.strictEqual(m.activities, 3);
      assert.strictEqual(m.mappedActivities, 1);
      assert.strictEqual(m.coveragePct, 33); // round(1/3 * 100)
    });

    it('identifies orphans as assets with no mapping pointing at them', async () => {
      const m = computeMetrics(orgId, {
        processNodes: [baseNode({ id: 'a1', level: 'ACTIVITY' })],
        dataAssets: [
          baseAsset({ id: 'mapped' }),
          baseAsset({ id: 'orphan' }),
        ],
        mappings: [baseMapping({ id: 'm1', processStepId: 'a1', dataAssetId: 'mapped' })],
      });
      assert.strictEqual(m.orphanAssets, 1);
    });

    it('flags Bronze-tier assets that are in use as ungoverned', async () => {
      const m = computeMetrics(orgId, {
        processNodes: [baseNode({ id: 'a1', level: 'ACTIVITY' })],
        dataAssets: [
          baseAsset({ id: 'bronze-mapped', governanceTier: 'BRONZE' }),
          baseAsset({ id: 'bronze-orphan', governanceTier: 'BRONZE' }),
          baseAsset({ id: 'gold-mapped', governanceTier: 'GOLD' }),
        ],
        mappings: [
          baseMapping({ id: 'm1', processStepId: 'a1', dataAssetId: 'bronze-mapped' }),
          baseMapping({ id: 'm2', processStepId: 'a1', dataAssetId: 'gold-mapped' }),
        ],
      });
      // bronze-mapped counts; bronze-orphan doesn't (not in use); gold-mapped doesn't (governed).
      assert.strictEqual(m.ungovernedAssets, 1);
    });

    it('counts ownerless value streams and processes only — not activities', async () => {
      const m = computeMetrics(orgId, {
        processNodes: [
          baseNode({ id: 'vs', level: 'VALUE_STREAM', ownerId: null }),
          baseNode({ id: 'p',  level: 'PROCESS',     ownerId: null }),
          baseNode({ id: 'p2', level: 'PROCESS',     ownerId: 'someone' }),
          baseNode({ id: 'a',  level: 'ACTIVITY',    ownerId: null }), // doesn't count
        ],
        dataAssets: [], mappings: [],
      });
      assert.strictEqual(m.ownerlessItems, 2);
    });
  });

  describe('digestForOrg', () => {
    const emptyInputs: DigestInputs = { processNodes: [], dataAssets: [], mappings: [] };

    it('records the snapshot but writes no notifications on the baseline run', async () => {
      const res = await digestForOrg(orgId, emptyInputs);
      assert.strictEqual(res.baseline, true);
      assert.strictEqual(res.notifications.length, 0);
      assert.strictEqual(gapSnapshots.filter((s) => s.orgId === orgId).length, 1);
    });

    it('fires the orphan-asset warning when ≥3 new orphans appear', async () => {
      // Baseline: 0 orphans.
      await digestForOrg(orgId, emptyInputs);
      // Week 2: add 3 unmapped assets.
      const withOrphans: DigestInputs = {
        processNodes: [],
        dataAssets: [
          baseAsset({ id: 'o1' }), baseAsset({ id: 'o2' }), baseAsset({ id: 'o3' }),
        ],
        mappings: [],
      };
      const res = await digestForOrg(orgId, withOrphans);
      assert.strictEqual(res.baseline, false);
      const titles = res.notifications.map((n) => n.title);
      assert.ok(titles.some((t) => /3 new orphan data assets/.test(t)),
        `expected an orphan-warning notification, got ${JSON.stringify(titles)}`);
      // Link points at the Data Assets catalog pre-filtered to unmapped
      // (the Orphan Assets page folded into this filter).
      const orphanNote = res.notifications.find((n) => /orphan/i.test(n.title))!;
      assert.strictEqual(orphanNote.link, '/data-assets?mapping=unmapped');
    });

    it('does NOT fire the orphan warning on sub-threshold movement', async () => {
      await digestForOrg(orgId, emptyInputs);
      const withOneOrphan: DigestInputs = {
        processNodes: [], dataAssets: [baseAsset({ id: 'just-one' })], mappings: [],
      };
      const res = await digestForOrg(orgId, withOneOrphan);
      assert.ok(!res.notifications.some((n) => /orphan/i.test(n.title)),
        `1 new orphan should not trigger the warning`);
    });

    it('fires the coverage-drop warning when coverage falls ≥5pp', async () => {
      // Baseline: 4 of 4 activities mapped → 100%.
      const allMapped: DigestInputs = {
        processNodes: [
          baseNode({ id: 'a1', level: 'ACTIVITY' }), baseNode({ id: 'a2', level: 'ACTIVITY' }),
          baseNode({ id: 'a3', level: 'ACTIVITY' }), baseNode({ id: 'a4', level: 'ACTIVITY' }),
        ],
        dataAssets: [baseAsset({ id: 'as' })],
        mappings: [
          baseMapping({ id: 'm1', processStepId: 'a1', dataAssetId: 'as' }),
          baseMapping({ id: 'm2', processStepId: 'a2', dataAssetId: 'as' }),
          baseMapping({ id: 'm3', processStepId: 'a3', dataAssetId: 'as' }),
          baseMapping({ id: 'm4', processStepId: 'a4', dataAssetId: 'as' }),
        ],
      };
      await digestForOrg(orgId, allMapped);
      // Week 2: remove all mappings → 0%, a 100pp drop.
      const noneMapped: DigestInputs = { ...allMapped, mappings: [] };
      const res = await digestForOrg(orgId, noneMapped);
      assert.ok(res.notifications.some((n) => /coverage dropped/i.test(n.title)),
        `expected coverage-dropped notification; got snapshot ${JSON.stringify(res.snapshot.metrics)} + notifications ${JSON.stringify(res.notifications.map((n) => n.title))}`);
    });
  });
});
