// A small amber badge for a record that was imported by a sync connection
// but is no longer present in that source on the latest run (the backend
// flags it `syncStatus === 'MISSING_FROM_SOURCE'` rather than deleting it).
// Shown on the entity lists so a steward can decide whether to keep or
// retire the record. Renders nothing unless the status matches.

export default function NotInSourceBadge({ syncStatus }: { syncStatus?: string | null }) {
  if (syncStatus !== 'MISSING_FROM_SOURCE') return null;
  return (
    <span
      title="No longer found in the connected data source"
      style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}
    >
      NOT IN SOURCE
    </span>
  );
}
