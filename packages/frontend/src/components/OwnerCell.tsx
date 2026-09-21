import Avatar from './Avatar';

// ──────────────────────────────────────────────────────────────────────────
// OwnerCell — the consistent owner / steward cell for entity-list tables: an
// initials Avatar plus the person's name. Entity lists previously printed the
// owner as a bare string, and the "no owner" placeholder drifted per page
// ("--", "—", italic "Unassigned"). This standardises both: a name gets an
// Avatar (matching how People already renders a person), an empty owner gets
// one muted placeholder.
//
//   <OwnerCell name={asset.ownerName} />
//   <OwnerCell name={sys.ownerName} subLabel={sys.deputyOwnerName && `Deputy: ${sys.deputyOwnerName}`} />
// ──────────────────────────────────────────────────────────────────────────

interface OwnerCellProps {
  name?: string | null;
  /** Optional muted second line, e.g. a deputy or the ownership source. */
  subLabel?: string | false | null;
  /** Placeholder shown when there is no owner. Defaults to an em dash. */
  emptyLabel?: string;
}

export default function OwnerCell({ name, subLabel, emptyLabel = '—' }: OwnerCellProps) {
  if (!name) {
    return <span style={{ color: 'var(--color-text-muted)' }}>{emptyLabel}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Avatar name={name} size="sm" />
      <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {subLabel && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subLabel}
          </span>
        )}
      </span>
    </span>
  );
}
