import Tabs from '../components/Tabs';
import PageHeader from '../components/PageHeader';
import OperationsManualPage from './OperationsManualPage';
import SopsPage from './SopsPage';

// ──────────────────────────────────────────────────────────────────────────
// DocumentationPage — single surface for governance-program documentation.
// Two tabs:
//   Manual       → role-based operations manual (what each role does)
//   Procedures   → SOPs (step-by-step process documentation)
//
// Both used to live as separate top-level nav entries. They're closely
// related — a manual references procedures, procedures are part of a
// manual — so putting them together removes a "which page do I open?"
// decision for users.
//
// The hub owns one page title; the tab strip sits beneath it and each
// tab's page renders embedded (its own header suppressed, its toolbar
// portaled onto the tab-strip row).
//
// Old routes (/operations-manual and /sops) redirect here with the
// matching `tab` query param pre-selected, keeping deep links alive.
// ──────────────────────────────────────────────────────────────────────────

export default function DocumentationPage() {
  return (
    <Tabs
      defaultTab="manual"
      header={
        <PageHeader
          title="Documentation"
          subtitle="Governance-program documentation — role-based operations manuals and step-by-step procedures."
        />
      }
      tabs={[
        { id: 'manual',     label: 'Manual',     render: ({ actionsSlot }) => <OperationsManualPage embedded actionsPortal={actionsSlot} /> },
        { id: 'procedures', label: 'Procedures', render: ({ actionsSlot }) => <SopsPage embedded actionsPortal={actionsSlot} /> },
      ]}
    />
  );
}
