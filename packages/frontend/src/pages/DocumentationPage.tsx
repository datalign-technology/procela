import { useEffect, useState } from 'react';
import Tabs from '../components/Tabs';
import PageHeader from '../components/PageHeader';
import OperationsManualPage from './OperationsManualPage';
import SopsPage from './SopsPage';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// DocumentationPage — single surface for governance-program documentation.
// Two tabs:
//   Manual       → role-based operations manual (what each role does)
//   Procedures   → SOPs (step-by-step process documentation)
//
// Both used to live as separate top-level nav entries. They're closely
// related — a manual references procedures, procedures are part of a
// manual — so putting them together removes a "which page do I open?"
// decision for users. The tab labels carry live counts so the hub has a
// landing identity of its own (not just a mirror of the active tab).
//
// The hub owns one page title; the tab strip sits beneath it and each
// tab's page renders embedded (its own header suppressed, its toolbar
// portaled onto the tab-strip row).
//
// Old routes (/operations-manual and /sops) redirect here with the
// matching `tab` query param pre-selected, keeping deep links alive.
// ──────────────────────────────────────────────────────────────────────────

export default function DocumentationPage() {
  const { activeOrgId } = useOrgContext();
  const [counts, setCounts] = useState<{ manuals: number | null; sops: number | null }>({ manuals: null, sops: null });

  useEffect(() => {
    if (!activeOrgId) { setCounts({ manuals: null, sops: null }); return; }
    let live = true;
    Promise.all([
      apiClient.get<{ data: unknown[] }>(`/operations-manuals?orgId=${activeOrgId}`).catch(() => ({ data: [] })),
      apiClient.get<{ data: unknown[] }>(`/sops?orgId=${activeOrgId}`).catch(() => ({ data: [] })),
    ]).then(([m, s]) => {
      if (live) setCounts({ manuals: (m.data || []).length, sops: (s.data || []).length });
    });
    return () => { live = false; };
  }, [activeOrgId]);

  const count = (n: number | null) => (n === null ? '' : ` ${n}`);

  return (
    <Tabs
      defaultTab="manual"
      header={
        <PageHeader
          title="Documentation"
          subtitle="How your governance program runs: role manuals say who does what and how often; procedures say how, step by step."
        />
      }
      tabs={[
        { id: 'manual',     label: `Manual${count(counts.manuals)}`,     render: ({ actionsSlot }) => <OperationsManualPage embedded actionsPortal={actionsSlot} /> },
        { id: 'procedures', label: `Procedures${count(counts.sops)}`, render: ({ actionsSlot }) => <SopsPage embedded actionsPortal={actionsSlot} /> },
      ]}
    />
  );
}
