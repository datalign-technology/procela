// Asset suggestion service — the first piece of the Phase 3 Discover
// loop.
//
// Phase 1 (Define) builds the business hierarchy in plain language.
// Phase 2 (Connect) lets users describe data/systems in business
// terms. Phase 3 (Discover) closes the loop: once technical assets
// arrive (via the dbt manifest importer in routes/data-lineage,
// manual entry on Data Assets, or future source-system connectors),
// Procela should *suggest* which assets belong to which process
// steps. That suggestion is what this service produces.
//
// The scoring is intentionally simple and explainable. A weighted
// token-overlap on name and description, plus an affinity bump when
// the asset lives on a system the step already declares it runs on.
// No ML, no embeddings, no opaque rankings — every score comes with a
// rationale string the UI can show ("matched on 'customer billing';
// same system as the step (SAP Finance)"). When the simple version
// stops being useful, swap it for embeddings; the contract here
// (rankSuggestions) doesn't have to change.
//
// Dependency injection (the caller supplies node + assets + mappings)
// keeps the service free of route imports, which would otherwise
// create a circular load through process-catalog.

export interface SuggestionNode {
  id: string;
  name: string;
  description: string;
  systemIds?: string[];
}

export interface SuggestionAsset {
  id: string;
  name: string;
  description: string;
  systemId: string;
}

export interface SuggestionMapping {
  processStepId: string;
  dataAssetId?: string | null;
}

export interface AssetSuggestion {
  assetId: string;
  assetName: string;
  systemId: string;
  /** 0..1 — total score. The UI can show this as a percentage or
   *  bucket into Low/Medium/High; we don't enforce a threshold. */
  score: number;
  /** Why this asset was suggested. One short sentence per signal,
   *  joined into a list for display. Stable enough that the UI can
   *  test against substrings without coupling to wording. */
  rationale: string[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'by', 'from', 'into', 'is', 'are', 'was', 'were', 'be', 'as', 'at',
  'this', 'that', 'these', 'those', 'it', 'its', 'has', 'have', 'had',
  'data', 'process', 'system', 'step', 'activity',
]);

/** Tokenise text into a Set of lowercase, stop-word-stripped tokens of
 *  3+ characters. Punctuation and numbers are dropped; multi-word
 *  matches happen automatically via set overlap. */
export function tokenise(text: string): Set<string> {
  const tokens = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return new Set(tokens);
}

/** Jaccard-like overlap. Returns 0..1. Empty sets score 0 (not 1) so
 *  a step with no description doesn't trivially match every asset. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.max(a.size, b.size);
}

// Scoring weights. Sum doesn't have to be 1 — the final score is
// clamped to [0, 1] after combination. Tuned so a strong name match
// on a same-system asset can hit ~0.9, and a description-only match
// without system affinity tops out around 0.5.
const WEIGHT_NAME = 0.6;
const WEIGHT_DESC = 0.25;
const WEIGHT_SYSTEM = 0.25;

export interface RankOptions {
  /** Maximum number of suggestions to return. Defaults to 5. */
  limit?: number;
  /** Minimum total score to include in the result. Defaults to 0.1
   *  (any non-trivial signal). Set higher to be more conservative. */
  minScore?: number;
}

/** Rank candidate data assets for a process node by relevance.
 *  Caller is responsible for narrowing `assets` to the node's org
 *  and supplying only the mappings relevant to this node — the
 *  service trusts the inputs and only does the scoring. */
export function rankSuggestions(
  node: SuggestionNode,
  assets: readonly SuggestionAsset[],
  mappings: readonly SuggestionMapping[],
  opts: RankOptions = {},
): AssetSuggestion[] {
  if (!node || assets.length === 0) return [];

  // Don't suggest assets that are already mapped to this step.
  const alreadyMapped = new Set<string>();
  for (const m of mappings) {
    if (m.processStepId === node.id && m.dataAssetId) alreadyMapped.add(m.dataAssetId);
  }

  const stepNameTokens = tokenise(node.name);
  const stepDescTokens = tokenise(node.description);
  const stepSystems = new Set(node.systemIds || []);

  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0.1;

  const scored: AssetSuggestion[] = [];

  for (const asset of assets) {
    if (alreadyMapped.has(asset.id)) continue;

    const rationale: string[] = [];
    const assetNameTokens = tokenise(asset.name);
    const assetDescTokens = tokenise(asset.description);

    const nameScore = overlap(stepNameTokens, assetNameTokens);
    const descScore = Math.max(
      overlap(stepNameTokens, assetDescTokens),
      overlap(stepDescTokens, assetNameTokens),
      overlap(stepDescTokens, assetDescTokens),
    );

    let systemScore = 0;
    if (asset.systemId && stepSystems.has(asset.systemId)) {
      systemScore = 1;
      rationale.push(`Same system as the step (system id ${asset.systemId})`);
    }

    if (nameScore > 0) {
      const shared = [...assetNameTokens].filter((t) => stepNameTokens.has(t)).slice(0, 3);
      rationale.push(`Name match on "${shared.join(', ')}"`);
    }
    if (descScore > 0 && nameScore === 0) {
      rationale.push('Description mentions terms from the step');
    } else if (descScore > 0) {
      rationale.push('Description overlap reinforces the name match');
    }

    const total = Math.min(
      1,
      nameScore * WEIGHT_NAME + descScore * WEIGHT_DESC + systemScore * WEIGHT_SYSTEM,
    );

    if (total >= minScore) {
      scored.push({
        assetId: asset.id,
        assetName: asset.name,
        systemId: asset.systemId,
        score: Math.round(total * 1000) / 1000,
        rationale,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
