import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import type React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Tabs — small URL-aware tab strip used by merged surfaces (Documentation,
// Roles/RACI, Governance Work) so the active tab survives reloads and is
// shareable via link.
//
// The active tab is read from a query param (default: `tab`) and written
// back via setSearchParams so the back button steps through tab changes
// the same way it steps through page changes.
//
// Layout mirrors the Data Assets hub: an optional `header` (a <PageHeader>)
// LEADS, the tab strip sits directly beneath it, and each tab's page can
// portal its action toolbar into `ctx.actionsSlot` so the toolbar rides on
// the tab-strip row instead of dropping onto a second line. Embedded pages
// suppress their own PageHeader and use the shared header above.
// ──────────────────────────────────────────────────────────────────────────

export interface TabRenderCtx {
  /** DOM node on the tab-strip row that the active tab's page portals its
   *  action toolbar into (right-aligned, level with the tabs). Null until
   *  the strip mounts. */
  actionsSlot: HTMLElement | null;
}

export interface TabDef {
  id: string;
  label: string;
  // The content renderer is a function so embedded page components aren't
  // mounted until their tab is active. Keeps initial load light when a
  // user only needs one of the tabs.
  render: (ctx: TabRenderCtx) => React.ReactNode;
}

interface TabsProps {
  tabs: TabDef[];
  defaultTab?: string;
  // Query-string key that holds the active tab id. Default 'tab'.
  paramKey?: string;
  // Rendered ABOVE the tab strip — typically a <PageHeader> so the page
  // title leads and the tabs sit under it (not the other way round).
  header?: React.ReactNode;
}

export default function Tabs({ tabs, defaultTab, paramKey = 'tab', header }: TabsProps) {
  const [params, setParams] = useSearchParams();
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const active = params.get(paramKey) || defaultTab || tabs[0]?.id;
  const activeTab = tabs.find((t) => t.id === active) || tabs[0];

  return (
    <div>
      {header}
      <div
        role="tablist"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex' }}>
          {tabs.map((t) => {
            const isActive = t.id === activeTab.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tab-panel-${t.id}`}
                id={`tab-${t.id}`}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set(paramKey, t.id);
                  setParams(next, { replace: false });
                }}
                style={{
                  padding: '10px 18px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {/* Right-aligned toolbar slot — the active tab's page portals its
            action strip here so it sits level with the tabs. */}
        <div
          ref={setActionsSlot}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}
        />
      </div>
      <div
        role="tabpanel"
        id={`tab-panel-${activeTab.id}`}
        aria-labelledby={`tab-${activeTab.id}`}
      >
        {activeTab.render({ actionsSlot })}
      </div>
    </div>
  );
}
