import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface OrgRef {
  id: string;
  name: string;
  type: string;
}

// One-shot fetch of every org the user can see, exposed as a tiny
// id -> name / id -> type lookup. Used by the Data Assets and
// Systems pages to render the "owned at <X>" badge on rows whose
// orgId doesn't match the active scope (i.e. inherited from a
// parent or rolled up from a child). Cached on first mount; the
// data is small (a couple of hundred orgs at most) and the active
// set rarely changes mid-session, so we don't bother with
// invalidation here. Pages that want freshness can be rendered
// after an org mutation by remounting.
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
  return {
    getOrgName: (id: string | undefined | null): string => (id ? byId.get(id)?.name || '' : ''),
    getOrgType: (id: string | undefined | null): string => (id ? byId.get(id)?.type || '' : ''),
  };
}
