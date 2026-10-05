import { useParams } from 'react-router-dom';
import GovernancePoliciesPage from './GovernancePoliciesPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceDocumentDetailPage — the full record for one governance document
// at /governance-policies/:id, matching the People detail-page family. Renders
// GovernancePoliciesPage in focus mode, which reuses the page's own data fetch
// and the detail body (details + source + controls + procedures + linked docs)
// the modal used.
// ──────────────────────────────────────────────────────────────────────────

export default function GovernanceDocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <GovernancePoliciesPage focusPolicyId={id} />;
}
