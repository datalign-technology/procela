import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * Compatibility redirect — the combined `/systems-and-data` page was split
 * into three top-level routes (/systems, /data-assets, /connections). This
 * component maps any lingering deep link at the old URL to the new route:
 *
 *   /systems-and-data                         → /systems
 *   /systems-and-data?tab=systems             → /systems
 *   /systems-and-data?tab=data-assets         → /data-assets
 *   /systems-and-data?tab=connections&…       → /connections?…  (filters preserved)
 *
 * When/if the redirect is no longer used (enough time has passed for
 * bookmarks to be updated), this component + its route in App.tsx can be
 * deleted.
 */
export default function SystemsAndDataPage() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');

  const targetPath =
    tab === 'connections' ? '/connections' :
    tab === 'data-assets' ? '/data-assets' :
    '/systems';

  // Preserve any other query params (e.g. systemId, open) on the redirect
  // so Connections-tab deep links that filter by system still work.
  const carryParams = new URLSearchParams(searchParams);
  carryParams.delete('tab');
  const query = carryParams.toString();
  const to = query ? `${targetPath}?${query}` : targetPath;

  return <Navigate to={to} replace />;
}
