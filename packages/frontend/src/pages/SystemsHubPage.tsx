import Tabs from '../components/Tabs';
import PageHeader from '../components/PageHeader';
import HelpPopover from '../components/HelpPopover';
import SystemsPage from './SystemsPage';
import ConnectionsPage from './ConnectionsPage';

// ──────────────────────────────────────────────────────────────────────────
// SystemsHubPage — the Systems section as a single tabbed page instead of two
// sidebar entries. The two are tightly related — a connection feeds a system —
// so they read better under one "Systems" heading with tabs than as separate
// rail items.
//
//   Systems     → the application/platform registry
//   Connections → the live source connections that feed those systems
//
// The hub owns the page title; the tab strip sits beneath it and each tab's
// page renders embedded (own header suppressed, toolbar portaled onto the tab
// row). /connections redirects here with ?tab=connections so deep links live.
// ──────────────────────────────────────────────────────────────────────────

export default function SystemsHubPage() {
  return (
    <Tabs
      defaultTab="systems"
      header={
        <PageHeader
          title="Systems"
          subtitle="Applications and platforms where your organization's data lives, and the connections that feed them."
        >
          <HelpPopover id="systems-hub-overview" title="Systems">
            Register the applications and platforms your organization uses on the
            Systems tab, then wire each to its live source on the Connections tab.
          </HelpPopover>
        </PageHeader>
      }
      tabs={[
        { id: 'systems',     label: 'Systems',     render: ({ actionsSlot }) => <SystemsPage embedded actionsPortal={actionsSlot} /> },
        { id: 'connections', label: 'Connections', render: ({ actionsSlot }) => <ConnectionsPage embedded actionsPortal={actionsSlot} /> },
      ]}
    />
  );
}
