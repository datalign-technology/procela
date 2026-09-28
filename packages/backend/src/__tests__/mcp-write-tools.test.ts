// Write MCP tools — logic, per-tool RBAC (assertWrite), org-authorization,
// transition/validation rules, and before/after audit, tested with an injected
// fake session + fake catalog + fake persistence (no live store).

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildWriteTools } from '../mcp/write-tools';
import type { Session } from '../mcp/identity';
import type { OrgCatalog } from '../mcp/catalog';
import type { OrgStatusMode } from '../mcp/mutations';
import { McpError, RPC } from '../mcp/protocol';

interface AuditRow { orgId: string; entityType: string; entityId: string; action: string; before: object | null; after: object | null }

function makeSession() {
  const audited: AuditRow[] = [];
  let denyPerm: string | null = null;
  let denyOrg: string | null = null;
  let mcpDisabled = false;
  const session: Session = {
    user: { sub: 'u1', email: 'a@b.c', orgId: 'org1', role: 'EDITOR' } as Session['user'],
    defaultOrgId: 'org1',
    resolveOrg(arg) {
      const o = typeof arg === 'string' && arg.trim() ? arg.trim() : 'org1';
      if (denyOrg && o === denyOrg) throw new McpError('Not found.', RPC.INVALID_PARAMS);
      return o;
    },
    assertMcpEnabled() { if (mcpDisabled) throw new McpError('MCP not enabled for this organization.', RPC.INVALID_REQUEST); },
    assertRead() { /* not used by write tools */ },
    assertWrite(p) { if (denyPerm && p === denyPerm) throw new McpError(`cannot modify ${p.split(':')[0]}`, RPC.INVALID_REQUEST); },
    audit() { /* reads only */ },
    auditWrite(orgId, entityType, entityId, action, before, after) { audited.push({ orgId, entityType, entityId, action, before, after }); },
  };
  return { session, audited, denyPermFn: (p: string) => { denyPerm = p; }, denyOrgFn: (o: string) => { denyOrg = o; }, disableMcpFn: () => { mcpDisabled = true; } };
}

function fakeCatalog(): OrgCatalog {
  const names: Record<string, string> = { patOwner: 'Pat Owner', newOwner: 'Nadia New', steward1: 'Sam Steward' };
  const cat = {
    orgId: 'org1',
    nodes: [
      { id: 'vs1', parentId: null, level: 'VALUE_STREAM', name: 'Water Distribution', status: 'DRAFT', orderIndex: 0, ownerId: 'patOwner' },
      { id: 'p1', parentId: 'vs1', level: 'PROCESS', name: 'Treatment', status: 'ACTIVE', orderIndex: 0, ownerId: null },
      { id: 'p2', parentId: 'vs1', level: 'PROCESS', name: 'In Review', status: 'PENDING_REVIEW', orderIndex: 1, ownerId: null },
    ],
    assets: [{ id: 'as1', name: 'Customer Master', governanceTier: 'GOLD', ownerPersonId: 'patOwner', stewardIds: ['steward1'], healthScore: 90, systemId: 'sy1' }],
    systems: [{ id: 'sy1', name: 'CIS', ownerPersonId: 'patOwner' }],
    domains: [{ id: 'dm1', name: 'Customer Data', ownerId: null, stewardIds: [], dataAssetIds: ['as1'] }],
    mappings: [],
    nameOf: (id: string | null | undefined) => (id ? names[id] ?? null : null),
    healthOf: (a: { healthScore: number }) => ({ score: a.healthScore, measured: true }),
  };
  return cat as unknown as OrgCatalog;
}

function tools(over: Partial<Parameters<typeof buildWriteTools>[0]> = {}, mode: OrgStatusMode = 'simple') {
  const { session, audited, denyPermFn, denyOrgFn, disableMcpFn } = makeSession();
  const owned: Record<string, string | null> = {};
  const statuses: Record<string, string> = {};
  const created: unknown[] = [];
  const list = buildWriteTools({
    session,
    loadCatalog: async () => fakeCatalog(),
    updateEntityOwner: async (_t, id, ownerId) => { owned[id] = ownerId; return { id, name: id === 'as1' ? 'Customer Master' : id }; },
    updateNodeStatus: async (id, status) => { statuses[id] = status; return { id, name: id === 'vs1' ? 'Water Distribution' : id, status } as never; },
    createTask: async (task) => { created.push(task); return task; },
    statusModeOf: () => mode,
    ...over,
  });
  const byName = Object.fromEntries(list.map((t) => [t.name, t]));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await byName[name].handler(args);
    return { res, data: JSON.parse(res.content[0].text) };
  };
  return { byName, call, audited, owned, statuses, created, denyPermFn, denyOrgFn, disableMcpFn };
}

describe('write MCP tools — registration & annotations', () => {
  it('registers the three write tools, each with non-read-only annotations', () => {
    const { byName } = tools();
    assert.deepStrictEqual(Object.keys(byName).sort(), ['assign_owner', 'create_task', 'set_status']);
    assert.strictEqual(byName.assign_owner.annotations?.readOnlyHint, false);
    assert.strictEqual(byName.assign_owner.annotations?.destructiveHint, true);
    assert.strictEqual(byName.set_status.annotations?.destructiveHint, true);
    assert.strictEqual(byName.create_task.annotations?.destructiveHint, false);
  });
});

