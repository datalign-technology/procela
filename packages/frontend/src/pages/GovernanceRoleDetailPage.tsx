import { useParams } from 'react-router-dom';
import DamaRolesPage from './DamaRolesPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceRoleDetailPage — the full record for one governance role at
// /dama-roles/:roleType, matching the People detail-page family. A governance
// role is keyed by its *type* (CDO, DATA_OWNER, …), not a DB id, so there's no
// GET /:id; instead we render DamaRolesPage in focus mode, which reuses the
// page's own data fetch, holders/matrix renderer (RolePreviewPane) and the
// shared assign form + confirm dialog.
// ──────────────────────────────────────────────────────────────────────────

export default function GovernanceRoleDetailPage() {
  const { roleType } = useParams<{ roleType: string }>();
  return <DamaRolesPage focusRoleType={roleType} />;
}
