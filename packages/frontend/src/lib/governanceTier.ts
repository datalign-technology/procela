// Governance tier labels are decoupled from storage values so we can
// reword the user-facing taxonomy without a data migration. The stored
// enum stays BRONZE/SILVER/GOLD (matches the API contract, exports, and
// audit logs); the labels here are what the UI should always render.
//
// Two label sets are kept so the terminology toggle (plain vs. DAMA)
// can flip the wording in lockstep with the Tier/Trust Level rename.

import { useTerminologyStore, TerminologyMode } from '../stores/terminologyStore';

export type GovernanceTier = 'BRONZE' | 'SILVER' | 'GOLD';

export const TIER_VALUES: GovernanceTier[] = ['BRONZE', 'SILVER', 'GOLD'];

export const TIER_LABEL: Record<GovernanceTier, string> = {
  BRONZE: 'Uncertified',
  SILVER: 'Managed',
  GOLD: 'Certified',
};

export const TIER_LABEL_PLAIN: Record<GovernanceTier, string> = {
  BRONZE: 'Untrusted',
  SILVER: 'Managed',
  GOLD: 'Trusted',
};

export const TIER_DESCRIPTION: Record<GovernanceTier, string> = {
  BRONZE: 'Catalogued but not yet governed. Use at your own risk.',
  SILVER: 'Owner and steward assigned, classified, basic quality rules in place.',
  GOLD: 'Fully governed and certified. Audit-ready and suitable for regulatory use.',
};

// Badge palette for the tier — a metallic bronze / silver / gold ramp.
// Paired bg+fg hex (like the other semantic-badge palettes) so it doesn't
// drift when the `--color-*` tokens are retuned. Consumed by <TierBadge>.
export const TIER_COLORS: Record<GovernanceTier, { bg: string; color: string }> = {
  BRONZE: { bg: '#f5ede4', color: '#8a5a2b' },
  SILVER: { bg: '#eef1f4', color: '#5b6b7b' },
  GOLD:   { bg: '#fdf3d0', color: '#8a6d1f' },
};

/** Normalise any stored value to a known tier key (defaults to BRONZE). */
export function tierKey(value: string | null | undefined): GovernanceTier {
  return TIER_VALUES.includes(value as GovernanceTier) ? (value as GovernanceTier) : 'BRONZE';
}

function pick(mode: TerminologyMode, value: GovernanceTier): string {
  return mode === 'plain' ? TIER_LABEL_PLAIN[value] : TIER_LABEL[value];
}

/** Mode-aware label. Pass the current terminology mode when rendering
 *  outside React (e.g. exports). For component code prefer `useTierLabel`
 *  which reads the active mode from the store automatically. Default is
 *  plain because the rest of the UI defaults to plain mode too. */
export function tierLabel(
  value: GovernanceTier | string | null | undefined,
  mode: TerminologyMode = 'plain',
): string {
  if (!value) return pick(mode, 'BRONZE');
  if (TIER_VALUES.includes(value as GovernanceTier)) {
    return pick(mode, value as GovernanceTier);
  }
  return value;
}

/** Hook variant — reads the current terminology mode from the store
 *  and returns a tier-formatting function bound to it. */
export function useTierLabel(): (value: GovernanceTier | string | null | undefined) => string {
  const mode = useTerminologyStore((s) => s.mode);
  return (v) => tierLabel(v, mode);
}

const TIER_ORDER: Record<GovernanceTier, number> = { BRONZE: 0, SILVER: 1, GOLD: 2 };

/** > 0 if `a` is higher than `b`, < 0 if lower, 0 if equal. Unknown values
 *  sort to BRONZE so a malformed value never blocks a promotion suggestion. */
export function compareTier(a: string | null | undefined, b: string | null | undefined): number {
  const av = TIER_ORDER[(a || 'BRONZE') as GovernanceTier] ?? 0;
  const bv = TIER_ORDER[(b || 'BRONZE') as GovernanceTier] ?? 0;
  return av - bv;
}
