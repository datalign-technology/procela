import { useParams } from 'react-router-dom';
import ConnectionsPage from './ConnectionsPage';

// ──────────────────────────────────────────────────────────────────────────
// ConnectionDetailPage — the detail record for one data connection at
// /connections/:id, matching the People / Systems detail-page family. Renders
// ConnectionsPage in focus mode, which mounts the shared ConnectionDetailModal
// in page mode (PageHeader + Back) reusing the page's loaded data. The full
// config editor (type / credentials) is reached via ?edit=<id> on the list.
// ──────────────────────────────────────────────────────────────────────────

export default function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ConnectionsPage focusConnId={id} />;
}
