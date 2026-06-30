// Phase 3 Discover: People that look like candidates for involvement
// on this step (likely Responsible person), based on title/role
// overlap, required-skill match, and ownership of any system the
// step declares. Accept fires the caller's handler — typically
// "assign as Responsible Person on the node"; Dismiss persists to
// the learning loop.

import SuggestionsPanel from './SuggestionsPanel';

interface PeopleSuggestionsPanelProps {
  nodeId: string;
  onAccept: (personId: string) => Promise<void>;
  disabled?: boolean;
  refreshKey?: number;
}

interface RawPeopleSuggestion {
  personId: string;
  personName: string;
  title?: string;
  jobRole?: string;
  score: number;
  rationale: string[];
}

export default function PeopleSuggestionsPanel({
  nodeId,
  onAccept,
  disabled,
  refreshKey,
}: PeopleSuggestionsPanelProps) {
  return (
    <SuggestionsPanel
      nodeId={nodeId}
      kind="person"
      endpoint={`/process-catalog/nodes/${nodeId}/people-suggestions`}
      title="Suggested people"
      helpText="Procela ranks People who look like good candidates to involve on this step — title/role overlap, required skills, and ownership of the systems this step declares. Accept assigns them as the Responsible person; Dismiss tells Procela not to suggest them again."
      acceptLabel="Assign"
      onAccept={onAccept}
      disabled={disabled}
      refreshKey={refreshKey}
      normalize={(row: RawPeopleSuggestion) => ({
        targetId: row.personId,
        targetName: row.personName,
        subtitle: [row.title, row.jobRole].filter(Boolean).join(' · ') || undefined,
        score: row.score,
        rationale: row.rationale,
      })}
    />
  );
}
