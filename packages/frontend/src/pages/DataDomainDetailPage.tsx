import { useParams } from 'react-router-dom';
import DataDomainsPage from './DataDomainsPage';

// ──────────────────────────────────────────────────────────────────────────
// DataDomainDetailPage — the single-domain record at /data-domains/:id,
// matching the People / Systems / Governance Groups detail-page family.
// Renders DataDomainsPage in focus mode, which mounts just that domain's
// detail (identity, governance, assets) as a routed page reusing the list's
// own data and editing logic.
// ──────────────────────────────────────────────────────────────────────────

export default function DataDomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <DataDomainsPage focusDomainId={id} />;
}
