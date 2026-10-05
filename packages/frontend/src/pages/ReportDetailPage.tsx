import { useParams } from 'react-router-dom';
import ReportsPage from './ReportsPage';

// ──────────────────────────────────────────────────────────────────────────
// ReportDetailPage — the full record for one report at /reports/:id, matching
// the People detail-page family. Renders ReportsPage in focus mode, which
// reuses the catalog's own list + definition fetch to show the report's
// columns / filters / sort with Run and Edit (→ Builder) in the header.
// ──────────────────────────────────────────────────────────────────────────

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ReportsPage focusReportId={id} />;
}
