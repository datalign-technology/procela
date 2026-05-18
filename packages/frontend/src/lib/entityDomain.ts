import type { DomainValue } from '../stores/domainLensStore';
import { getRoleCategory } from './roleDefinitions';

// ──────────────────────────────────────────────────────────────────────────
// entityDomain — one place that answers "is this thing governance or
// operational?" for every entity kind, so every surface classifies the
// same way instead of each re-deriving it (or matching strings).
//
//  • process    → the persisted `domain` field (backend-set / backfilled)
//  • dataAsset  → `origin === 'GOVERNANCE_TEMPLATE'` (the existing real
//                 classifier) ⇒ GOVERNANCE, else OPERATIONAL
//  • role       → DAMA governance roles ⇒ GOVERNANCE; entity-attached
//                 roles (System Owner, etc.) are operational ownership
//
// Anything unknown defaults to OPERATIONAL so legacy / unclassified rows
// never disappear under a lens.
// ──────────────────────────────────────────────────────────────────────────

export function processDomain(node: { domain?: string | null }): DomainValue {
  return node.domain === 'GOVERNANCE' ? 'GOVERNANCE' : 'OPERATIONAL';
}

export function assetDomain(asset: { origin?: string | null }): DomainValue {
  return asset.origin === 'GOVERNANCE_TEMPLATE' ? 'GOVERNANCE' : 'OPERATIONAL';
}

export function roleDomain(roleType: string): DomainValue {
  return getRoleCategory(roleType) === 'governance' ? 'GOVERNANCE' : 'OPERATIONAL';
}
