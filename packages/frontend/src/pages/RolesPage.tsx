import Tabs from '../components/Tabs';
import PageHeader from '../components/PageHeader';
import DamaRolesPage from './DamaRolesPage';
import RaciMatrixPage from './RaciMatrixPage';

// ──────────────────────────────────────────────────────────────────────────
// RolesPage — combined surface for role assignments and the derived
// RACI view.
//
//   Assignments → DamaRolesPage (assign people to governance roles)
//   RACI Matrix → RaciMatrixPage (read-only view of who is R/A/C/I
//                  per process step, derived from the assignments)
//
// RACI is a *view* over role data, not a separate entity. Putting it
// next to the assignment surface means users edit and inspect in one
// place. Routes /dama-roles and /raci both render this page; /raci
// pre-selects the RACI tab via the `tab` param.
//
// The hub owns one page title; the tab strip sits beneath it and each
// tab's page renders embedded (its own header suppressed, its toolbar
// portaled onto the tab-strip row).
// ──────────────────────────────────────────────────────────────────────────

export default function RolesPage() {
  return (
    <Tabs
      defaultTab="assignments"
      header={
        <PageHeader
          title="Governance Roles"
          subtitle="Assign data management governance roles to people across organizations and data domains, and inspect the resulting RACI matrix."
        />
      }
      tabs={[
        { id: 'assignments', label: 'Assignments', render: ({ actionsSlot }) => <DamaRolesPage embedded actionsPortal={actionsSlot} /> },
        { id: 'raci',        label: 'RACI Matrix', render: ({ actionsSlot }) => <RaciMatrixPage embedded actionsPortal={actionsSlot} /> },
      ]}
    />
  );
}
