import React from 'react';
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

const TABS: { key: HubTab; label: string }[] = [
  { key: 'registry', label: 'Registry' },
  { key: 'quality', label: 'Quality' },
  { key: 'rules', label: 'Rules' },
];

function isHubTab(v: string | null): v is HubTab {
  return v === 'registry' || v === 'quality' || v === 'rules';
}

export default function DataAssetsHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();

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
          Registry tab. Quality and Rules track each asset's health via
          quality rules that run on demand or on a schedule.
        </HelpPopover>
      </PageHeader>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Registry mounts the asset table; Quality/Rules mount the data-quality
          page once and switch its inner view via the tab prop, so flipping
          between Quality and Rules doesn't refetch. */}
      {tab === 'registry' ? (
        <DataAssetsPage embedded />
      ) : (
        <DataQualityPage
          embedded
          tab={tab === 'rules' ? 'rules' : 'assets'}
          onTabChange={(t) => setTab(t === 'rules' ? 'rules' : 'quality')}
        />
      )}
    </div>
  );
}
