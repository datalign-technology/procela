// ──────────────────────────────────────────────────────────────────────────
// MCP session identity — authentication, org authorization, RBAC floor, audit.
//
// Two kinds of caller resolve to the same Session shape:
//   • a HUMAN token (type 'access') — scoped through the same email→person
//     org-visibility the REST API uses (`canAccessOrg`);
//   • a SERVICE PRINCIPAL (type 'service', see routes/service-principals) — a
//     revocable, org-scoped agent grant. Its grant row is looked up on every
//     session build and a missing / revoked one is refused; it is scoped
//     EXPLICITLY to its grant org's subtree, never through the email→person
//     path (a synthetic identity matches no person, which that path treats as
//     UNRESTRICTED — the exact trap this avoids).
//
// Either way the MCP surface can't see more, or authorize differently, than the
// backend's own primitives allow: `jwt-signer.verify`, `lib/permissions`, and
// the hash-chained `auditService`.
// ──────────────────────────────────────────────────────────────────────────

import { verify } from '../services/jwt-signer';
import { canAccessOrg } from '../routes/people';
import { hasPermission } from '../lib/permissions';
import { auditService } from '../services/audit.service';
import { getCachedOrgList } from '../lib/org-scope';
import { isMcpEnabledForOrg } from './enablement';
import { getServicePrincipalById, touchServicePrincipal } from '../routes/service-principals';
import type { TokenPayload } from '../types';
import { McpError, RPC } from './protocol';

export interface Session {
  user: TokenPayload;
  defaultOrgId: string;
  /** Resolve the org a tool targets (the `orgId` arg, or the caller's own),
   *  asserting the caller can access it. A cross-tenant / unknown org reads as
   *  "not found" — never revealing that another tenant's org exists. */
  resolveOrg(orgIdArg: unknown): string;
  /** Assert the target org has opted the MCP surface on (per-tenant
   *  enablement, docs/MCP_SERVER_DESIGN.md §9). Throws when the org (or its
   *  ancestors) has not enabled MCP. Called after resolveOrg, so the org is
   *  already one the caller can access — the message is safe to be explicit. */
  assertMcpEnabled(orgId: string): void;
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

/** The org id plus every descendant org id — the concrete tenant subtree a
 *  service principal (or a company-scoped grant) is confined to. Ancestors are
 *  deliberately excluded: a division grant must not read its parent company. */
function orgSubtree(rootId: string): Set<string> {
  const orgs = getCachedOrgList();
  const set = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const o of orgs) {
      if (o.parentId === id && !set.has(o.id)) { set.add(o.id); queue.push(o.id); }
    }
  }
  return set;
}

function assertReadFor(role: string, permission: string): void {
  if (!hasPermission(role, permission)) {
    throw new McpError(`Your role (${role}) cannot read ${permission.split(':')[0]}.`, RPC.INVALID_REQUEST);
  }
}
function assertWriteFor(role: string, permission: string): void {
  if (!hasPermission(role, permission)) {
    throw new McpError(`Your role (${role}) cannot modify ${permission.split(':')[0]}.`, RPC.INVALID_REQUEST);
  }
}
function assertMcpEnabledFor(orgId: string): void {
  if (!isMcpEnabledForOrg(orgId)) {
    throw new McpError('The MCP surface is not enabled for this organization. An org admin can enable it in Settings → Integrations.', RPC.INVALID_REQUEST);
  }
}

/** Authenticate a bearer token and build a Session. Async because a service
 *  principal's grant is looked up (and revocation checked) through the repo,
 *  which is a DB read in Postgres mode. Throws on an invalid / expired token,
 *  a malformed payload, or a revoked / unknown service grant. */
export async function createSession(token: string): Promise<Session> {
  const user = verify<TokenPayload>(token); // throws on invalid / expired
  if (!user || typeof user.sub !== 'string' || typeof user.orgId !== 'string') {
    throw new McpError('Token payload is missing sub/orgId.', RPC.INVALID_REQUEST);
  }

  // ── Service principal: revocable, explicitly org-scoped ──────────────────
  if (user.type === 'service') {
    const grant = await getServicePrincipalById(user.sub);
    if (!grant || grant.revokedAt) {
      // Same opacity as an auth failure — don't distinguish revoked from unknown.
      throw new McpError('Service principal token is revoked or not recognized.', RPC.INVALID_REQUEST);
    }
    touchServicePrincipal(grant.id); // best-effort lastUsedAt
    const allowed = orgSubtree(grant.orgId);
    return {
      user: { sub: grant.id, email: user.email, orgId: grant.orgId, role: grant.role, type: 'service' },
      defaultOrgId: grant.orgId,
      resolveOrg(orgIdArg) {
        const orgId = typeof orgIdArg === 'string' && orgIdArg.trim() ? orgIdArg.trim() : grant.orgId;
        if (!allowed.has(orgId)) throw new McpError('Not found.', RPC.INVALID_PARAMS);
        return orgId;
      },
      assertMcpEnabled: assertMcpEnabledFor,
      assertRead: (p) => assertReadFor(grant.role, p),
      assertWrite: (p) => assertWriteFor(grant.role, p),
      audit(orgId, tool, args) {
        auditService.log(orgId, grant.id, 'McpTool', tool, 'MCP_QUERY', null, { args, servicePrincipal: grant.id });
      },
      auditWrite(orgId, entityType, entityId, action, before, after) {
        auditService.log(orgId, grant.id, entityType, entityId, action, before, after);
      },
    };
  }

  // ── Human token: scoped through the REST org-visibility rules ────────────
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
    assertMcpEnabled: assertMcpEnabledFor,
    assertRead: (p) => assertReadFor(user.role, p),
    assertWrite: (p) => assertWriteFor(user.role, p),
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
