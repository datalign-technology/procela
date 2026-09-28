// Per-tenant MCP enablement resolver — verifies the up-the-org-tree walk and
// the opt-in (default-off) semantics against the real org store.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { organizations, type StoredOrg } from '../routes/organizations';
import { isMcpEnabledForOrg } from '../mcp/enablement';

const now = new Date().toISOString();
const mk = (id: string, parentId: string | null, over: Partial<StoredOrg> = {}): StoredOrg => ({
  id, parentId, name: id, type: 'company', industry: '', description: '', headCount: 0,
  createdAt: now, updatedAt: now, ...over,
});

// deadfeed-prefixed ids so they can't collide with real/demo rows, and are easy to sweep.
const IDS = ['deadfeed-co-on', 'deadfeed-div-inherit', 'deadfeed-co-off', 'deadfeed-dept-off', 'deadfeed-co-unset'];

describe('isMcpEnabledForOrg', () => {
  before(() => {
    organizations.push(
      mk('deadfeed-co-on', null, { type: 'company', mcpEnabled: true }),
      mk('deadfeed-div-inherit', 'deadfeed-co-on', { type: 'division' }), // inherits true from parent
      mk('deadfeed-co-off', null, { type: 'company', mcpEnabled: false }),
      mk('deadfeed-dept-off', 'deadfeed-co-off', { type: 'department' }), // inherits false
      mk('deadfeed-co-unset', null, { type: 'company' }), // nothing set anywhere → default off
    );
  });
  after(() => {
    for (let i = organizations.length - 1; i >= 0; i--) {
      if (IDS.includes(organizations[i].id)) organizations.splice(i, 1);
    }
  });

  it('returns true for an org that set the flag', () => {
    assert.strictEqual(isMcpEnabledForOrg('deadfeed-co-on'), true);
  });

  it('inherits true from an ancestor that set it', () => {
    assert.strictEqual(isMcpEnabledForOrg('deadfeed-div-inherit'), true);
  });

  it('inherits an explicit false from an ancestor', () => {
    assert.strictEqual(isMcpEnabledForOrg('deadfeed-dept-off'), false);
  });

  it('defaults to off (opt-in) when nothing in the tree sets it', () => {
    assert.strictEqual(isMcpEnabledForOrg('deadfeed-co-unset'), false);
  });

  it('is off for an unknown org and for a nullish id', () => {
    assert.strictEqual(isMcpEnabledForOrg('no-such-org'), false);
    assert.strictEqual(isMcpEnabledForOrg(undefined), false);
    assert.strictEqual(isMcpEnabledForOrg(null), false);
  });
});
