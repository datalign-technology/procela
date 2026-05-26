import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

// Scope-check shared by every surface that creates value streams
// (the wizard, the Process Catalog's "Add value stream" / empty
// state, and any future entry point). Two misuses to block:
//
//   1. wrongLevel — the active org isn't allowed to host streams
//      (a department, team, …). Backed by the orgContext store's
//      canCreateValueStreams so the rule lives in one place.
//   2. companyWithDivisions — the active org is a multi-division
//      company. Generating at the parent silently creates one
//      shared catalog across divisions that don't share processes
//      (Tidewater Utilities → Electric / Water). Detected by
//      scanning the org's full subtree for any descendant with
//      type === 'division', not just immediate children, so a
//      Company → Region → Division setup still trips the guard at
//      the company level.
//
// Also returns the parent org's display name so callers can render
// a "Generating processes for X in Y" breadcrumb without each
// surface re-fetching the parent.
export interface DivisionRef {
  id: string;
  name: string;
}

export interface ValueStreamScope {
  parentName: string;
  // Subtree-wide divisions, returned as { id, name } so callers can
  // wire one-click "switch to this division" UI without a second lookup.
  divisions: DivisionRef[];
  wrongLevel: boolean;
  companyWithDivisions: boolean;
  blocked: boolean;
}

export function useValueStreamScope(): ValueStreamScope {
  const { activeOrgId, activeOrgType, canCreateValueStreams } = useOrgContext();
  const [parentName, setParentName] = useState('');
  const [divisions, setDivisions] = useState<DivisionRef[]>([]);

  useEffect(() => {
    if (!activeOrgId) { setParentName(''); return; }
    apiClient
      .get<{ success: boolean; data: { parentId?: string | null } }>(`/organizations/${activeOrgId}`)
      .then(async (res) => {
        const parentId = res.data?.parentId;
        if (!parentId) { setParentName(''); return; }
        try {
          const parent = await apiClient.get<{ success: boolean; data: { name?: string } }>(`/organizations/${parentId}`);
          setParentName(parent.data?.name || '');
        } catch { setParentName(''); }
      })
      .catch(() => setParentName(''));
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) { setDivisions([]); return; }
    apiClient
      .get<{ success: boolean; data: Array<{ id: string; name: string; type: string }> }>(`/organizations?scopeOrgId=${activeOrgId}`)
      .then((res) => {
        setDivisions(
          (res.data || [])
            .filter((o) => o.id !== activeOrgId && o.type === 'division')
            .map((o) => ({ id: o.id, name: o.name })),
        );
      })
      .catch(() => setDivisions([]));
  }, [activeOrgId]);

  const wrongLevel = !!activeOrgType && !canCreateValueStreams;
  const companyWithDivisions = activeOrgType === 'company' && divisions.length > 0;
  const blocked = wrongLevel || companyWithDivisions;

  return { parentName, divisions, wrongLevel, companyWithDivisions, blocked };
}