describe('assign_owner', () => {
  it('assigns a new owner, persists it, and audits before/after', async () => {
    const t = tools();
    const { data } = await t.call('assign_owner', { entityType: 'process', entityId: 'p1', ownerId: 'newOwner' });
    assert.strictEqual(data.changed, true);
    assert.strictEqual(data.owner.name, 'Nadia New');
    assert.strictEqual(t.owned.p1, 'newOwner');
    assert.deepStrictEqual(t.audited[0], { orgId: 'org1', entityType: 'ProcessNode', entityId: 'p1', action: 'MCP_ASSIGN_OWNER', before: { ownerId: null }, after: { ownerId: 'newOwner' } });
  });

  it('maps asset owner to the ownerPersonId field + DataAsset audit type', async () => {
    const t = tools();
    const { data } = await t.call('assign_owner', { entityType: 'asset', entityId: 'as1', ownerId: 'newOwner' });
    assert.strictEqual(data.previousOwner.name, 'Pat Owner');
    assert.strictEqual(t.audited[0].entityType, 'DataAsset');
  });

  it('is a no-op (no audit) when the owner is unchanged', async () => {
    const t = tools();
    const { data } = await t.call('assign_owner', { entityType: 'asset', entityId: 'as1', ownerId: 'patOwner' });
    assert.strictEqual(data.changed, false);
    assert.strictEqual(t.audited.length, 0);
  });

  it('rejects an owner who is not a person in the org', async () => {
    await assert.rejects(() => tools().call('assign_owner', { entityType: 'process', entityId: 'p1', ownerId: 'ghost' }), /No such person/);
  });

  it('rejects an unknown entity as not-found', async () => {
    await assert.rejects(() => tools().call('assign_owner', { entityType: 'system', entityId: 'nope', ownerId: 'newOwner' }), /No such system/);
  });

  it('is refused when the role lacks the write permission', async () => {
    const t = tools();
    t.denyPermFn('data-asset:write');
    await assert.rejects(() => t.call('assign_owner', { entityType: 'asset', entityId: 'as1', ownerId: 'newOwner' }), /cannot modify/);
  });
});

describe('set_status', () => {
  it('changes a plain status along an allowed transition and audits it', async () => {
    const t = tools();
    const { data } = await t.call('set_status', { nodeId: 'vs1', status: 'ACTIVE' });
    assert.strictEqual(data.previousStatus, 'DRAFT');
    assert.strictEqual(data.status, 'ACTIVE');
    assert.strictEqual(t.statuses.vs1, 'ACTIVE');
    assert.strictEqual(t.audited[0].action, 'MCP_SET_STATUS');
  });

  it('rejects a transition the org status mode does not allow (review mode: DRAFT→ACTIVE)', async () => {
    const t = tools({}, 'review');
    await assert.rejects(() => t.call('set_status', { nodeId: 'vs1', status: 'ACTIVE' }), /Cannot change status/);
  });

  it('rejects a non-plain target status', async () => {
    await assert.rejects(() => tools().call('set_status', { nodeId: 'vs1', status: 'PENDING_REVIEW' }), /DRAFT, ACTIVE, DEPRECATED/);
  });

  it('refuses to touch a node currently in a review state', async () => {
    await assert.rejects(() => tools().call('set_status', { nodeId: 'p2', status: 'ACTIVE' }), /review workflow in the app/);
  });

  it('is a no-op when already in the target status', async () => {
    const t = tools();
    const { data } = await t.call('set_status', { nodeId: 'p1', status: 'ACTIVE' });
    assert.strictEqual(data.changed, false);
    assert.strictEqual(t.audited.length, 0);
  });

  it('is refused when the role lacks process:write', async () => {
    const t = tools();
    t.denyPermFn('process:write');
    await assert.rejects(() => t.call('set_status', { nodeId: 'vs1', status: 'ACTIVE' }), /cannot modify/);
  });
});

describe('create_task', () => {
  it('creates a governance task with defaults and audits the creation', async () => {
    const t = tools();
    const { data } = await t.call('create_task', { title: 'Review Customer Master' });
    assert.strictEqual(data.title, 'Review Customer Master');
    assert.strictEqual(data.taskType, 'GENERAL');
    assert.strictEqual(data.priority, 'MEDIUM');
    assert.strictEqual(data.status, 'OPEN');
    assert.strictEqual(t.created.length, 1);
    assert.strictEqual(t.audited[0].action, 'MCP_CREATE_TASK');
    assert.strictEqual((t.audited[0].after as { createdBy: string }).createdBy, 'u1');
  });

  it('honours taskType, priority, and a valid assignee', async () => {
    const t = tools();
    const { data } = await t.call('create_task', { title: 'Fix DQ', taskType: 'REMEDIATION', priority: 'HIGH', assigneeId: 'newOwner' });
    assert.strictEqual(data.taskType, 'REMEDIATION');
    assert.strictEqual(data.priority, 'HIGH');
    assert.strictEqual(data.assignee.name, 'Nadia New');
  });

  it('rejects an invalid taskType', async () => {
    await assert.rejects(() => tools().call('create_task', { title: 'x', taskType: 'BOGUS' }), /taskType must be one of/);
  });

  it('rejects an assignee who is not in the org', async () => {
    await assert.rejects(() => tools().call('create_task', { title: 'x', assigneeId: 'ghost' }), /No such person/);
  });

  it('requires a title', async () => {
    await assert.rejects(() => tools().call('create_task', {}), /title is required/);
  });

  it('is refused when the role lacks governance:write', async () => {
    const t = tools();
    t.denyPermFn('governance:write');
    await assert.rejects(() => t.call('create_task', { title: 'x' }), /cannot modify/);
  });
});

describe('write tools — per-tenant enablement', () => {
  it('a write is refused (and not audited) when the org has not enabled MCP', async () => {
    const t = tools();
    t.disableMcpFn();
    await assert.rejects(() => t.call('assign_owner', { entityType: 'process', entityId: 'p1', ownerId: 'newOwner' }), /not enabled/);
    assert.strictEqual(t.audited.length, 0);
  });
});
