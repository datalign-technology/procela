// ──────────────────────────────────────────────────────────────────────────
// Data-domain hierarchy rollup.
//
// A data asset belongs to exactly one domain (`DataAsset.dataDomainId`), and a
// domain may have sub-domains (`DataDomain.parentDomainId`). For PER-DOMAIN
// metrics — a domain's asset list/count, health, coverage, gap flags — a parent
// domain should reflect its whole subtree (itself + descendants), the way a
// DCAM/DAMA taxonomy node represents everything beneath it. This helper does
// that rollup once per request and hands back cheap lookups.
//
// IMPORTANT: use the rollup only for PER-DOMAIN figures. Org-wide sums (e.g.
// "total assets across all domains", orphan detection) must stay on the flat
// union of each domain's DIRECT `dataAssetIds` — since every asset has a single
// domain, that union already counts each asset exactly once, whereas rolling up
// would double-count a sub-domain's assets under both it and its parent.
// ──────────────────────────────────────────────────────────────────────────

export type DomainLike = { id: string; parentDomainId?: string | null; dataAssetIds?: string[] };

export interface DomainRollup {
  /** Own asset ids + every descendant sub-domain's asset ids, deduped. */
  subtreeAssetIds: (domainId: string) => Set<string>;
  /** Direct child domain ids (one level down). */
  childIds: (domainId: string) => string[];
  /** This domain's own (directly-assigned) asset ids. */
  directAssetIds: (domainId: string) => string[];
}

export function buildDomainRollup(domains: DomainLike[]): DomainRollup {
  const byId = new Map<string, DomainLike>(domains.map((d) => [d.id, d]));
  const childrenOf = new Map<string, string[]>();
  for (const d of domains) {
    if (!d.parentDomainId) continue;
    const arr = childrenOf.get(d.parentDomainId) || [];
    arr.push(d.id);
    childrenOf.set(d.parentDomainId, arr);
  }
  const cache = new Map<string, Set<string>>();
  // Sub-domains are one level deep today, but walk arbitrarily deep with a
  // seen-set cycle guard so a malformed parent chain can't loop forever.
  const subtreeAssetIds = (domainId: string): Set<string> => {
    const cached = cache.get(domainId);
    if (cached) return cached;
    const out = new Set<string>();
    const stack = [domainId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const d = byId.get(cur);
      if (!d) continue;
      for (const a of d.dataAssetIds || []) out.add(a);
      for (const c of childrenOf.get(cur) || []) stack.push(c);
    }
    cache.set(domainId, out);
    return out;
  };
  return {
    subtreeAssetIds,
    childIds: (id) => childrenOf.get(id) || [],
    directAssetIds: (id) => byId.get(id)?.dataAssetIds || [],
  };
}
