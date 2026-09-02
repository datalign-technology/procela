import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import HelpPopover from '../components/HelpPopover';
import DataAssetsPage from './DataAssetsPage';
import DataQualityPage from './DataQualityPage';

// ---------------------------------------------------------------------------
// Data Assets hub — a single page that combines the asset registry with the
// data-quality views that read over the same asset list. Three tabs:
//   • Registry — define assets, bind them to sources, set ownership/domain
//   • Quality  — per-asset health view with rule quick-add ("Manage rules")
//   • Rules    — every quality rule across assets
// The old /data-assets and /data-quality pages are mounted here in embedded
// mode (they suppress their own PageHeader); this hub owns the title + tabs
// so the sidebar carries one "Data Assets" entry instead of two.
// ---------------------------------------------------------------------------

type HubTab = 'registry' | 'quality' | 'rules';

// Order follows the setup flow and the data dependency: define assets on
// Registry, author the checks on Rules, then read the resulting Quality —
// Rules populate Quality, so the producer sits before the product.
const TABS: { key: HubTab; label: string }[] = [
  { key: 'registry', label: 'Registry' },
  { key: 'rules', label: 'Rules' },
  { key: 'quality', label: 'Quality' },
];

function isHubTab(v: string | null): v is HubTab {
  return v === 'registry' || v === 'quality' || v === 'rules';
}

export default function DataAssetsHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // The embedded pages own their own toolbars (Views / Export / Columns /
  // Add), but each tab's toolbar should sit up on the tab-bar row —
  // right-aligned, level with the tabs — the way Business Glossary and the
  // Process ↔ Data Map hub keep their actions on the header row, rather than
  // dropping onto a second line below the tabs. We expose a slot in the tab
  // row and let the active embedded page portal its toolbar into it.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  const tabParam = searchParams.get('tab');
  const tab: HubTab = isHubTab(tabParam) ? tabParam : 'registry';

  const setTab = (next: HubTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'registry') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
  });

  return (
    <div>
      <PageHeader
        title="Data Assets"
        subtitle="Define your data assets, then monitor their quality — one place for the registry and the health rules that read over it."
      >
        <HelpPopover id="data-assets-hub-overview" title="Data assets">
          Define your data in business terms first ("Customer accounts",
          "Billing records") and bind each to where it lives on the
          Registry tab. Rules and Quality track each asset's health via
          quality rules that run on demand or on a schedule.
        </HelpPopover>
      </PageHeader>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex' }}>
          {TABS.map((t) => (
            <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {/* Right-aligned toolbar slot — the active tab's page portals its
            action strip here so it sits level with the tabs. */}
        <div
          ref={setActionsSlot}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}
        />
      </div>

      {/* Registry mounts the asset table; Quality/Rules mount the data-quality
          page once and switch its inner view via the tab prop, so flipping
          between Quality and Rules doesn't refetch. */}
      {tab === 'registry' ? (
        <DataAssetsPage embedded actionsPortal={actionsSlot} />
      ) : (
        <DataQualityPage
          embedded
          actionsPortal={actionsSlot}
          tab={tab === 'rules' ? 'rules' : 'assets'}
          onTabChange={(t) => setTab(t === 'rules' ? 'rules' : 'quality')}
        />
      )}
    </div>
  );
}
