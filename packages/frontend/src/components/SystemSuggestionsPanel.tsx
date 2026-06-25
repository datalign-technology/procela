// Phase 3 Discover: Systems the step looks like it runs on but hasn't
// declared yet. Thin wrapper around SuggestionsPanel — Accept adds
// the system to node.systemIds (caller wires this); Dismiss persists
// to the learning loop.

import SuggestionsPanel from './SuggestionsPanel';

interface SystemSuggestionsPanelProps {
  nodeId: string;
  onAccept: (systemId: string) => Promise<void>;
  disabled?: boolean;
  refreshKey?: number;
}

interface RawSystemSuggestion {
  systemId: string;
  systemName: string;
  vendor?: string;
  systemType?: string;
  score: number;
  rationale: string[];
}

export default function SystemSuggestionsPanel({
  nodeId,
  onAccept,
  disabled,
  refreshKey,
}: SystemSuggestionsPanelProps) {
  return (
    <SuggestionsPanel
      nodeId={nodeId}
      kind="system"
      endpoint={`/process-catalog/nodes/${nodeId}/system-suggestions`}
      title="Suggested systems"
      helpText="Procela ranks Systems this step looks like it might run on, based on name/description overlap and which systems sibling steps already declare. Accept adds it to the step's Systems list; Dismiss tells Procela not to suggest it again."
      acceptLabel="Add"
      onAccept={onAccept}
      disabled={disabled}
      refreshKey={refreshKey}
      normalize={(row: RawSystemSuggestion) => ({
        targetId: row.systemId,
        targetName: row.systemName,
        subtitle: [row.vendor, row.systemType].filter(Boolean).join(' · ') || undefined,
        score: row.score,
        rationale: row.rationale,
      })}
    />
  );
}
