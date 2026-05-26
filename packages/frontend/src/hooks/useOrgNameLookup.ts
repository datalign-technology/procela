import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface OrgRef {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
}

// One-shot fetch of every org the user can see, exposed as a tiny
// lookup. Used by the Data Assets / Systems pages to render the
// "owned at <X>" badge on inherited rows, and by the Process
// Catalog to detect cross-division links (asset's owner is a
// sibling of the activity's value-stream org). Cached on first
// mount; the data is small (a couple of hundred orgs at most) and
// the active set rarely changes mid-session, so we don't bother
// with invalidation here. Pages that want freshness can be
// rendered after an org mutation by remounting.
export function useOrgNameLookup() {
  const [byId, setById] = useState<Map<string, OrgRef>>(new Map());
  useEffect(() => {
    apiClient
      .get<{ success: boolean; data: OrgRef[] }>('/organizations')
      .then((res) => {
        const next = new Map<string, OrgRef>();
        for (const o of res.data || []) next.set(o.id, o);
        setById(next);
      })
      .catch(() => { /* leave empty; callers fall back to '' */ });
  }, []);

  // Walks up from `descendantId` to see if it ever reaches
  // `maybeAncestorId`. Hard-caps at 16 hops so a corrupt parentId
  // cycle can't hang the UI.
  const isAncestorOf = (maybeAncestorId: string, descendantId: string): boolean => {
    if (!maybeAncestorId || !descendantId) return false;
    let current: string | null | undefined = descendantId;
    for (let i = 0; i < 16 && current; i++) {
      const next: string | null | undefined = byId.get(current)?.parentId;
      if (!next) return false;
      if (next === maybeAncestorId) return true;
      current = next;
    }
    return false;
  };

  return {
    getOrgName: (id: string | undefined | null): string => (id ? byId.get(id)?.name || '' : ''),
    getOrgType: (id: string | undefined | null): string => (id ? byId.get(id)?.type || '' : ''),
    getOrgParentId: (id: string | undefined | null): string | null => (id ? byId.get(id)?.parentId ?? null : null),
    // Returns true when `checkOrgId` lies on the same vertical axis
    // as `scopeOrgId` — either the same org, an ancestor of it, or
    // one of its descendants. Mirrors the backend's
    // getVisibleOrgScope rule. Used to decide "is this asset
    // visible to that process node without crossing a division
    // boundary?". When the orgs map hasn't loaded yet, returns
    // true so callers don't flag a false cross-division warning
    // during page load.
    isOrgInScope: (checkOrgId: string | undefined | null, scopeOrgId: string | undefined | null): boolean => {
      if (!checkOrgId || !scopeOrgId) return true;
      if (byId.size === 0) return true;
      if (checkOrgId === scopeOrgId) return true;
      return isAncestorOf(checkOrgId, scopeOrgId) || isAncestorOf(scopeOrgId, checkOrgId);
    },
  };
}
