// ──────────────────────────────────────────────────────────────────────────
// collapseHierarchy — drill-up / drill-down for the Enterprise View process
// tree.
//
// The Enterprise View graph carries process nodes at four levels
// (Value Stream → Process → Sub-process → Activity) linked by `hierarchy`
// ("contains") edges, plus cross-hierarchy edges that mostly hang off the
// deepest level — activity→data-asset mappings, ownership, etc.
//
// This transform renders the process tree only down to a chosen depth, with an
// optional per-branch override (`expandedIds`) so a single process can be
// drilled into while the rest stay collapsed. The important part is edge
// ROLL-UP: when a process node is hidden, its edges are re-anchored onto its
// nearest visible ancestor (deduped, self-loops dropped) so collapsing to
// "Processes" doesn't also hide every data/system relationship — those roll up
// to the process that owns them.
//
// Pure and side-effect free so it can be unit-tested in isolation; the page
// feeds its output straight into the existing diagram / cards renderers.
// ──────────────────────────────────────────────────────────────────────────

export const PROCESS_LEVELS = ['VALUE_STREAM', 'PROCESS', 'SUBPROCESS', 'ACTIVITY'] as const;
export type ProcessLevel = (typeof PROCESS_LEVELS)[number];

const RANK: Record<string, number> = { VALUE_STREAM: 0, PROCESS: 1, SUBPROCESS: 2, ACTIVITY: 3 };

// Plural nouns for the expand affordance ("＋ 6 activities").
export const LEVEL_PLURAL: Record<ProcessLevel, string> = {
  VALUE_STREAM: 'value streams',
  PROCESS: 'processes',
  SUBPROCESS: 'sub-processes',
  ACTIVITY: 'activities',
};

export interface HNode {
  id: string;
  type: string;
  label: string;
  status?: string;
  meta: Record<string, any>;
}

export interface HEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
}

/** Expand affordance shown on a visible process node. `expand` = it has hidden
 *  direct children that a click would reveal; `collapse` = its children are
 *  currently shown and a click would hide them. */
export interface ExpandControl {
  state: 'expand' | 'collapse';
  count: number;          // hidden direct children (expand) or shown ones (collapse)
  childLevel: ProcessLevel;
}

export interface CollapseResult<N, E> {
  nodes: N[];
  edges: E[];
  /** Visible process id → its expand/collapse affordance (absent for leaves). */
  expandControls: Map<string, ExpandControl>;
}

const rankOf = (n: HNode): number => RANK[n.meta?.level] ?? 99;
const isProcess = (n: HNode) => n.type === 'process';

/**
 * Collapse the process hierarchy to `maxLevel`, honouring per-branch expansions.
 *
 * A process node is visible when it is at or above `maxLevel`, OR every ancestor
 * deeper than `maxLevel` on its path is explicitly expanded. Non-process nodes
 * (systems, data assets, domains, people) are always kept. Edges touching a
 * hidden process node are re-anchored to that node's nearest visible ancestor;
 * resulting self-loops are dropped and duplicates (same source/target/type) are
 * merged.
 */
