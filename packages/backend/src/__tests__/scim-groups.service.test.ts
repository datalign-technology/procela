import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  scimGroups,
  listGroups,
  findGroup,
  findGroupByDisplayName,
  createGroup,
  replaceGroup,
  deleteGroup,
  addMembers,
  removeMembers,
  removeMemberFromAllGroups,
} from '../services/scim-groups';
import { useStoreIsolation } from './_helpers/store-isolation';

// Behavior coverage for the SCIM-groups service after its Postgres-cutover
// conversion to an async, repository-backed module (PR 3). Exercises the
// JSON path via the module's own scimGroups array; useStoreIsolation keeps
// the store file and array clean between tests.
describe('scim-groups service (async, repo-backed)', () => {
  useStoreIsolation({ file: 'scim-groups', memory: scimGroups });

  it('create → find → listGroups → findByDisplayName', async () => {
    const g = await createGroup({ displayName: 'Engineers', members: [{ value: 'p1' }] });
    assert.strictEqual((await findGroup(g.id))?.displayName, 'Engineers');
    assert.strictEqual((await listGroups()).length, 1);
    assert.strictEqual((await findGroupByDisplayName('engineers'))?.id, g.id);
    assert.strictEqual(await findGroup('missing'), null);
  });

  it('replaceGroup updates fields; missing → null', async () => {
    const g = await createGroup({ displayName: 'A' });
    const updated = await replaceGroup(g.id, { displayName: 'B', members: [{ value: 'p1' }] });
    assert.strictEqual(updated?.displayName, 'B');
    assert.deepStrictEqual(updated?.members.map((m) => m.value), ['p1']);
    assert.strictEqual(await replaceGroup('missing', { displayName: 'x' }), null);
  });

  it('addMembers dedupes; removeMembers removes', async () => {
    const g = await createGroup({ displayName: 'A', members: [{ value: 'p1' }] });
    await addMembers(g.id, [{ value: 'p1' }, { value: 'p2' }]); // p1 is a dupe, ignored
    assert.deepStrictEqual((await findGroup(g.id))?.members.map((m) => m.value).sort(), ['p1', 'p2']);
    await removeMembers(g.id, ['p1']);
    assert.deepStrictEqual((await findGroup(g.id))?.members.map((m) => m.value), ['p2']);
  });

  it('removeMemberFromAllGroups strips a person from every group', async () => {
    const g1 = await createGroup({ displayName: 'A', members: [{ value: 'p1' }, { value: 'p2' }] });
    const g2 = await createGroup({ displayName: 'B', members: [{ value: 'p1' }] });
    await removeMemberFromAllGroups('p1');
    assert.deepStrictEqual((await findGroup(g1.id))?.members.map((m) => m.value), ['p2']);
    assert.deepStrictEqual((await findGroup(g2.id))?.members.map((m) => m.value), []);
  });

  it('deleteGroup removes; missing → false', async () => {
    const g = await createGroup({ displayName: 'A' });
    assert.strictEqual(await deleteGroup(g.id), true);
    assert.strictEqual(await findGroup(g.id), null);
    assert.strictEqual(await deleteGroup(g.id), false);
  });
});
