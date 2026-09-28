// ──────────────────────────────────────────────────────────────────────────
// Service-principal grants — the token-issuance surface for the MCP server
// (docs/MCP_SERVER_DESIGN.md §7/§9). An org admin mints a revocable,
// org-scoped, role-capped bearer that a headless MCP agent authenticates as,
// instead of sharing a deployment-wide PROCELA_MCP_TOKEN.
//
// The bearer is a long-lived JWT signed by the same jwt-signer the REST API
// uses; its `sub` is the grant row id and `type` is 'service'. The MCP session
// layer (mcp/identity.ts) looks the grant up on every call and refuses a
// missing / revoked one, and scopes the principal EXPLICITLY to its grant org
// (a synthetic identity must never fall through the email→person "unrestricted"
// path humans use). The plaintext token is shown once here and never stored.
// ──────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { sign } from '../services/jwt-signer';
import { auditService } from '../services/audit.service';
import { loadStore, registerStore } from '../lib/persistence';
import { assertOrgAccess } from '../lib/tenant-scope';
import { requirePermission } from '../lib/permissions';
import { AuthenticatedRequest } from '../middleware/auth';
import { getServicePrincipalsRepository } from '../db/service-principals.repo';
import logger from '../lib/logger';

// A service principal is capped to non-admin roles — an agent is never an
// escalation path. VIEWER is read-only; EDITOR additionally enables the write
// tools (themselves still gated by MCP_WRITE_ENABLED at the deployment level).
export const SERVICE_PRINCIPAL_ROLES = ['VIEWER', 'EDITOR'] as const;
export type ServicePrincipalRole = typeof SERVICE_PRINCIPAL_ROLES[number];

// Long but finite: a leaked token eventually expires even if its grant row is
// lost, while day-to-day revocation is immediate via the grant's revokedAt.
const SERVICE_TOKEN_TTL = '365d';

export interface StoredServicePrincipal {
  id: string;
  orgId: string;
  label: string;
  role: string;
  createdBy: string | null;
  /** Last 6 chars of the issued token — a display hint so an admin can tell
   *  grants apart in the list. Not a secret; the token itself is shown once. */
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const rowSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  label: z.string(),
  role: z.string().default('VIEWER'),
  createdBy: z.string().nullable().default(null),
  tokenPrefix: z.string().nullable().default(null),
  lastUsedAt: z.string().nullable().default(null),
  revokedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<StoredServicePrincipal, z.ZodTypeDef, unknown>;

export const servicePrincipals: StoredServicePrincipal[] = loadStore<StoredServicePrincipal>('servicePrincipals', rowSchema);
registerStore('servicePrincipals', servicePrincipals);

const repo = getServicePrincipalsRepository(servicePrincipals);

/** The synthetic email a service-principal token carries. Deliberately not a
 *  real address and never matched against the people store — the MCP session
 *  scopes the principal by its grant org, not by this value. */
function serviceEmail(id: string): string {
  return `mcp-agent+${id}@service.procela.local`;
}

/** Mint the bearer JWT for a grant. Returned once; never stored. */
export function mintServiceToken(grant: StoredServicePrincipal): string {
  return sign(
    { sub: grant.id, email: serviceEmail(grant.id), orgId: grant.orgId, role: grant.role, type: 'service' },
    { expiresIn: SERVICE_TOKEN_TTL },
  );
}

/** Look up a grant by id (used by the MCP session layer). Repo-backed so it
 *  works in both JSON and Postgres modes. */
export async function getServicePrincipalById(id: string): Promise<StoredServicePrincipal | null> {
  return repo.get(id);
}

/** Best-effort lastUsedAt stamp — fire-and-forget so it never blocks a call. */
export function touchServicePrincipal(id: string): void {
  void repo.update(id, { lastUsedAt: new Date().toISOString() }).catch((err) =>
    logger.warn({ err, id }, 'Failed to stamp service-principal lastUsedAt'));
}

/** Strip secrets/internal fields for API responses (never leak more than the
 *  display hint). */
function toPublic(g: StoredServicePrincipal) {
  return {
    id: g.id, orgId: g.orgId, label: g.label, role: g.role,
    createdBy: g.createdBy, tokenPrefix: g.tokenPrefix,
    lastUsedAt: g.lastUsedAt, revokedAt: g.revokedAt,
    active: !g.revokedAt, createdAt: g.createdAt,
  };
}

const router = Router();

/** GET /api/v1/service-principals?orgId= — list an org's grants (admin). */
router.get('/', requirePermission('org:write'), async (req: AuthenticatedRequest, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : req.user?.orgId;
  if (!orgId || !assertOrgAccess(req, res, orgId)) return;
  const all = await repo.list({ orgId });
  const grants = all
    .filter((g) => g.orgId === orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toPublic);
  res.json({ success: true, data: grants });
});

const createSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  label: z.string().min(1, 'label is required').max(120),
  role: z.enum(SERVICE_PRINCIPAL_ROLES).optional(),
});

/** POST /api/v1/service-principals — mint a grant (admin). Returns the token ONCE. */
router.post('/', requirePermission('org:write'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' });
    return;
  }
  const { orgId, label } = parsed.data;
  const role: ServicePrincipalRole = parsed.data.role || 'VIEWER';
  if (!assertOrgAccess(req, res, orgId)) return;

  const now = new Date().toISOString();
  const grant: StoredServicePrincipal = {
    id: uuid(), orgId, label: label.trim(), role,
    createdBy: req.user?.sub || null, tokenPrefix: null,
    lastUsedAt: null, revokedAt: null, createdAt: now, updatedAt: now,
  };
  const token = mintServiceToken(grant);
  grant.tokenPrefix = token.slice(-6);
  await repo.create(grant);
  auditService.log(orgId, req.user?.sub || null, 'ServicePrincipal', grant.id, 'CREATE', null, toPublic(grant));
  logger.info({ id: grant.id, orgId, role }, 'Minted MCP service-principal token');
  // The token is returned exactly once; it is never stored or re-displayed.
  res.status(201).json({ success: true, data: { ...toPublic(grant), token } });
});

/** DELETE /api/v1/service-principals/:id — revoke a grant (admin). */
router.delete('/:id', requirePermission('org:write'), async (req: AuthenticatedRequest, res: Response) => {
  const grant = await repo.get(String(req.params.id));
  if (!grant) { res.status(404).json({ success: false, error: 'Service principal not found' }); return; }
  if (!assertOrgAccess(req, res, grant.orgId)) return;
  if (grant.revokedAt) { res.json({ success: true, data: toPublic(grant) }); return; }
  const updated = await repo.update(grant.id, { revokedAt: new Date().toISOString() });
  auditService.log(grant.orgId, req.user?.sub || null, 'ServicePrincipal', grant.id, 'REVOKE', toPublic(grant), updated ? toPublic(updated) : null);
  logger.info({ id: grant.id, orgId: grant.orgId }, 'Revoked MCP service-principal token');
  res.json({ success: true, data: updated ? toPublic(updated) : null });
});

export default router;
