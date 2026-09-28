// MCP session identity — round-trips a real signed token through createSession
// and checks the org-authorization / RBAC / audit wiring against the real
// backend primitives (jwt-signer, permissions, auditService). Also covers the
// service-principal path (revocable, explicitly org-scoped, role-capped).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { sign } from '../services/jwt-signer';
import { createSession } from '../mcp/identity';
import { organizations, type StoredOrg } from '../routes/organizations';
import { servicePrincipals, type StoredServicePrincipal } from '../routes/service-principals';

const token = (over: Record<string, unknown> = {}) =>
  sign({ sub: 'u-mcp-1', email: 'mcp@tidewater.test', orgId: 'org-mcp-1', role: 'VIEWER', type: 'access', ...over }, { expiresIn: '5m' });

describe('createSession — human token', () => {
  it('verifies a valid token and exposes the caller identity', async () => {
    const s = await createSession(token());
    assert.strictEqual(s.user.sub, 'u-mcp-1');
    assert.strictEqual(s.defaultOrgId, 'org-mcp-1');
  });

  it('rejects a malformed / unsigned token', async () => {
    await assert.rejects(() => createSession('not-a-jwt'));
  });

  it('resolveOrg defaults to the caller org and returns it', async () => {
    const s = await createSession(token());
    assert.strictEqual(s.resolveOrg(undefined), 'org-mcp-1');
    assert.strictEqual(s.resolveOrg('org-mcp-1'), 'org-mcp-1');
  });

  it('assertRead allows a VIEWER to read the base resources but not elevated ones', async () => {
    const s = await createSession(token());
    assert.doesNotThrow(() => s.assertRead('process:read'));
    assert.doesNotThrow(() => s.assertRead('data-asset:read'));
    assert.throws(() => s.assertRead('audit:read'), /cannot read audit/);
  });

  it('audit() does not throw (records into the audit service)', async () => {
    const s = await createSession(token());
    assert.doesNotThrow(() => s.audit('org-mcp-1', 'list_gaps', { kind: 'orphanAssets' }));
  });
});

// ── Service principal ───────────────────────────────────────────────────────
const now = new Date().toISOString();
const mkOrg = (id: string, parentId: string | null): StoredOrg => ({
  id, parentId, name: id, type: parentId ? 'division' : 'company', industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now,
});
const mkGrant = (id: string, over: Partial<StoredServicePrincipal> = {}): StoredServicePrincipal => ({
  id, orgId: 'sp-co', label: 'Test agent', role: 'VIEWER', createdBy: 'admin1',
  tokenPrefix: 'abc123', lastUsedAt: null, revokedAt: null, createdAt: now, updatedAt: now, ...over,
});
const serviceToken = (grantId: string, orgId = 'sp-co', role = 'VIEWER') =>
  sign({ sub: grantId, email: `mcp-agent+${grantId}@service.procela.local`, orgId, role, type: 'service' }, { expiresIn: '30d' });

const ORG_IDS = ['sp-co', 'sp-div', 'sp-other'];
const GRANT_IDS = ['grant-ok', 'grant-revoked', 'grant-editor'];

describe('createSession — service principal', () => {
  before(() => {
    organizations.push(mkOrg('sp-co', null), mkOrg('sp-div', 'sp-co'), mkOrg('sp-other', null));
    servicePrincipals.push(
      mkGrant('grant-ok'),
      mkGrant('grant-revoked', { revokedAt: now }),
      mkGrant('grant-editor', { role: 'EDITOR' }),
    );
  });
  after(() => {
    for (let i = organizations.length - 1; i >= 0; i--) if (ORG_IDS.includes(organizations[i].id)) organizations.splice(i, 1);
    for (let i = servicePrincipals.length - 1; i >= 0; i--) if (GRANT_IDS.includes(servicePrincipals[i].id)) servicePrincipals.splice(i, 1);
  });

  it('builds a session scoped to the grant org, with the grant id as actor', async () => {
    const s = await createSession(serviceToken('grant-ok'));
    assert.strictEqual(s.user.sub, 'grant-ok');
    assert.strictEqual(s.user.type, 'service');
    assert.strictEqual(s.defaultOrgId, 'sp-co');
  });

  it('resolveOrg allows the grant org and its descendants, and refuses others', async () => {
    const s = await createSession(serviceToken('grant-ok'));
    assert.strictEqual(s.resolveOrg(undefined), 'sp-co');
    assert.strictEqual(s.resolveOrg('sp-div'), 'sp-div'); // descendant OK
    // A sibling/unrelated org is refused as not-found — the email→person
    // "unrestricted" fallback must NOT apply to a synthetic principal.
    assert.throws(() => s.resolveOrg('sp-other'), /Not found/);
    assert.throws(() => s.resolveOrg('org-mcp-1'), /Not found/);
  });

  it('refuses a revoked grant (opaque message)', async () => {
    await assert.rejects(() => createSession(serviceToken('grant-revoked')), /revoked or not recognized/);
  });

  it('refuses an unknown grant id', async () => {
    await assert.rejects(() => createSession(serviceToken('grant-ghost')), /revoked or not recognized/);
  });

  it('applies the grant role as the RBAC floor (VIEWER cannot write)', async () => {
    const s = await createSession(serviceToken('grant-ok'));
    assert.doesNotThrow(() => s.assertRead('process:read'));
    assert.throws(() => s.assertWrite('process:write'), /cannot modify/);
  });

  it('an EDITOR grant can write', async () => {
    const s = await createSession(serviceToken('grant-editor', 'sp-co', 'EDITOR'));
    assert.doesNotThrow(() => s.assertWrite('process:write'));
  });

  it('the role floor follows the GRANT, not a forged role claim in the token', async () => {
    // Token claims ORG_ADMIN, but the grant row is VIEWER — the grant wins.
    const s = await createSession(serviceToken('grant-ok', 'sp-co', 'ORG_ADMIN'));
    assert.throws(() => s.assertWrite('process:write'), /cannot modify/);
    assert.throws(() => s.assertRead('audit:read'), /cannot read audit/);
  });
});
