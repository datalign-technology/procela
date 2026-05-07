// Governance tier labels are decoupled from storage values so we can
// reword the user-facing taxonomy without a data migration. The stored
// enum stays BRONZE/SILVER/GOLD (matches the API contract, exports, and
// audit logs); the labels here are what the UI should always render.

export type GovernanceTier = 'BRONZE' | 'SILVER' | 'GOLD';

export const TIER_VALUES: GovernanceTier[] = ['BRONZE', 'SILVER', 'GOLD'];

export const TIER_LABEL: Record<GovernanceTier, string> = {
  BRONZE: 'Uncertified',
  SILVER: 'Managed',
  GOLD: 'Certified',
};

export const TIER_DESCRIPTION: Record<GovernanceTier, string> = {
  BRONZE: 'Catalogued but not yet governed. Use at your own risk.',
  SILVER: 'Owner and steward assigned, classified, basic quality rules in place.',
  GOLD: 'Fully governed and certified. Audit-ready and suitable for regulatory use.',
};

export function tierLabel(value: GovernanceTier | string | null | undefined): string {
  if (!value) return TIER_LABEL.BRONZE;
  return TIER_LABEL[value as GovernanceTier] ?? value;
}
