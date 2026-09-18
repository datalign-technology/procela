import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';

// Which catalog an id belongs to, for the membership test.
export type ScopeEntityKind = 'system' | 'domain' | 'asset' | 'node';

interface RawMembership {
  applied: boolean;
  systemIds: string[];
  domainIds: string[];
  dataAssetIds: string[];
  valueStreamNodeIds: string[];
  version: { number: number; changedAt: string | null } | null;
}

export interface ScopeMembership {
  /** True only when the org has a program with a non-empty scope. When false,
   *  everything is "governed" by default, so callers show no badges. */
  applied: boolean;
  version: { number: number; changedAt: string | null } | null;
  /** Is this entity in the resolved governance scope? */
  has: (kind: ScopeEntityKind, id: string) => boolean;
}

// Resolves the active org's governance scope to id sets once, so an entity
// list can badge each row "in scope / not governed" without a per-row call.
// The same resolution the Foundation Scope tab and the scorecard/dashboard
// lenses use (GET /governance-program/scope-membership).
export function useScopeMembership(orgId: string | null | undefined): ScopeMembership {
  const [raw, setRaw] = useState<RawMembership | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) { setRaw(null); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: RawMembership }>(`/governance-program/scope-membership?orgId=${orgId}`);
        if (!cancelled) setRaw(res.data);
      } catch { if (!cancelled) setRaw(null); }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const sets = useMemo(() => ({
    system: new Set(raw?.systemIds || []),
    domain: new Set(raw?.domainIds || []),
    asset: new Set(raw?.dataAssetIds || []),
    node: new Set(raw?.valueStreamNodeIds || []),
  }), [raw]);

  const has = useCallback((kind: ScopeEntityKind, id: string) => sets[kind].has(id), [sets]);

  return { applied: !!raw?.applied, version: raw?.version ?? null, has };
}
