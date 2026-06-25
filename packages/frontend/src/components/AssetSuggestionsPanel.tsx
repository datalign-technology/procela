// Phase 3 Discover: data-asset suggestions for an activity-level node.
// Thin wrapper around SuggestionsPanel — keeps the asset-specific
// endpoint, label, and accept-handler signature stable for the caller.

import SuggestionsPanel from './SuggestionsPanel';

interface AssetSuggestionsPanelProps {
  nodeId: string;
  /** Asset's system id → friendly name lookup, so the rationale's
   *  "Same system as the step (system id …)" line can be rewritten to
   *  the actual name. */
  systemNames?: Record<string, string>;
  onAccept: (assetId: string) => Promise<void>;
  disabled?: boolean;
  refreshKey?: number;
}

interface RawAssetSuggestion {
  assetId: string;
  assetName: string;
  systemId: string;
  score: number;
  rationale: string[];
}

export default function AssetSuggestionsPanel({
  nodeId,
  systemNames,
  onAccept,
  disabled,
  refreshKey,
}: AssetSuggestionsPanelProps) {
  return (
    <SuggestionsPanel
      nodeId={nodeId}
      kind="asset"
      endpoint={`/process-catalog/nodes/${nodeId}/asset-suggestions`}
      title="Suggested data assets"
      helpText="Procela ranks data assets that look like candidates for this step based on name + description overlap and shared system. Accept moves it into the Inputs/Outputs above; Dismiss tells Procela not to suggest it again."
      onAccept={onAccept}
      disabled={disabled}
      refreshKey={refreshKey}
      normalize={(row: RawAssetSuggestion) => {
        const sysName = systemNames?.[row.systemId];
        const rationale = sysName
          ? row.rationale.map((l) => l.replace(/system id\s+\S+/i, sysName))
          : row.rationale;
        return {
          targetId: row.assetId,
          targetName: row.assetName,
          subtitle: sysName,
          score: row.score,
          rationale,
        };
      }}
    />
  );
}
