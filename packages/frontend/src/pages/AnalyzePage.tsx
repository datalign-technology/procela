import { Navigate } from 'react-router-dom';

// ──────────────────────────────────────────────────────────────────────────
// AnalyzePage — deprecated. /reports superseded this with a real tabbed
// hub that encodes the active tab in the URL. Kept as a permanent
// redirect so old bookmarks / deep links don't 404.
// ──────────────────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  return <Navigate to="/reports" replace />;
}
