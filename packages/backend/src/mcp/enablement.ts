// ──────────────────────────────────────────────────────────────────────────
// Per-tenant MCP enablement (docs/MCP_SERVER_DESIGN.md §9).
//
// On top of the deployment kill switches (MCP_SERVER_ENABLED / AI_FEATURES_
// ENABLED, and MCP_WRITE_ENABLED for writes), an org must OPT IN before its
// governed context is reachable over MCP — so it's a sold, configurable
// feature, not an all-or-nothing global switch. Resolved up the org tree
// exactly like scorecardTargets / roiModel, so a company can enable it once
// for all its divisions. Off by default (opt-in), the safe/back-compatible
// stance for a brand-new external surface.
// ──────────────────────────────────────────────────────────────────────────

import { getCachedOrgList } from '../lib/org-scope';

/** Whether the MCP surface is enabled for `orgId`: walk up to the first
 *  ancestor that sets `mcpEnabled` and return it; if no ancestor sets it,
 *  the default is OFF (per-tenant opt-in). */
export function isMcpEnabledForOrg(orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  const orgs = getCachedOrgList();
  let cur = orgs.find((o) => o.id === orgId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const v = (cur as { mcpEnabled?: boolean }).mcpEnabled;
    if (typeof v === 'boolean') return v;
    cur = cur.parentId ? orgs.find((o) => o.id === cur!.parentId) : undefined;
  }
  return false;
}
