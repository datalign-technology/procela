// Tiny inline pill rendered next to a Data Asset or System name
// when the record is owned by a different org than the current
// "Working in..." scope. Covers both directions:
//   - inherited from above (Water sees a Tidewater Utilities asset)
//   - rolled up from below (Tidewater Utilities sees a Water asset)
// Either way the message is the same — "owned by X" — and the
// row's edit affordances are disabled with a matching tooltip
// elsewhere on the page.
interface OwnerBadgeProps {
  assetOrgId?: string | null;
  activeOrgId: string;
  getOrgName: (id: string | null | undefined) => string;
}

export function OwnerBadge({ assetOrgId, activeOrgId, getOrgName }: OwnerBadgeProps) {
  if (!assetOrgId || assetOrgId === activeOrgId) return null;
  const name = getOrgName(assetOrgId);
  if (!name) return null;
  return (
    <span
      title={`Owned at ${name}. Switch the "Working in..." scope to ${name} to edit.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 8px', borderRadius: 999,
        fontSize: 10, fontWeight: 500, lineHeight: 1.4,
        background: 'var(--color-bg)', color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
        whiteSpace: 'nowrap',
      }}
    >
      Owned by {name}
    </span>
  );
}

// Convenience for callers that just want the boolean "is this row
// edit-locked for the current scope".
export function isInheritedAsset(assetOrgId: string | null | undefined, activeOrgId: string): boolean {
  return !!assetOrgId && !!activeOrgId && assetOrgId !== activeOrgId;
}