export function collapseProcessHierarchy<N extends HNode, E extends HEdge>(
  nodes: N[],
  edges: E[],
  maxLevel: ProcessLevel,
  expandedIds: Set<string>,
): CollapseResult<N, E> {
  const maxRank = RANK[maxLevel] ?? 3;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Parent / children maps from the structural (hierarchy) edges.
  const parentOf = new Map<string, string>();      // child id → parent id
  const childrenOf = new Map<string, string[]>();   // parent id → child ids
  for (const e of edges) {
    if (e.type !== 'hierarchy') continue;
    parentOf.set(e.target, e.source);
    (childrenOf.get(e.source) ?? childrenOf.set(e.source, []).get(e.source)!).push(e.target);
  }

  // Visibility of a process node, memoised. Non-process nodes are always visible.
  const visCache = new Map<string, boolean>();
  const isVisible = (id: string): boolean => {
    const cached = visCache.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n) return false;
    let result: boolean;
    if (!isProcess(n)) {
      result = true;
    } else if (rankOf(n) <= maxRank) {
      result = true;
    } else {
      const parent = parentOf.get(id);
      // Deeper than the cut line: shown only inside an expanded branch — the
      // parent must itself be visible and explicitly expanded.
      result = parent ? isVisible(parent) && expandedIds.has(parent) : true;
    }
    visCache.set(id, result);
    return result;
  };

  // Nearest visible ancestor for a hidden process node (walk up until visible).
  const nearestVisible = (id: string): string | null => {
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (isVisible(cur)) return cur;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return null;
  };

  const visibleNodes = nodes.filter((n) => isVisible(n.id));
  const visibleSet = new Set(visibleNodes.map((n) => n.id));

  // Re-anchor + dedupe edges.
  const anchor = (id: string): string | null => {
    if (visibleSet.has(id)) return id;
    const n = byId.get(id);
    if (n && isProcess(n)) return nearestVisible(id);
    return null; // a hidden non-process endpoint just drops the edge
  };

  const outEdges: E[] = [];
  const seenKey = new Set<string>();
  for (const e of edges) {
    const s = anchor(e.source);
    const t = anchor(e.target);
    if (!s || !t || s === t) continue;                 // dangling or self-loop
    // A hierarchy edge only survives between two still-visible process nodes;
    // re-anchored structural edges would just duplicate a closer one.
    if (e.type === 'hierarchy' && (s !== e.source || t !== e.target)) continue;
    const key = `${s}|${t}|${e.type}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    outEdges.push(s === e.source && t === e.target ? e : { ...e, source: s, target: t });
  }

  // Expand / collapse affordance per visible process node that has children.
  const expandControls = new Map<string, ExpandControl>();
  for (const n of visibleNodes) {
    if (!isProcess(n)) continue;
    const kids = childrenOf.get(n.id);
    if (!kids || kids.length === 0) continue;
    const hidden = kids.filter((cid) => !visibleSet.has(cid));
    if (hidden.length > 0) {
      expandControls.set(n.id, { state: 'expand', count: hidden.length, childLevel: dominantLevel(hidden, byId) });
    } else {
      expandControls.set(n.id, { state: 'collapse', count: kids.length, childLevel: dominantLevel(kids, byId) });
    }
  }

  return { nodes: visibleNodes, edges: outEdges, expandControls };
}

// Most common child level, for the affordance label.
function dominantLevel<N extends HNode>(ids: string[], byId: Map<string, N>): ProcessLevel {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const lvl = byId.get(id)?.meta?.level;
    if (lvl) counts[lvl] = (counts[lvl] ?? 0) + 1;
  }
  let best: ProcessLevel = 'ACTIVITY';
  let bestN = -1;
  for (const [lvl, n] of Object.entries(counts)) {
    if (n > bestN && (lvl in RANK)) { best = lvl as ProcessLevel; bestN = n; }
  }
  return best;
}

/** Which depth segments to offer: only levels that actually occur in the data,
 *  always in hierarchy order. */
export function availableLevels(nodes: HNode[]): ProcessLevel[] {
  const present = new Set<string>();
  for (const n of nodes) if (n.type === 'process' && n.meta?.level) present.add(n.meta.level);
  return PROCESS_LEVELS.filter((l) => present.has(l));
}

/** Removing an expansion should also drop its descendants so re-expanding
 *  starts one level down again. Returns a new Set. */
export function collapseBranch(expandedIds: Set<string>, id: string, edges: HEdge[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type === 'hierarchy') (childrenOf.get(e.source) ?? childrenOf.set(e.source, []).get(e.source)!).push(e.target);
  }
  const next = new Set(expandedIds);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    next.delete(cur);
    for (const c of childrenOf.get(cur) ?? []) stack.push(c);
  }
  return next;
}
