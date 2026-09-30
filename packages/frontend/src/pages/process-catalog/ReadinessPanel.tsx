import { Check, AlertTriangle } from 'lucide-react';
import type { ProcessNode } from '../ProcessCatalogPage';

// The mock-ups' readiness panel: a record's "how ready to activate is this?"
// summary, scored over a small set of required fields per level. The panel has
// three states — all-complete (green bar), active-but-incomplete (amber panel)
// and draft-in-progress (neutral panel) — matching the Process Catalog —
// Enhanced boards.
//
// The app doesn't carry every field the mock-ups mark required, so the required
// set below is the closest equivalent from the app's actual fields per level.
// It is presentation only (a coverage read-out); it does not gate the status
// machine.

type Req = { label: string; filled: boolean };

function filledStr(v: unknown): boolean {
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== '';
}

/** The required fields (and whether each is filled) for a node, by level. */
export function requiredFields(node: ProcessNode): Req[] {
  const f = (label: string, v: unknown): Req => ({ label, filled: filledStr(v) });
  switch (node.level) {
    case 'VALUE_STREAM':
      return [
        f('Value proposition', node.valueProposition),
        f('Customer type', node.customerType),
        f('End state', node.endState),
        f('Executive sponsor', node.executiveSponsor),
        f('Effective date', node.effectiveDate),
        f('Review cadence', node.reviewCadence),
      ];
    case 'PROCESS':
      return [
        f('Purpose', node.purpose),
        f('Frequency', node.frequency),
        f('Start point', node.startPoint),
        f('End point', node.endPoint),
        f('Effective date', node.effectiveDate),
        f('Review cadence', node.reviewCadence),
      ];
    case 'SUBPROCESS':
      return [
        f('Owner', node.ownerId),
        f('Entry criteria', node.entryCriteria),
        f('Exit criteria', node.exitCriteria),
        f('Performing org', node.performingOrg),
        f('Effective date', node.effectiveDate),
        f('Review cadence', node.reviewCadence),
      ];
    case 'ACTIVITY':
      return [
        f('Responsible Role', node.responsibleRole),
        f('Accountable Role', node.accountableRole),
        f('Activity type', node.activityType),
        f('Completion criteria', node.completionCriteria),
        f('Work instructions', node.workInstructions),
      ];
    default:
      return [];
  }
}

/** The set of required field labels for a level — used to flag those fields
 *  with the required dot in the detail panel. */
export function requiredLabels(node: ProcessNode): Set<string> {
  return new Set(requiredFields(node).map((r) => r.label));
}

export default function ReadinessPanel({ node }: { node: ProcessNode }) {
  const reqs = requiredFields(node);
  const total = reqs.length;
  if (total === 0) return null;

  const complete = reqs.filter((r) => r.filled).length;
  const missing = reqs.filter((r) => !r.filled).map((r) => r.label);
  const pct = Math.round((complete / total) * 100);
  const allDone = complete === total;
  const isActive = node.status === 'ACTIVE';
  const remaining = total - complete;

  // All required fields in → a slim green "ready" bar.
  if (allDone) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#DDF0E3', color: '#1E6B3A',
        borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600,
      }}>
        <Check size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
        All {total} required fields complete
      </div>
    );
  }

  // Incomplete: amber when the record is already Active (it went live with gaps),
  // else a neutral draft-progress panel counting toward activation.
  const amber = isActive;
  const heading = amber
    ? `Active, but ${remaining} required field${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'is' : 'are'} missing`
    : `${complete} of ${total} required fields complete`;

  return (
    <div style={{
      background: amber ? 'var(--color-attention-bg)' : 'var(--color-surface)',
      border: `1px solid ${amber ? 'var(--color-attention-border)' : 'var(--color-border)'}`,
      borderRadius: 10, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {amber && <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--color-attention)', flexShrink: 0 }} />}
        <span style={{ fontSize: 12, fontWeight: 600, color: amber ? 'var(--color-attention)' : 'var(--color-text)' }}>
          {heading}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {complete}/{total}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--color-border-subtle)', overflow: 'hidden' }}>
        <div
          role="progressbar"
          aria-valuenow={complete}
          aria-valuemin={0}
          aria-valuemax={total}
          style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)' }}
        />
      </div>
      {!amber && (
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          Activate is enabled once every required field is filled in.
        </span>
      )}
      {missing.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Missing:</span>
          {missing.map((m) => (
            <span key={m} style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-attention-border)',
              color: 'var(--color-attention)', borderRadius: 6, padding: '1px 7px', fontSize: 10,
            }}>{m}</span>
          ))}
        </div>
      )}
    </div>
  );
}
