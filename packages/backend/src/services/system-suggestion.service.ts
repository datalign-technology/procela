// System suggestion service — Phase 3 expansion sibling to
// asset-suggestion.service. Same shape, same explainable scoring; just
// ranks Systems instead of DataAssets for a process node.
//
// Signals:
//  - Name/description token overlap between the node and the system.
//  - Sibling-step affinity: if a peer step under the same parent
//    process already declares this system, that's a strong hint the
//    current step uses it too (operations often share an ERP across
//    sub-steps).
//  - Excludes systems the node already declares in `systemIds`.

import { tokenise } from './asset-suggestion.service';

export interface SystemSuggestionNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  systemIds?: string[];
}

export interface SystemSuggestionSystem {
  id: string;
  name: string;
  description: string;
  systemType?: string;
  vendor?: string;
}

export interface SystemSuggestion {
  systemId: string;
  systemName: string;
  vendor?: string;
  systemType?: string;
  score: number;
  rationale: string[];
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.max(a.size, b.size);
}

const WEIGHT_NAME = 0.55;
const WEIGHT_DESC = 0.25;
const WEIGHT_SIBLING = 0.4;

export interface SystemRankOptions {
  limit?: number;
  minScore?: number;
}

/** Rank candidate Systems for a process node. Caller supplies systems
 *  narrowed to the node's org, the full set of sibling nodes (peers
 *  under the same parentId), and any dismissed system ids that should
 *  be hidden. */
export function rankSystemSuggestions(
  node: SystemSuggestionNode,
  systems: readonly SystemSuggestionSystem[],
  siblings: ReadonlyArray<{ id: string; parentId: string | null; systemIds?: string[] }>,
  dismissed: ReadonlySet<string>,
  opts: SystemRankOptions = {},
): SystemSuggestion[] {
  if (!node || systems.length === 0) return [];

  const declared = new Set(node.systemIds || []);
  const nameTokens = tokenise(node.name);
  const descTokens = tokenise(node.description);

  // Build sibling-affinity counts. A system that shows up on N of the
  // sibling steps yields a fractional sibling score weighted by share.
  const siblingTotals = new Map<string, number>();
  const siblingPeers = siblings.filter((s) => s.parentId === node.parentId && s.id !== node.id);
  for (const peer of siblingPeers) {
    for (const sid of peer.systemIds || []) {
      siblingTotals.set(sid, (siblingTotals.get(sid) || 0) + 1);
    }
  }
  const peerCount = Math.max(1, siblingPeers.length);

  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0.1;

  const scored: SystemSuggestion[] = [];
  for (const sys of systems) {
    if (declared.has(sys.id) || dismissed.has(sys.id)) continue;
    const rationale: string[] = [];
    const sysNameTokens = tokenise(sys.name);
    const sysDescTokens = tokenise(sys.description);

    const nameScore = overlap(nameTokens, sysNameTokens);
    const descScore = Math.max(
      overlap(nameTokens, sysDescTokens),
      overlap(descTokens, sysNameTokens),
      overlap(descTokens, sysDescTokens),
    );

    const siblingHits = siblingTotals.get(sys.id) || 0;
    const siblingScore = siblingHits === 0 ? 0 : Math.min(1, siblingHits / peerCount);
    if (siblingScore > 0) {
      rationale.push(
        `Used on ${siblingHits} sibling step${siblingHits === 1 ? '' : 's'} under the same parent`,
      );
    }
    if (nameScore > 0) {
      const shared = [...sysNameTokens].filter((t) => nameTokens.has(t)).slice(0, 3);
      rationale.push(`Name match on "${shared.join(', ')}"`);
    }
    if (descScore > 0 && nameScore === 0) {
      rationale.push('Description mentions terms from the step');
    } else if (descScore > 0) {
      rationale.push('Description overlap reinforces the name match');
    }

    const total = Math.min(
      1,
      nameScore * WEIGHT_NAME + descScore * WEIGHT_DESC + siblingScore * WEIGHT_SIBLING,
    );
    if (total >= minScore) {
      scored.push({
        systemId: sys.id,
        systemName: sys.name,
        vendor: sys.vendor,
        systemType: sys.systemType,
        score: Math.round(total * 1000) / 1000,
        rationale,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
