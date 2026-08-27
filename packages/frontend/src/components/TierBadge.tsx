import { useTierLabel, TIER_COLORS, TIER_DESCRIPTION, tierKey } from '../lib/governanceTier';

// ──────────────────────────────────────────────────────────────────────────
// TierBadge — the coloured pill for a governance tier (Bronze / Silver /
// Gold). Label comes from `useTierLabel` so it tracks the plain↔DAMA
// terminology toggle; colour comes from the TIER_COLORS ramp. Use this for
// the read-only display of a tier; keep an inline `<select>` for the
// editable case.
//
//   <TierBadge tier={asset.governanceTier} />
// ──────────────────────────────────────────────────────────────────────────

interface TierBadgeProps {
  tier: string | null | undefined;
  title?: string;
}

export default function TierBadge({ tier, title }: TierBadgeProps) {
  const label = useTierLabel();
  const key = tierKey(tier);
  const c = TIER_COLORS[key];
  // Default the hover tooltip to the tier's plain-language meaning, so a
  // newcomer can find out what "Untrusted / Managed / Trusted" mean without
  // leaving the page. An explicit `title` (e.g. a health note) still wins.
  return (
    <span
      title={title ?? TIER_DESCRIPTION[key]}
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
        background: c.bg, color: c.color,
      }}
    >
      {label(tier)}
    </span>
  );
}
