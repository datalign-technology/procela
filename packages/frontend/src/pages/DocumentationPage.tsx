import Tabs from '../components/Tabs';
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
// decision for users. Each tab still renders its original page, header
// and actions intact.
//
// Old routes (/operations-manual and /sops) redirect here with the
// matching `tab` query param pre-selected, keeping deep links alive.
// ──────────────────────────────────────────────────────────────────────────

export default function DocumentationPage() {
  return (
    <Tabs
      defaultTab="manual"
      tabs={[
        { id: 'manual',     label: 'Manual',     render: () => <OperationsManualPage /> },
        { id: 'procedures', label: 'Procedures', render: () => <SopsPage /> },
      ]}
    />
  );
}
