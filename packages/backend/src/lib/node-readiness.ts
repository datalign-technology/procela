// Process-catalog "required before activation" fields, per level.
//
// This mirrors the frontend's readiness definition
// (packages/frontend/src/pages/process-catalog/ReadinessPanel.tsx → requiredFields):
// the two packages don't share code, so the set is kept in sync by hand. On the
// frontend it drives an advisory coverage read-out; here it backs the optional
// per-tenant activation gate (Organization.requireFieldsForActivation). When a
// tenant turns that on, a node cannot move to APPROVED or ACTIVE until every
// field below is filled.

function filled(v: unknown): boolean {
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== '';
}

// label → the node property that satisfies it.
const REQUIRED_BY_LEVEL: Record<string, Array<{ label: string; key: string }>> = {
  VALUE_STREAM: [
    { label: 'Value proposition', key: 'valueProposition' },
    { label: 'Customer type', key: 'customerType' },
    { label: 'End state', key: 'endState' },
    { label: 'Executive sponsor', key: 'executiveSponsor' },
    { label: 'Effective date', key: 'effectiveDate' },
    { label: 'Review cadence', key: 'reviewCadence' },
  ],
  PROCESS: [
    { label: 'Purpose', key: 'purpose' },
    { label: 'Frequency', key: 'frequency' },
    { label: 'Start point', key: 'startPoint' },
    { label: 'End point', key: 'endPoint' },
    { label: 'Effective date', key: 'effectiveDate' },
    { label: 'Review cadence', key: 'reviewCadence' },
  ],
  SUBPROCESS: [
    { label: 'Owner', key: 'ownerId' },
    { label: 'Entry criteria', key: 'entryCriteria' },
    { label: 'Exit criteria', key: 'exitCriteria' },
    { label: 'Performing org', key: 'performingOrg' },
    { label: 'Effective date', key: 'effectiveDate' },
    { label: 'Review cadence', key: 'reviewCadence' },
  ],
  ACTIVITY: [
    { label: 'Responsible Role', key: 'responsibleRole' },
    { label: 'Accountable Role', key: 'accountableRole' },
    { label: 'Activity type', key: 'activityType' },
    { label: 'Completion criteria', key: 'completionCriteria' },
    { label: 'Work instructions', key: 'workInstructions' },
  ],
};

/** The labels of this node's required-before-activation fields that are not yet
 *  filled. Empty array ⇒ ready to activate. Levels with no required set return
 *  []. */
export function missingRequiredFields<T extends { level?: string | null }>(node: T): string[] {
  const rec = node as Record<string, unknown>;
  const reqs = REQUIRED_BY_LEVEL[node.level || ''] || [];
  return reqs.filter((r) => !filled(rec[r.key])).map((r) => r.label);
}
