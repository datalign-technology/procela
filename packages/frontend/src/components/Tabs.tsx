import { useSearchParams } from 'react-router-dom';
import type React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Tabs — small URL-aware tab strip used by merged surfaces (Documentation,
// Roles/RACI) so the active tab survives reloads and is shareable via link.
//
// The active tab is read from a query param (default: `tab`) and written
// back via setSearchParams so the back button steps through tab changes
// the same way it steps through page changes.
//
// Each child page owns its own header — Tabs is purely the strip. That
// keeps the embedded pages working unchanged.
// ──────────────────────────────────────────────────────────────────────────

export interface TabDef {
  id: string;
  label: string;
  // The content renderer is a function so embedded page components aren't
  // mounted until their tab is active. Keeps initial load light when a
  // user only needs one of the tabs.
  render: () => React.ReactNode;
}

interface TabsProps {
  tabs: TabDef[];
  defaultTab?: string;
  // Query-string key that holds the active tab id. Default 'tab'.
  paramKey?: string;
}

export default function Tabs({ tabs, defaultTab, paramKey = 'tab' }: TabsProps) {
  const [params, setParams] = useSearchParams();
  const active = params.get(paramKey) || defaultTab || tabs[0]?.id;
  const activeTab = tabs.find((t) => t.id === active) || tabs[0];

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)',
          marginBottom: 16,
        }}
      >
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
      <div
        role="tabpanel"
        id={`tab-panel-${activeTab.id}`}
        aria-labelledby={`tab-${activeTab.id}`}
      >
        {activeTab.render()}
      </div>
    </div>
  );
}
