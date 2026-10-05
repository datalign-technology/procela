import { useParams } from 'react-router-dom';
import DataAssetsPage from './DataAssetsPage';

// ──────────────────────────────────────────────────────────────────────────
// DataAssetDetailPage — the full 360° record for one data asset at
// /data-assets/:id, matching the People detail-page family. Renders
// DataAssetsPage in focus mode, which reuses the page's own 360 fetch and
// the detail body (bound columns, sensitivity, impact, where-used, mappings,
// discussion, activity) the modal used.
// ──────────────────────────────────────────────────────────────────────────

export default function DataAssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <DataAssetsPage focusAssetId={id} />;
}
