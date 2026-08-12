import { useTierLabel, TIER_COLORS, tierKey } from '../lib/governanceTier';

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
  const c = TIER_COLORS[tierKey(tier)];
  return (
    <span
      title={title}
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
