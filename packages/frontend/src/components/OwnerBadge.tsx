import { Lock } from 'lucide-react';

// Tiny inline indicator rendered next to a Data Asset or System
// name when the record is owned by a different org than the
// current "Working in..." scope. Covers both directions:
//   - inherited from above (Water sees a Tidewater Utilities asset)
//   - rolled up from below (Tidewater Utilities sees a Water asset)
//
// Icon-only by design. Product feedback: the long "Owned by
// Tidewater Utilities" pill next to every inherited row was noisy
// — a list of 20 assets became a wall of the parent org's name
// repeated 20 times. The lock says "read-only from here" — which
// is what the badge actually communicates — and the tooltip
// carries the org name for the "who owns it" question, on demand.
// aria-label preserves the full sentence so screen readers get
// the same information they used to.
interface OwnerBadgeProps {
  assetOrgId?: string | null;
  activeOrgId: string;
  getOrgName: (id: string | null | undefined) => string;
}

export function OwnerBadge({ assetOrgId, activeOrgId, getOrgName }: OwnerBadgeProps) {
  if (!assetOrgId || assetOrgId === activeOrgId) return null;
  const name = getOrgName(assetOrgId);
  if (!name) return null;
  const label = `Owned by ${name}. Switch the "Working in..." scope to ${name} to edit.`;
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: 999,
        background: 'var(--color-bg)', color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      <Lock size={10} strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}

// Convenience for callers that just want the boolean "is this row
// edit-locked for the current scope".
export function isInheritedAsset(assetOrgId: string | null | undefined, activeOrgId: string): boolean {
  return !!assetOrgId && !!activeOrgId && assetOrgId !== activeOrgId;
}
