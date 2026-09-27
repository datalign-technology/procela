// MCP session identity — round-trips a real signed token through createSession
// and checks the org-authorization / RBAC / audit wiring against the real
// backend primitives (jwt-signer, permissions, auditService).

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { sign } from '../services/jwt-signer';
import { createSession } from '../mcp/identity';

const token = (over: Record<string, unknown> = {}) =>
  sign({ sub: 'u-mcp-1', email: 'mcp@tidewater.test', orgId: 'org-mcp-1', role: 'VIEWER', type: 'access', ...over }, { expiresIn: '5m' });

describe('createSession', () => {
  it('verifies a valid token and exposes the caller identity', () => {
    const s = createSession(token());
    assert.strictEqual(s.user.sub, 'u-mcp-1');
    assert.strictEqual(s.defaultOrgId, 'org-mcp-1');
  });

  it('rejects a malformed / unsigned token', () => {
    assert.throws(() => createSession('not-a-jwt'));
  });

  it('resolveOrg defaults to the caller org and returns it', () => {
    const s = createSession(token());
    assert.strictEqual(s.resolveOrg(undefined), 'org-mcp-1');
    assert.strictEqual(s.resolveOrg('org-mcp-1'), 'org-mcp-1');
  });

  it('assertRead allows a VIEWER to read the base resources but not elevated ones', () => {
    const s = createSession(token());
    assert.doesNotThrow(() => s.assertRead('process:read'));
    assert.doesNotThrow(() => s.assertRead('data-asset:read'));
    // 'audit:read' is elevated — a VIEWER must not get it via MCP.
    assert.throws(() => s.assertRead('audit:read'), /cannot read audit/);
  });

  it('audit() does not throw (records into the audit service)', () => {
    const s = createSession(token());
    assert.doesNotThrow(() => s.audit('org-mcp-1', 'list_gaps', { kind: 'orphanAssets' }));
  });
});
