// SSO provisioning targets — where a federated (OIDC / SCIM) user lands the
// first time they appear, and at what role. Historically both paths hard-coded
// the phantom dev org + VIEWER, so every synced user piled into the wrong
// tenant at least privilege. This centralises the decision:
//
//   - primaryOrgId()  — the default org (the bootstrap org); overridable with
//                       SSO_DEFAULT_ORG_ID for a deployment whose primary org
//                       isn't the default id.
//   - a domain→org map (SSO_DOMAIN_ORG_MAP) routes specific email domains to
//     specific orgs (and optionally a role) for multi-tenant deployments.
//   - defaultSsoRole() — applied when the IdP emits no known role claim.
//
// Kept dependency-light (config only, no route imports) so both the OIDC
// callback and the SCIM handler can use it without an import cycle.

import config from '../config';
import logger from './logger';

// The long-standing default org id used across the API as the fallback tenant.
// Duplicated here (as ~20 route modules already do) to avoid importing
// routes/auth into this low-level lib.
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000010';

export const KNOWN_ROLES = ['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'] as const;
export type KnownRole = typeof KNOWN_ROLES[number];

function normalizeRole(role: string | undefined, fallback: KnownRole): KnownRole {
  const r = (role || '').toUpperCase();
  return (KNOWN_ROLES as readonly string[]).includes(r) ? (r as KnownRole) : fallback;
}

/** The primary org new federated users default into. */
export function primaryOrgId(): string {
  return config.ssoDefaultOrgId || DEFAULT_ORG_ID;
}

/** The role a federated user gets when the IdP emits no known role claim. */
export function defaultSsoRole(): KnownRole {
  return normalizeRole(config.ssoDefaultRole, 'VIEWER');
}

interface DomainRule {
  orgId: string;
  role?: KnownRole;
}

/** Parse an SSO_DOMAIN_ORG_MAP JSON string into a normalised domain→rule map.
 *  Pure and defensive: malformed JSON logs a warning and yields an empty map
 *  rather than crashing provisioning. Domains are lower-cased with a leading
 *  '@' stripped. Exported for testing. */
export function parseDomainMap(raw: string): Record<string, DomainRule> {
  const out: Record<string, DomainRule> = {};
  const trimmed = (raw || '').trim();
  if (!trimmed) return out;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const [domain, val] of Object.entries(parsed)) {
      const d = domain.toLowerCase().replace(/^@/, '');
      if (typeof val === 'string') {
        out[d] = { orgId: val };
      } else if (val && typeof val === 'object') {
        const o = val as { orgId?: string; role?: string };
        if (o.orgId) out[d] = { orgId: o.orgId, role: o.role ? normalizeRole(o.role, defaultSsoRole()) : undefined };
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'SSO_DOMAIN_ORG_MAP is not valid JSON — ignoring it');
  }
  return out;
}

let _domainMap: Record<string, DomainRule> | null = null;

/** Parse SSO_DOMAIN_ORG_MAP once (memoised). */
function domainMap(): Record<string, DomainRule> {
  if (!_domainMap) _domainMap = parseDomainMap(config.ssoDomainOrgMap);
  return _domainMap;
}

/** Test seam: clear the memoised domain map (config changes between tests). */
export function __resetProvisioningCache(): void {
  _domainMap = null;
}

/**
 * Resolve the org + default role a federated user with this email should be
 * provisioned into. A domain rule wins; otherwise the primary org + default
 * role apply.
 */
export function resolveProvisioningTarget(email: string): { orgId: string; role: KnownRole } {
  const domain = (email.split('@')[1] || '').toLowerCase();
  const rule = domainMap()[domain];
  if (rule?.orgId) {
    return { orgId: rule.orgId, role: rule.role ?? defaultSsoRole() };
  }
  return { orgId: primaryOrgId(), role: defaultSsoRole() };
}

/**
 * Combine an IdP-emitted role with the resolved default: a real (non-VIEWER)
 * role the IdP asserted via a group/role claim wins; otherwise the configured
 * default for the target applies. Lets an IdP that maps groups to EDITOR/ADMIN
 * drive access while an unmapped user still gets the deployment's chosen
 * default instead of always-VIEWER.
 */
export function effectiveSsoRole(idpRole: string | undefined, fallback: KnownRole): KnownRole {
  const r = normalizeRole(idpRole, 'VIEWER');
  return r !== 'VIEWER' ? r : fallback;
}
