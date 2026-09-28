// ──────────────────────────────────────────────────────────────────────────
// MCP session identity — authentication, org authorization, RBAC floor, audit.
//
// Reuses the backend's own primitives so the MCP surface can't see more, or
// authorize differently, than the REST API: `jwt-signer.verify` for identity,
// `routes/people.canAccessOrg` for tenant isolation, `lib/permissions` for the
// role floor, and the hash-chained `auditService` for the mandatory audit
// trail. A tool never talks to any of these directly — it goes through Session.
// ──────────────────────────────────────────────────────────────────────────

import { verify } from '../services/jwt-signer';
import { canAccessOrg } from '../routes/people';
import { hasPermission } from '../lib/permissions';
import { auditService } from '../services/audit.service';
import type { TokenPayload } from '../types';
import { McpError, RPC } from './protocol';

export interface Session {
  user: TokenPayload;
  defaultOrgId: string;
  /** Resolve the org a tool targets (the `orgId` arg, or the caller's own),
   *  asserting the caller can access it. A cross-tenant / unknown org reads as
   *  "not found" — never revealing that another tenant's org exists. */
  resolveOrg(orgIdArg: unknown): string;
  /** Assert the caller's role carries a read permission (e.g. 'process:read');
   *  throws otherwise. Read-only server, so only `*:read` is ever requested. */
  assertRead(permission: string): void;
  /** Assert the caller's role carries a write permission (e.g. 'process:write');
   *  throws otherwise. Gates the write tools — an agent inherits the acting
   *  user's role and can never write what that role can't write in-app. */
  assertWrite(permission: string): void;
  /** Record an audited MCP read into the hash-chained audit log. */
  audit(orgId: string, tool: string, args: Record<string, unknown>): void;
  /** Record an audited MCP *mutation* into the hash-chained audit log, with the
   *  real entity type/id and before/after state — mandatory and non-bypassable
   *  for every write tool (see docs/MCP_SERVER_DESIGN.md §8). */
  auditWrite(
    orgId: string,
    entityType: string,
    entityId: string,
    action: string,
    before: object | null,
    after: object | null,
  ): void;
}

/** Authenticate a bearer token and build a Session. Throws on an invalid or
 *  expired token (jwt-signer's own error), or a malformed payload. */
export function createSession(token: string): Session {
  const user = verify<TokenPayload>(token); // throws on invalid / expired
  if (!user || typeof user.sub !== 'string' || typeof user.orgId !== 'string') {
    throw new McpError('Token payload is missing sub/orgId.', RPC.INVALID_REQUEST);
  }
  return {
    user,
    defaultOrgId: user.orgId,
    resolveOrg(orgIdArg) {
      const orgId = typeof orgIdArg === 'string' && orgIdArg.trim() ? orgIdArg.trim() : user.orgId;
      if (!canAccessOrg(user, orgId)) {
        throw new McpError('Not found.', RPC.INVALID_PARAMS);
      }
      return orgId;
    },
    assertRead(permission) {
      if (!hasPermission(user.role, permission)) {
        const resource = permission.split(':')[0];
        throw new McpError(`Your role (${user.role}) cannot read ${resource}.`, RPC.INVALID_REQUEST);
      }
    },
    assertWrite(permission) {
      if (!hasPermission(user.role, permission)) {
        const resource = permission.split(':')[0];
        throw new McpError(`Your role (${user.role}) cannot modify ${resource}.`, RPC.INVALID_REQUEST);
      }
    },
    audit(orgId, tool, args) {
      // Mandatory + non-bypassable: every tool call routes through here before
      // returning data. entityType 'McpTool', action 'MCP_QUERY'.
      auditService.log(orgId, user.sub, 'McpTool', tool, 'MCP_QUERY', null, { args });
    },
    auditWrite(orgId, entityType, entityId, action, before, after) {
      // A write is audited with the REAL entity type/id + before/after so the
      // change shows up in that entity's history (queryable like any in-app
      // edit), and with an MCP_-prefixed action so a reviewer can tell it came
      // through the agent surface and on whose authority.
      auditService.log(orgId, user.sub, entityType, entityId, action, before, after);
    },
  };
}
