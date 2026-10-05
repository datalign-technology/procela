import { useParams } from 'react-router-dom';
import SystemsPage from './SystemsPage';

// ──────────────────────────────────────────────────────────────────────────
// SystemDetailPage — the full cross-layer record for one system at
// /systems/:id, matching the People detail-page family. Renders SystemsPage
// in focus mode, which mounts the shared SystemDetailModal in page mode
// (where-used, integrations, ownership, discussion, history) reusing the
// page's data and the full-editor escape hatch.
// ──────────────────────────────────────────────────────────────────────────

export default function SystemDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <SystemsPage focusSystemId={id} />;
}
