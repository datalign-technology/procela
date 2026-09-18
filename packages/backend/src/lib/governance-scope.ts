// ──────────────────────────────────────────────────────────────────────────
// Governance scope resolver — turns a program's scope *anchors* (the value
// streams, data domains, and systems it declares it governs) into the concrete
// set of catalog entities that are actually in scope, by cascading down the
// hierarchies the catalog already has.
//
// This is the "what is governed" boundary: the program scope separates
// entities that are merely *connected / catalogued* (Procela knows they exist)
// from those that are *in scope / governed* (the program is accountable for
// them — they count in gap detection, coverage, the scorecard, reporting).
//
// Cascade (union semantics — reachable from ANY anchor ⇒ in scope):
//   • value stream  → every descendant process node (process → sub-process →
//                     activity/task) via parentId
//   • data domain   → its sub-domains (parentDomainId) and all their assets
//   • system        → the assets it holds (asset.systemId) and the process
//                     nodes that run on it (node.systemIds)
//
// People are never anchored directly: a person is in scope by virtue of owning
// or stewarding an in-scope entity, so membership is derived downstream (e.g.
// in gap detection) from these id sets rather than computed here.
//
// Empty anchors ⇒ null, meaning "govern the whole catalog". This is the safe,
// back-compatible default: an org that hasn't defined scope keeps today's
// whole-catalog behavior, and empty never means "govern nothing".
// ──────────────────────────────────────────────────────────────────────────

export interface ScopeAnchors {
  systemIds?: string[];
  domainIds?: string[];
  valueStreamIds?: string[];
}

export interface ScopeNode { id: string; parentId?: string | null; systemIds?: string[] }
export interface ScopeDomain { id: string; parentDomainId?: string | null; dataAssetIds?: string[] }
export interface ScopeAsset { id: string; systemId?: string | null }

export interface ScopeCatalog {
  nodes: ScopeNode[];
  domains: ScopeDomain[];
  assets: ScopeAsset[];
}

export interface ResolvedScope {
  nodeIds: Set<string>;
  domainIds: Set<string>;
  assetIds: Set<string>;
  systemIds: Set<string>;
}

const cleanIds = (ids?: string[]): string[] =>
  [...new Set((ids || []).filter((x) => typeof x === 'string' && x.trim().length > 0))];

/**
 * Resolve scope anchors against a catalog snapshot. Returns the in-scope id
 * sets, or `null` when no anchors are set (⇒ govern everything).
 *
 * The catalog arrays should already be org-scoped by the caller; this only
 * cascades, it doesn't enforce tenancy.
 */
export function resolveProgramScope(
  anchors: ScopeAnchors | null | undefined,
  catalog: ScopeCatalog,
): ResolvedScope | null {
  const sysAnchors = cleanIds(anchors?.systemIds);
  const domAnchors = cleanIds(anchors?.domainIds);
  const vsAnchors = cleanIds(anchors?.valueStreamIds);

  // No anchors ⇒ whole catalog is in scope (null sentinel).
  if (sysAnchors.length === 0 && domAnchors.length === 0 && vsAnchors.length === 0) {
    return null;
  }

  const nodeIds = new Set<string>();
  const domainIds = new Set<string>();
  const assetIds = new Set<string>();
  const systemIds = new Set<string>(sysAnchors);

  // ── Value streams → descendant process-node subtrees ──
  const nodeChildren = new Map<string, string[]>();
  for (const n of catalog.nodes) {
    if (!n.parentId) continue;
    const arr = nodeChildren.get(n.parentId);
    if (arr) arr.push(n.id); else nodeChildren.set(n.parentId, [n.id]);
  }
  const nodeExists = new Set(catalog.nodes.map((n) => n.id));
  for (const root of vsAnchors) {
    if (!nodeExists.has(root)) continue;
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (nodeIds.has(id)) continue;
      nodeIds.add(id);
      for (const c of nodeChildren.get(id) || []) stack.push(c);
    }
  }

  // ── Data domains → sub-domain subtrees + their assets ──
  const domainChildren = new Map<string, string[]>();
  for (const d of catalog.domains) {
    if (!d.parentDomainId) continue;
    const arr = domainChildren.get(d.parentDomainId);
    if (arr) arr.push(d.id); else domainChildren.set(d.parentDomainId, [d.id]);
  }
  const domainById = new Map(catalog.domains.map((d) => [d.id, d] as const));
  for (const root of domAnchors) {
    if (!domainById.has(root)) continue;
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (domainIds.has(id)) continue;
      domainIds.add(id);
      const d = domainById.get(id);
      for (const aid of d?.dataAssetIds || []) assetIds.add(aid);
      for (const c of domainChildren.get(id) || []) stack.push(c);
    }
  }

  // ── Systems → the assets they hold + the process nodes that run on them ──
  if (systemIds.size > 0) {
    for (const a of catalog.assets) {
      if (a.systemId && systemIds.has(a.systemId)) assetIds.add(a.id);
    }
    for (const n of catalog.nodes) {
      if ((n.systemIds || []).some((sid) => systemIds.has(sid))) nodeIds.add(n.id);
    }
  }

  // ── Derive in-scope systems from in-scope nodes/assets ──
  // A system that a governed process runs on, or that holds a governed asset,
  // is itself governed — so anchoring by value stream or domain still brings
  // the systems they touch into scope. One pass, no re-expansion, so scope
  // stays bounded to what the anchors reach.
  const nodeById = new Map(catalog.nodes.map((n) => [n.id, n] as const));
  for (const nid of nodeIds) {
    for (const sid of nodeById.get(nid)?.systemIds || []) systemIds.add(sid);
  }
  const assetById = new Map(catalog.assets.map((a) => [a.id, a] as const));
  for (const aid of assetIds) {
    const sid = assetById.get(aid)?.systemId;
    if (sid) systemIds.add(sid);
  }

  return { nodeIds, domainIds, assetIds, systemIds };
}
