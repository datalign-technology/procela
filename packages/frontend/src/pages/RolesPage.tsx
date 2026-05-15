import Tabs from '../components/Tabs';
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
// ──────────────────────────────────────────────────────────────────────────

export default function RolesPage() {
  return (
    <Tabs
      defaultTab="assignments"
      tabs={[
        { id: 'assignments', label: 'Assignments', render: () => <DamaRolesPage /> },
        { id: 'raci',        label: 'RACI Matrix', render: () => <RaciMatrixPage /> },
      ]}
    />
  );
}
